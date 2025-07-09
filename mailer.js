const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const sendOTPEmail = (email, otp) => {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Your OTP Code from SchoolBusTrack',
      html: `
        <html>
          <head>
            <style>
              body {
                font-family: Arial, sans-serif;
                background-color: #f3f4f6;
                color: #333;
                padding: 20px;
              }
              .container {
                background-color: #ffffff;
                padding: 20px;
                border-radius: 8px;
                box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
              }
              .header {
                text-align: center;
                font-size: 24px;
                color: #4CAF50;
                margin-bottom: 20px;
              }
              .otp {
                display: inline-block;
                font-size: 32px;
                font-weight: bold;
                padding: 10px 20px;
                background-color: #4CAF50;
                color: white;
                border-radius: 8px;
                margin: 10px 0;
              }
              .footer {
                margin-top: 20px;
                text-align: center;
                font-size: 12px;
                color: #888;
              }
              .footer a {
                color: #4CAF50;
                text-decoration: none;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                SchoolBusTrack <br>
                <span style="font-size: 18px; color: #666;">Powered by ItsDeligh</span>
              </div>
              <div>
                <p>Hi there,</p>
                <p>We’ve received a request to send you an OTP to verify your email address.</p>
                <p>Your OTP code is:</p>
                <div class="otp">${otp}</div>
                <p>Please use this code to complete your verification.</p>
              </div>
              <div class="footer">
                <p>If you did not request this, please ignore this email.</p>
                <p>For more information, visit our <a href="https://www.itsdeligh.com" target="_blank">website</a>.</p>
              </div>
            </div>
          </body>
        </html>
      `,
    };
  
    return transporter.sendMail(mailOptions);
  };

module.exports = { sendOTPEmail };
