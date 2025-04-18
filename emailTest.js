require('dotenv').config();
const AWS = require('aws-sdk');
const nodemailer = require('nodemailer');

AWS.config.update({ region: 'us-west-1' }); // or set process.env.AWS_REGION accordingly

const ses = new AWS.SES({ apiVersion: '2010-12-01' });
const transporter = nodemailer.createTransport({ SES: { ses, aws: AWS } });

const mailOptions = {
    from: process.env.SENDER_EMAIL, // now uses the value from your .env file
    to: process.env.RECIPIENT_EMAIL,  // likewise here
    subject: 'Test Email from SES',
    text: 'This is a test email from Amazon SES via Nodemailer.'
  };  

transporter.sendMail(mailOptions, (err, info) => {
  if (err) {
    console.error('Error sending email:', err);
  } else {
    console.log('Email sent:', info);
  }
});

console.log("Using sender email:", process.env.SENDER_EMAIL);