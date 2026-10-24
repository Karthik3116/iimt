require('dotenv').config();
const axios = require('axios');


async function verifyMailProvider() {
    try {
        await axios.get('https://api.brevo.com/v3/account', {
            headers: { 
                'api-key': process.env.BREVO_API_KEY, 
                accept: 'application/json' 
            },
            timeout: 15000
        });
        console.log('[MHE-Watch] Mail provider check OK: Brevo API key is valid.');
    } catch (err) {
        const detail = err.response ? `HTTP ${err.response.status} ${JSON.stringify(err.response.data)}` : err.message;
        console.error(`[MHE-Watch] Mail provider check FAILED (brevo-api): ${detail}`);
    }
}

async function sendEmail() {
    try {
        const response = await axios.post(
            'https://api.brevo.com/v3/smtp/email',
            {
                sender: { 
                    name: "My App", 
                    email: "copypasteenbl@gmail.com" // Must be verified in your Brevo account
                },
                to: [{ 
                    email: "karthik3116k@gmail.com", // Replace with any destination email
                    name: "Recipient Name"
                }],
                subject: "Test Email from Brevo API",
                htmlContent: "<p>Hello! This email was sent successfully using the Brevo API in Node.js.</p>"
            },
            {
                headers: {
                    'api-key': process.env.BREVO_API_KEY,
                    'Content-Type': 'application/json',
                    'accept': 'application/json'
                }
            }
        );

        console.log("Email sent successfully! Message ID:", response.data.messageId);
    } catch (error) {
        console.error("Failed to send email. Error details:");
        console.error(error.response ? error.response.data : error.message);
    }
}

sendEmail();
verifyMailProvider()