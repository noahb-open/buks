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

// 1. SIGN UP ROUTE (No Emails, Pure Redirect with Static Code)
app.post('/api/signup', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const existing = await User.findOne({ $or: [{ email }, { username }] });
    if (existing) return res.status(400).json({ error: 'Username or Email already taken' });

    const hashedPassword = await bcrypt.hash(password, 10);

    // Save user with the permanent universal verification passcode
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

// 4. ADD FRIEND ROUTE (Mutual Addition Setup)
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
    
    // Check if you are already friends
    if (me.friends.includes(friendUsername)) {
      return res.status(400).json({ error: "This user is already on your friend list!" });
    }

    // MUTUAL LINK: Add the friend to your list
    me.friends.push(friendUsername);
    await me.save();

    // MUTUAL LINK: Automatically add yourself to their list if not already there
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

// 6. WIPE CHAT HISTORY ROUTE (Snapchat Style)
app.post('/api/messages/delete', async (req, res) => {
  try {
    const { sender, receiver } = req.body;
    await Message.deleteMany({
      $or: [{ sender, receiver }, { sender: receiver, receiver: sender }]
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// REAL-TIME WEBSOCKET CHAT MECHANISM
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
