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

// Increase JSON payload limits so large Base64 images/files don't get cut off
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
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
    const newUser = new User({ username, email, password: hashedPassword, verificationCode: "777999", friends: [], requests: [] });
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

// 4. SEND FRIEND REQUEST ROUTE
app.post('/api/friends/request', async (req, res) => {
  try {
    const { myUsername, friendUsername } = req.body;

    if (myUsername === friendUsername) {
      return res.status(400).json({ error: "You cannot add yourself!" });
    }

    const targetFriend = await User.findOne({ username: friendUsername });
    if (!targetFriend) {
      return res.status(404).json({ error: "User does not exist. Check spelling!" });
    }

    const me = await User.findOne({ username: myUsername });
    
    if (!me.friends) me.friends = [];
    if (!targetFriend.requests) targetFriend.requests = [];

    if (me.friends.includes(friendUsername)) {
      return res.status(400).json({ error: "This user is already on your friend list!" });
    }

    if (targetFriend.requests.includes(myUsername)) {
      return res.status(400).json({ error: "Friend request already pending!" });
    }

    targetFriend.requests.push(myUsername);
    await targetFriend.save();

    io.to(friendUsername).emit('incoming_request', { from: myUsername });

    res.json({ success: true, message: "Request sent!" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4B. ACCEPT FRIEND REQUEST ROUTE
app.post('/api/friends/accept', async (req, res) => {
  try {
    const { myUsername, requesterUsername } = req.body;

    const me = await User.findOne({ username: myUsername });
    const requester = await User.findOne({ username: requesterUsername });

    if (!me || !requester) return res.status(404).json({ error: "User records not found." });

    if (!me.requests) me.requests = [];
    if (!me.friends) me.friends = [];
    if (!requester.friends) requester.friends = [];

    me.requests = me.requests.filter(name => name !== requesterUsername);

    if (!me.friends.includes(requesterUsername)) me.friends.push(requesterUsername);
    if (!requester.friends.includes(myUsername)) requester.friends.push(myUsername);

    await me.save();
    await requester.save();

    io.to(requesterUsername).emit('request_accepted', { by: myUsername });

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4C. DECLINE FRIEND REQUEST ROUTE
app.post('/api/friends/decline', async (req, res) => {
  try {
    const { myUsername, requesterUsername } = req.body;
    const me = await User.findOne({ username: myUsername });

    if (!me) return res.status(404).json({ error: "User not found." });

    if (!me.requests) me.requests = [];
    me.requests = me.requests.filter(name => name !== requesterUsername);
    await me.save();

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4D. DELETE FRIEND ROUTE (Removes friendship mutually)
app.post('/api/friends/delete', async (req, res) => {
  try {
    const { myUsername, friendUsername } = req.body;

    const me = await User.findOne({ username: myUsername });
    const exFriend = await User.findOne({ username: friendUsername });

    if (!me || !exFriend) return res.status(404).json({ error: "User records not found." });

    if (!me.friends) me.friends = [];
    if (!exFriend.friends) exFriend.friends = [];

    me.friends = me.friends.filter(name => name !== friendUsername);
    exFriend.friends = exFriend.friends.filter(name => name !== myUsername);

    await me.save();
    await exFriend.save();

    io.to(friendUsername).emit('friend_deleted', { by: myUsername });

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. FETCH FRIEND LIST AND REQUESTS ROUTE
app.get('/api/friends-data/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    res.json({
      friends: user && user.friends ? user.friends : [],
      requests: user && user.requests ? user.requests : []
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 6. FETCH CHAT HISTORY (Loads message text, image strings, and files)
app.get('/api/messages/:user1/:user2', async (req, res) => {
  try {
    const { user1, user2 } = req.params;
    const history = await Message.find({
      $or: [{ sender: user1, receiver: user2 }, { sender: user2, receiver: user1 }]
    }).sort({ timestamp: 1 });
    res.json(history);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 7. WIPE CHAT HISTORY ROUTE
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
  
  // Pipeline to relay and save file/image streams along with standard texts
  socket.on('private_message', async (data) => {
    const { sender, receiver, message, fileData, fileType, fileName } = data;
    
    try {
      const record = new Message({ 
        sender, 
        receiver, 
        message: message || "", 
        fileData: fileData || null,
        fileType: fileType || null,
        fileName: fileName || null
      });
      await record.save();
      
      io.to(receiver).emit('new_message', { 
        sender, 
        message,
        fileData,
        fileType,
        fileName
      });
    } catch (err) {
      console.error("Failed to process message attachment:", err);
    }
  });

  socket.on('trigger_wipe', (data) => {
    const { sender, receiver } = data;
    io.to(receiver).emit('chat_wiped', { wipedBy: sender });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Active on port ${PORT}`));
