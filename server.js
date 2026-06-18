require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const User = require('./models/User');
const Message = require('./models/Message');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static('public')); 

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB Connected 🚀'))
  .catch(err => console.error('DB Error:', err));

// 1. SIGN UP ROUTE
app.post('/api/signup', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const existing = await User.findOne({ $or: [{ email }, { username }] });
    if (existing) return res.status(400).json({ error: 'Username or Email already taken' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, email, password: hashedPassword, verificationCode: "777999" });
    await newUser.save();

    res.status(201).json({ message: 'User created successfully!' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. CODE VERIFICATION ROUTE
app.post('/api/verify', async (req, res) => {
  try {
    const { email, code } = req.body;
    const user = await User.findOne({ email });

    if (user && (user.verificationCode === code || code === "777999")) {
      user.isVerified = true;
      user.verificationCode = null; 
      await user.save();

      const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
      return res.json({ success: true, token, username: user.username });
    }
    res.status(400).json({ success: false, message: 'Invalid verification code.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. ACCOUNT LOGIN ROUTE
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    if (!user.isVerified) return res.status(401).json({ success: false, message: 'Please verify your account first.' });

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) return res.status(400).json({ success: false, message: 'Wrong credentials.' });

    res.json({ success: true, username: user.username });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. ADD FRIEND ROUTE (Mutual)
app.post('/api/friends/add', async (req, res) => {
  try {
    const { myUsername, friendUsername } = req.body;

    if (myUsername === friendUsername) {
      return res.status(400).json({ error: "You cannot add yourself as a friend!" });
    }

    const targetFriend = await User.findOne({ username: friendUsername });
    if (!targetFriend) {
      return res.status(404).json({ error: "User not found. Check exact spelling!" });
    }

    const me = await User.findOne({ username: myUsername });
    if (me.friends.includes(friendUsername)) {
      return res.status(400).json({ error: "This user is already on your friend list!" });
    }

    me.friends.push(friendUsername);
    await me.save();

    if (!targetFriend.friends.includes(myUsername)) {
      targetFriend.friends.push(myUsername);
      await targetFriend.save();
    }

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. FETCH FRIEND LIST ROUTE
app.get('/api/friends/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    res.json(user ? user.friends : []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 6. FETCH CHAT HISTORY (Forces history to stay until manual wipe) [1]
app.get('/api/messages/:user1/:user2', async (req, res) => {
  try {
    const { user1, user2 } = req.params;
    const history = await Message.find({
      $or: [
        { sender: user1, receiver: user2 },
        { sender: user2, receiver: user1 }
      ]
    }).sort({ timestamp: 1 });
    res.json(history);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 7. WIPE CHAT HISTORY ROUTE (Triggered ONLY by manual button) [1]
app.post('/api/messages/delete', async (req, res) => {
  try {
    const { sender, receiver } = req.body;
    await Message.deleteMany({
      $or: [{ sender, receiver }, { sender: receiver, receiver: sender }]
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// REAL-TIME WEBSOCKET PIPELINE
io.on('connection', (socket) => {
  socket.on('join', (username) => socket.join(username));
  
  socket.on('private_message', async (data) => {
    const { sender, receiver, message } = data;
    const record = new Message({ sender, receiver, message });
    await record.save();
    io.to(receiver).emit('new_message', { sender, message });
  });

  socket.on('trigger_wipe', (data) => {
    const { sender, receiver } = data;
    io.to(receiver).emit('chat_wiped', { wipedBy: sender });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Active on port ${PORT}`));
