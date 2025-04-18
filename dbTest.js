// dbTest.js

// Load environment variables from your .env file
require('dotenv').config();

// Import the MySQL client using promises
const mysql = require('mysql2/promise');

async function testConnection() {
  try {
    // Create a connection using the environment variables
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });
    
    console.log("Connected to the database successfully!");

    // Optional: Run a simple query to test your table structure
    const [rows] = await connection.query("SELECT * FROM weather_data LIMIT 1");
    console.log("Query result:", rows);

    // Close the connection
    await connection.end();
  } catch (error) {
    console.error("Database connection failed:", error);
  }
}

testConnection();
