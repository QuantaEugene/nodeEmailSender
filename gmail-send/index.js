const fs = require('fs').promises;
const path = require('path');
const { authenticate } = require('@google-cloud/local-auth');
const { google } = require('googleapis');
const express = require('express');

const app = express();
const port = 3001;

// If modifying these scopes, delete token.json.
const SCOPES = [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.send'
];
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

/**
 * Reads previously authorized credentials from the save file.
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist() {
    try {
        const content = await fs.readFile(TOKEN_PATH);
        const credentials = JSON.parse(content);
        return google.auth.fromJSON(credentials);
    } catch (err) {
        return null;
    }
}

/**
 * Serializes credentials to a file compatible with GoogleAUth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) {
    const content = await fs.readFile(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const payload = JSON.stringify({
        type: 'authorized_user',
        client_id: key.client_id,
        client_secret: key.client_secret,
        refresh_token: client.credentials.refresh_token,
    });
    await fs.writeFile(TOKEN_PATH, payload);
}

/*Load or request or authorization to call APIs.*/
async function authorize() {
    let client = await loadSavedCredentialsIfExist();
    if (client) {
        return client;
    }
    client = await authenticate({
        scopes: SCOPES,
        keyfilePath: CREDENTIALS_PATH,
    });
    if (client.credentials) {
        await saveCredentials(client);
    }
    return client;
}

/**
 * Lists the labels in the user's account.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
*/
async function listLabels(auth) {
    const gmail = google.gmail({ version: 'v1', auth });
    const res = await gmail.users.labels.list({
        userId: 'me',
    });
    const labels = res.data.labels;
    if (!labels || labels.length === 0) {
        console.log('No labels found.');
        return;
    }
    console.log('Labels:');
    labels.forEach((label) => {
        console.log(`- ${label.name}:${label.id}`);
    });
}

/**
 * Function to get unreplied messages from Gmail.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 * @returns {Promise<Array>} Array of unreplied messages.
 */
async function getUnrepliedMessages(auth) {
    const gmail = google.gmail({ version: 'v1', auth });
    const res = await gmail.users.messages.list({
        userId: 'me',
        q: '-in:chat -from:me -has:userlabels'
    });
    return res.data.messages || [];
}

/**
 * Function to send reply to a message in Gmail.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 * @param {object} message The message object.
 */
async function sendReply(auth, message) {
    const gmail = google.gmail({ version: 'v1', auth });
    const res = await gmail.users.messages.get({
        userId: 'me',
        id: message.id,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From'],
    });

    const subject = res.data.payload.headers.find((header) => header.name == 'Subject').value;
    const from = res.data.payload.headers.find((header) => header.name == 'From').value;

    const replyTo = from.match(/<(.*)>/)[1];
    const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
    const replyBody = `Dear,\n\nWe have received your mail and will reply soon.\n\nRegards,\nNarayan`;

    const rawMessage = [
        `From: me`,
        `To: ${replyTo}`,
        `Subject: ${replySubject}`,
        `In-Reply-To: ${message.id}`,
        `References: ${message.id}`,
        ``,
        replyBody
    ].join('\n');

    const encodedMessage = Buffer.from(rawMessage).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
            raw: encodedMessage,
        },
    });
}

/**
 * Function to create a Gmail label.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 * @returns {Promise<string>} The label ID.
 */
async function createLabel(auth) {
    const gmail = google.gmail({ version: 'v1', auth });
    try {
        const res = await gmail.users.labels.create({
            userId: 'me',
            requestBody: {
                name: 'PENDING',
                labelListVisibility: 'labelShow',
                messageListVisibility: 'show'
            }
        });
        return res.data.id;
    } catch (err) {
        if (err.code === 409) {
            // Label already exists, fetch its ID
            const res = await gmail.users.labels.list({
                userId: 'me'
            });
            const label = res.data.labels.find((label) => label.name === 'PENDING');
            return label.id;
        } else {
            throw err;
        }
    }
}
/**

* @param {google.auth.OAuth2} auth An authorized OAuth2 client.
* @param {string} to The recipient email address.
* @param {string} subject The subject of the email.
* @param {string} body The body of the email.
*/
async function sendEmail(auth, to, subject, body) {
   const gmail = google.gmail({ version: 'v1', auth });

   const rawMessage = [
       `From: me`,
       `To: ${to}`,
       `Subject: ${subject}`,
       `Content-Type: text/plain; charset="UTF-8"`,
       ``,
       body
   ].join('\n');

   const encodedMessage = Buffer.from(rawMessage).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

   await gmail.users.messages.send({
       userId: 'me',
       requestBody: {
           raw: encodedMessage,
       },
   });

   console.log(`Email sent successfully to: ${to}`);
}

/**
 * Function to add a label to a Gmail message.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 * @param {object} message The message object.
 * @param {string} labelId The ID of the label to add.
 */
async function addLabel(auth, message, labelId) {
    const gmail = google.gmail({ version: 'v1', auth });
    await gmail.users.messages.modify({
        id: message.id,
        userId: 'me',
        requestBody: {
            addLabelIds: [labelId],
            removeLabelIds: ['INBOX'],
        },
    });
}

/**
 * Main function to run the automated process.
 */
async function main() {
    const auth = await authorize();
    const labelId = await createLabel(auth);
    console.log(`LABEL ID: ${labelId}`);
    setInterval(async () => {
        const messages = await getUnrepliedMessages(auth);
        console.log(`UNREPLIED MESSAGES: ${messages.length}`);
        for (let message of messages) {
            await sendReply(auth, message);
            console.log(`REPLIED TO: ${message.id}`);
            await addLabel(auth, message, labelId);
            console.log(`ADDED LABEL TO: ${message.id}`);
        }
    }, Math.floor(Math.random() * (120 - 45 + 1) + 45) * 1000);
}

app.get("/send-email", async (req, res) => {
    const to = 'kolomiec.evgeniy03@gmail.com'; // Замените на свой адрес электронной почты
    const subject = 'Тестовое письмо';
    const body = 'Это тестовое письмо, отправленное с помощью Gmail API.';

    try {
        const auth = await authorize();
        await sendEmail(auth, to, subject, body);
        res.send(`Email sent successfully to: ${to}`);
    } catch (error) {
        console.error('Error sending email:', error);
        res.status(500).send('Error sending email');
    }
});

main().catch(console.error);

app.get("/", async (req, res) => {
    res.send("Success !!!");
});

app.listen(port, () => {
    console.log(`Listening at: http://localhost:${port}`);
});