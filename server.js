require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const User = require('./models/User');
const Message = require('./models/Message');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static('public')); // This looks for your files in /public!

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB Connected 🚀'))
  .catch(err => console.error('DB Error:', err));

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// SIGN UP ROUTE
app.post('/api/signup', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const existing = await User.findOne({ $or: [{ email }, { username }] });
    if (existing) return res.status(400).json({ error: 'Username/Email taken' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    const newUser = new User({ username, email, password: hashedPassword, verificationCode: code });
    await newUser.save();

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: '🚀 Your Blue Rocket Verification Code',
      text: `Your code is: ${code}`
    });

    res.status(201).json({ message: 'Code sent!' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// VERIFICATION ROUTE
app.post('/api/verify', async (req, res) => {
  const { email, code } = req.body;
  const user = await User.findOne({ email });
  if (user && user.verificationCode === code) {
    user.isVerified = true;
    user.verificationCode = null;
    await user.save();
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);
    return res.json({ success: true, token, username: user.username });
  }
  res.status(400).json({ success: false, message: 'Invalid Code' });
});

// 2B. NATIVE ACCOUNT LOGIN ROUTE
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    if (!user.isVerified) return res.status(401).json({ success: false, message: 'Verify account token first.' });

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) return res.status(400).json({ success: false, message: 'Wrong credentials.' });

    // Login verified
    res.json({ success: true, username: user.username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// WIPE CHAT ROUTE (Snapchat-style)
app.post('/api/messages/delete', async (req, res) => {
  const { sender, receiver } = req.body;
  await Message.deleteMany({
    $or: [{ sender, receiver }, { sender: receiver, receiver: sender }]
  });
  res.json({ success: true });
});

// LIVE SOCKET CHANNEL
io.on('connection', (socket) => {
  socket.on('join', (username) => socket.join(username));
  socket.on('private_message', async (data) => {
    const { sender, receiver, message } = data;
    const record = new Message({ sender, receiver, message });
    await record.save();
    io.to(receiver).emit('new_message', { sender, message });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Active on port ${PORT}`));
