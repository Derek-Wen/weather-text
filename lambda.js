// lambda.js

const axios = require("axios");
const AWS = require("aws-sdk");
const nodemailer = require("nodemailer");
const { format, fromUnixTime, subHours } = require("date-fns");

/**
 * Formats a UNIX timestamp (seconds) into "HH:mm" (12-hour) after shifting by 4 hours (EST adjustment).
 */
function formatUnixTimeToHHMM(timestamp) {
  // fromUnixTime expects seconds; subHours shifts the time zone
  return format(subHours(fromUnixTime(timestamp), 4), "hh:mm");
}

/**
 * Retrieves only today’s hourly periods from the NOAA API using date-fns for date formatting.
 */
function retrieveTodayHours(periods) {
  const todayPrefix = format(new Date(), "yyyy-MM-dd");
  return periods.filter(({ startTime }) => startTime.startsWith(todayPrefix));
}

exports.handler = async function (event, context) {
  const {
    OPEN_WEATHER_MAP_API_KEY: APIKey,
    LATITUDE: latitude,
    LONGITUDE: longitude,
    SENDER_EMAIL,
    RECIPIENT_EMAIL,
    AWS_REGION,
  } = process.env;
  const units = "imperial";

  console.log("Lambda env vars:", { APIKey, latitude, longitude, SENDER_EMAIL, RECIPIENT_EMAIL });

  // Fetch data
  const [currentWeatherRes, metaRes] = await Promise.all([
    axios.get(
      `https://api.openweathermap.org/data/2.5/weather?lat=${latitude}&lon=${longitude}&units=${units}&appid=${APIKey}`
    ),
    axios.get(`https://api.weather.gov/points/${latitude},${longitude}`),
  ]);

  const [{ data: currentWeather }, { data: meta }] = [currentWeatherRes, metaRes];

  const [weeklyRes, hourlyRes] = await Promise.all([
    axios.get(meta.properties.forecast),
    axios.get(meta.properties.forecastHourly),
  ]);
  const weeklyPeriods = weeklyRes.data.properties.periods;
  const hourlyPeriods = hourlyRes.data.properties.periods;

  // Extract today's hours
  const hoursToday = retrieveTodayHours(hourlyPeriods);

  // Compute high & low in one line each
  const temps = hoursToday.map((p) => Number(p.temperature));
  const highTemp = Math.max(...temps);
  const lowTemp = Math.min(...temps);

  // Format sunrise/sunset
  const sunrise = formatUnixTimeToHHMM(currentWeather.sys.sunrise);
  const sunset  = formatUnixTimeToHHMM(currentWeather.sys.sunset);

  const weatherInfo = {
    currentTemp: currentWeather.main.temp,
    highTemp,
    lowTemp,
    windSpeed: currentWeather.wind.speed,
    sunrise,
    sunset,
    forecast: weeklyPeriods[0].detailedForecast,
  };

  // Persist to RDS
  await saveWeatherData(weatherInfo);

  // Build message
  const message = [
    "WEATHER-TEXT DEREK WEN:",
    "",
    "Good Morning! ☀️🌤⛈",
    "Here's the summary for today...",
    "",
    `Temperature: ${weatherInfo.currentTemp.toFixed(0)}°`,
    `High: ${highTemp}°`,
    `Low: ${lowTemp}°`,
    `Wind: ${weatherInfo.windSpeed.toFixed(0)} MPH`,
    `Sunrise: ${sunrise} AM`,
    `Sunset: ${sunset} PM`,
    "",
    `Forecast: ${weatherInfo.forecast}`,
    "",
    "Have a good day! 🎉🎉🎉",
  ].join("\n");

  // Send email via SES
  AWS.config.update({ region: AWS_REGION || "us-west-1" });
  const ses = new AWS.SES({ apiVersion: "2010-12-01" });
  const transporter = nodemailer.createTransport({ SES: { ses, aws: AWS } });
  const mailOptions = {
    from: SENDER_EMAIL,
    to: RECIPIENT_EMAIL,
    subject: "Weather Forecast",
    text: message,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent:", info);
    return "lambda completed with success";
  } catch (err) {
    console.error("Error sending email:", err);
    return `lambda completed with error: ${err.message}`;
  }
};

const mysql = require("mysql2/promise");
async function saveWeatherData({ currentTemp, highTemp, lowTemp, windSpeed, sunrise, sunset, forecast }) {
  const dbPassword = process.env.DB_PASSWORD || process.env.DB_PASSWOR;
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: dbPassword,
      database: process.env.DB_NAME,
    });

    const sql = `
      INSERT INTO weather_data
        (temperature, high, low, wind_speed, sunrise, sunset, forecast)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    const values = [
      Math.round(currentTemp),
      highTemp,
      lowTemp,
      Math.round(windSpeed),
      sunrise,
      sunset,
      forecast,
    ];
    await connection.execute(sql, values);
    console.log("Weather data inserted successfully.");
  } catch (err) {
    console.error("Error saving weather data:", err);
  } finally {
    if (connection) await connection.end();
  }
}
