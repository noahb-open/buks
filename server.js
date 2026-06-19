require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const User = require('./models/User');
const Message = require('./models/Message');
const Group = require('./models/Group'); // 🚀 Import group schema

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public')); 

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB Connected 🚀'))
  .catch(err => console.error('DB Error:', err));

// 🚀 EMERGENCY AUTO-RESET GATE FOR ADMIN PROFILE
mongoose.connection.once('open', async () => {
  try {
    const adminEmail = "creator@bluerocket.net";
    const secureHash = await bcrypt.hash("h!vemind12", 10);

    // Completely wipe any duplicate or broken creator accounts
    await User.deleteMany({ username: "CREATOR_RED" });
    await User.deleteMany({ email: adminEmail });

    // Insert a fresh, perfectly encrypted master profile block
    const freshAdmin = new User({
      username: "CREATOR_RED",
      email: adminEmail,
      password: secureHash,
      isVerified: true,
      friends: [],
      requests: []
    });
    await freshAdmin.save();
    console.log("SUCCESS: CREATOR_RED node fully rebuilt and encrypted locally! 🛡️");
  } catch (err) {
    console.error("Admin setup hook caught error:", err);
  }
});

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
    return res.status(400).json({ success: false, message: 'Invalid verification code.' });
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

    // ✨ Fix: Generate JWT token on successful login
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({ success: true, token, username: user.username });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. SEND FRIEND REQUEST ROUTE
app.post('/api/friends/request', async (req, res) => {
  try {
    const { myUsername, friendUsername } = req.body;
    if (myUsername === friendUsername) return res.status(400).json({ error: "You cannot add yourself!" });

    const targetFriend = await User.findOne({ username: friendUsername });
    if (!targetFriend) return res.status(404).json({ error: "User does not exist. Check spelling!" });

    const me = await User.findOne({ username: myUsername });
    if (!me.friends) me.friends = [];
    if (!targetFriend.requests) targetFriend.requests = [];

    if (me.friends.includes(friendUsername)) return res.status(400).json({ error: "Already on your friend list!" });
    if (targetFriend.requests.includes(myUsername)) return res.status(400).json({ error: "Request already pending!" });

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

    me.requests = me.requests.filter(name => name !== requesterUsername);
    await me.save();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4D. DELETE FRIEND ROUTE
app.post('/api/friends/delete', async (req, res) => {
  try {
    const { myUsername, friendUsername } = req.body;
    const me = await User.findOne({ username: myUsername });
    const exFriend = await User.findOne({ username: friendUsername });

    if (!me || !exFriend) return res.status(404).json({ error: "User records not found." });

    me.friends = me.friends.filter(name => name !== friendUsername);
    exFriend.friends = exFriend.friends.filter(name => name !== myUsername);

    await me.save();
    await exFriend.save();

    io.to(friendUsername).emit('friend_deleted', { by: myUsername });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 🚀 DATABASE GROUP CREATION ROUTE
app.post('/api/groups/create', async (req, res) => {
  try {
    const { name, creator } = req.body;
    if (!name || !creator) return res.status(400).json({ error: "Missing name or creator fields." });

    const groupId = 'group_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now().toString().slice(-4);
    
    const newGroup = new Group({ name, groupId, creator, members: [creator] });
    await newGroup.save();
    
    res.status(201).json({ success: true, group: newGroup });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 🚀 CREATOR-ONLY INVITE ROUTE
app.post('/api/groups/invite', async (req, res) => {
  try {
    const { groupId, creatorUsername, targetUsername } = req.body;
    const group = await Group.findOne({ groupId });
    
    if (!group) return res.status(404).json({ error: "Group not found." });
    if (group.creator !== creatorUsername) return res.status(403).json({ error: "🔒 Access Denied: Only the creator can invite!" });

    const targetUser = await User.findOne({ username: targetUsername });
    if (!targetUser) return res.status(404).json({ error: "User does not exist." });

    if (group.members.includes(targetUsername)) return res.status(400).json({ error: "User is already a member!" });

    group.members.push(targetUsername);
    await group.save();
    res.json({ success: true, message: "Member added successfully!" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 📊 DASHBOARD DATA SYNC ENDPOINT
app.get('/api/friends-data/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ friends: user.friends || [], requests: user.requests || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 📂 CHAT HISTORY RETRIEVAL ENDPOINT
app.get('/api/messages/:me/:peer', async (req, res) => {
  try {
    const { me, peer } = req.params;
    let messages;
    
    if (peer.startsWith('group_')) {
      messages = await Message.find({ receiver: peer }).sort({ createdAt: 1 });
    } else {
      messages = await Message.find({
        $or: [
          { sender: me, receiver: peer },
          { sender: peer, receiver: me }
        ]
      }).sort({ createdAt: 1 });
    }
    res.json(messages);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 🧹 WIPING ENGINE DATA OVERWRITE
app.post('/api/messages/delete', async (req, res) => {
  try {
    const { sender, receiver } = req.body;
    if (receiver.startsWith('group_')) {
      await Message.deleteMany({ receiver });
    } else {
      await Message.deleteMany({
        $or: [
          { sender, receiver },
          { sender: receiver, receiver: sender }
        ]
      });
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 🛰️ REALTIME SOCKET.IO ENGINE MANAGEMENT
io.on('connection', (socket) => {

  socket.on('join', (roomOrUser) => {
    socket.join(roomOrUser);
    console.log(`Socket [${socket.id}] entered routing room: ${roomOrUser}`);
  });

  socket.on('request_dashboard_sync', async (username) => {
    try {
      const user = await User.findOne({ username: username });
      if (user) {
        const formatChannels = (user.friends || []).map(fName => ({ name: fName, isGroup: false }));
        socket.emit('dashboard_sync', {
          username: user.username,
          channels: formatChannels,
          requests: user.requests || []
        });
      }
    } catch (err) {
      console.error("Dashboard database sync warning:", err);
    }
  });

  // 🚀 REALTIME MESSAGE PIPELINE
  socket.on('private_message', async (data) => {
    try {
      if (data.receiver === "GLOBAL_BROADCAST" && data.sender.startsWith("CREATOR_RED")) {
        io.emit('new_message', {
          sender: "CREATOR_RED (ADMIN)",
          receiver: "GLOBAL_BROADCAST",
          message: data.message,
          fileData: null,
          fileType: null,
          fileName: null
        });
        return;
      }

      const newMessage = new Message({
        sender: data.sender,
        receiver: data.receiver,
        message: data.message || "",
        fileData: data.fileData || null,
        fileType: data.fileType || null,
        fileName: data.fileName || null,
        isGroupChat: data.isGroupChat || false
      });
      await newMessage.save();

      if (data.isGroupChat) {
        io.to(data.receiver).emit('new_message', newMessage);
      } else {
        io.to(data.receiver).emit('new_message', newMessage);
        io.to(data.sender).emit('new_message', newMessage); 
      }
    } catch (err) {
      console.error("Message save error:", err);
    }
  });

  socket.on('typing_status', (data) => {
    socket.to(data.receiver).emit('peer_typing', { sender: data.sender, isTyping: data.isTyping });
  });

  socket.on('trigger_wipe', (data) => {
    io.to(data.receiver).emit('chat_wiped', { isGroup: data.isGroupChat, receiver: data.receiver, wipedBy: data.sender });
  });

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

// 🌐 ENGINE START-UP CONTROL
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Blue Rocket Server running smoothly on port ${PORT} 🚀`));
