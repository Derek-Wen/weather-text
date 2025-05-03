const axios = require("axios");
const AWS = require('aws-sdk');
const nodemailer = require('nodemailer');



/**
 * Helper method that formats a UNIX time into a "HH:MM" string.
 * Adjusts for Eastern Standard Time (subtracts 4 hours).
 */
function formatTime(time) {
  const zeroTime = new Date(0);
  zeroTime.setUTCSeconds(time);
  let minutes = String(zeroTime.getUTCMinutes());
  if (minutes.length < 2) {
    minutes = "0" + minutes;
  }
  let hours = String(zeroTime.getUTCHours() - 4);
  if (hours > 12) {
    hours = hours - 12;
  }
  if (hours.length < 2) {
    hours = "0" + hours;
  }
  return hours + ":" + minutes;
}

/**
 * Retrieves the hourly forecast periods specific to today from the NOAA API.
 */
function retrieveHours(periods) {
  const today = new Date();
  const monthNumber = today.getMonth() + 1;
  let monthString = monthNumber.toString();
  if (monthString.length === 1) {
    monthString = "0" + monthString;
  }
  let dayString = today.getDate().toString();
  if (dayString.length === 1) {
    dayString = "0" + dayString;
  }
  const timePrefix = today.getFullYear() + "-" + monthString + "-" + dayString;
  return periods.filter(
    period => period.startTime.toString().includes(timePrefix)
  );
}

/**
 * Lambda handler: Fetches weather data from OpenWeatherMap and NOAA,
 * constructs a minimal weather message, and sends it as an email via Amazon SES.
 */
exports.handler = async function(event, context) {
  const APIKey = process.env.OPEN_WEATHER_MAP_API_KEY;
  const latitude = process.env.LATITUDE;
  const longitude = process.env.LONGITUDE;
  const units = "imperial";

  console.log("Lambda env vars:", {
    OPEN_WEATHER_MAP_API_KEY: process.env.OPEN_WEATHER_MAP_API_KEY,
    LATITUDE: process.env.LATITUDE,
    LONGITUDE: process.env.LONGITUDE,
    SENDER_EMAIL: process.env.SENDER_EMAIL,
    RECIPIENT_EMAIL: process.env.RECIPIENT_EMAIL
  });

  // Fetch current weather from OpenWeatherMap
  const openWeatherMapAPIURL = `https://api.openweathermap.org/data/2.5/weather?lat=${latitude}&lon=${longitude}&units=${units}&appid=${APIKey}`;
  const currentWeather = await axios.get(openWeatherMapAPIURL).catch(error => {
    console.log("Error fetching current weather:", error);
    return;
  });

  // Fetch NOAA Metadata for forecast endpoints
  const NOAAMetadata = await axios
    .get(`https://api.weather.gov/points/${latitude},${longitude}`)
    .catch(error => {
      console.log("Error fetching NOAA metadata:", error);
      return;
    });

  // Fetch NOAA Weekly Forecast
  const NOAAWeeklyForecast = await axios
    .get(NOAAMetadata.data.properties.forecast)
    .catch(error => {
      console.log("Error fetching NOAA weekly forecast:", error);
      return;
    });

  // Fetch NOAA Hourly Forecast
  const NOAAHourlyForecast = await axios
    .get(NOAAMetadata.data.properties.forecastHourly)
    .catch(error => {
      console.log("Error fetching NOAA hourly forecast:", error);
      return;
    });

  const hoursToday = retrieveHours(NOAAHourlyForecast.data.properties.periods);

  let highTemp = 0;
  hoursToday.forEach(period => {
    if (parseInt(period.temperature) > highTemp) {
      highTemp = period.temperature;
    }
  });

  let lowTemp = highTemp;
  hoursToday.forEach(period => {
    if (parseInt(period.temperature) < lowTemp) {
      lowTemp = period.temperature;
    }
  });

  const sunrise = formatTime(currentWeather.data.sys.sunrise);
  const sunset = formatTime(currentWeather.data.sys.sunset);

  // Example weatherInfo object constructed from your API responses
  const weatherInfo = {
    currentTemp: currentWeather.data.main.temp,  // from OpenWeatherMap
    highTemp: highTemp,                          // computed from NOAA hourly data
    lowTemp: lowTemp,                            // computed from NOAA hourly data
    windSpeed: currentWeather.data.wind.speed,   // from OpenWeatherMap
    sunrise: formatTime(currentWeather.data.sys.sunrise),
    sunset: formatTime(currentWeather.data.sys.sunset),
    forecast: NOAAWeeklyForecast.data.properties.periods[0].detailedForecast
  };
  
  // Save data to MySQL RDS
  await saveWeatherData(weatherInfo);

  const message =
    "WEATHER-TEXT DEREK WEN:\n" +
    "\n" +
    "Good Morning!  ☀️ 🌤 ⛈ \n" +
    "Here's the summary for today...\n" +
    "\n" +
    `Temperature: ${currentWeather.data.main.temp.toFixed(0)}°\n` +
    `High: ${highTemp.toString()}°\n` +
    `Low: ${lowTemp.toString()}°\n` +
    `Wind: ${currentWeather.data.wind.speed.toFixed(0)} MPH\n` +
    `Sunrise: ${sunrise} AM\n` +
    `Sunset: ${sunset} PM\n` +
    "\n" +
    `Forecast: ${NOAAWeeklyForecast.data.properties.periods[0].detailedForecast}\n` +
    "\n" +
    "Have a good day! 🎉🎉 🎉 🎉";

  // --- EMAIL SENDING VIA AMAZON SES USING NODEMAILER ---
  AWS.config.update({ region: process.env.AWS_REGION || 'us-west-1' });
  const ses = new AWS.SES({ apiVersion: '2010-12-01' });
  const transporter = nodemailer.createTransport({ SES: { ses, aws: AWS } });
  
  const mailOptions = {
    from: process.env.SENDER_EMAIL,
    to: process.env.RECIPIENT_EMAIL,
    subject: 'Weather Forecast',
    text: message
  };

  let response = "lambda completed with ";
  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent:", info);
    response += "success";
  } catch (error) {
    console.error("Error sending email:", error);
    response += " error: " + error.message;
  } 
  return response;
}


const mysql = require('mysql2/promise');

async function saveWeatherData(weatherInfo) {
  const dbPassword = process.env.DB_PASSWOR || process.env.DB_PASSWORD;
  
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: dbPassword,
      database: process.env.DB_NAME
    });
    
    // Prepare the INSERT query.
    const sql = `
      INSERT INTO weather_data (temperature, high, low, wind_speed, sunrise, sunset, forecast)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    const values = [
      Math.round(weatherInfo.currentTemp),  // current temperature
      weatherInfo.highTemp,                  // high of day
      weatherInfo.lowTemp,                   // low of day
      Math.round(weatherInfo.windSpeed),     // wind speed
      weatherInfo.sunrise,                   // sunrise time (formatted)
      weatherInfo.sunset,                    // sunset time (formatted)
      weatherInfo.forecast                   // detailed forecast text
    ];
    
    // Execute the insertion
    await connection.execute(sql, values);
    console.log('Weather data inserted successfully.');
  } catch (error) {
    console.error('Error saving weather data:', error);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}
