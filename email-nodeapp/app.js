
const nodemailer = require('nodemailer');

var transporter = nodemailer.createTransport({
    host: "sandbox.smtp.mailtrap.io",
    port: 2525,
    auth: {
      user: "b4adac47110e8e",
      pass: "a54a1ec0095e66"
    }
  });

let emails = [
    'kolomiec.evgeniy0@gmail.com',
    'test@gmail.com',
    'test1@gmail.com',
];

function sendEmail(i) {
    const mailOptions = {
        from: 'eugene@quantatech.net',
        to: emails[i],
        subject: 'Sending Email using Node.js',
        text: `That was easy! ${i}`
    };

    transporter.sendMail(mailOptions, function(error, info) {
        if (error) {
            console.log('Error:', error);
        } else {
            console.log('Email sent:', info.response);
        }
    });
}

for (let i = 0; i < emails.length; i++) {
    setTimeout(sendEmail, i * 1000, i);
}