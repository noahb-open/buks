require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const User = require('./models/User');
const Message = require('./models/Message');
const Group = require('./models/Group'); // 🚀 NEW: Import group schema

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

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

// 🚀 NEW: DATABASE GROUP CREATION ROUTE
app.post('/api/groups/create', async (req, res) => {
  try {
    const { name, creator } = req.body;
    const groupId = 'group_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now().toString().slice(-4);
    
    const newGroup = new Group({ name, groupId, creator, members: [creator] });
    await newGroup.save();
    
    res.status(201).json({ success: true, group: newGroup });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 🚀 NEW: CREATOR-ONLY INVITE ROUTE
app.post('/api/groups/invite', async (req, res) => {
  try {
    const { groupId, creatorUsername, targetUsername } = req.body;
    const group = await Group.findOne({ groupId });
    
    if (!group) return res.status(404).json({ error: "Group not found." });
    if (group.creator !== creatorUsername) return res.status(403).json({ error: "🔒 Access Denied: Only the group creator can invite members!" });

    const targetUser = await User.findOne({ username: targetUsername });
    if (!targetUser) return res.status(404).json({ error: "User does not exist. Check spelling!" });

    if (group.members.includes(targetUsername)) return varStatus(400).json({ error: "User is already a member!" });

    group.members.push(targetUsername);
    await group.save();

    // Signal invitee in real time via sockets
    io.to(targetUsername).emit('group_invite_received', { groupId, groupName: group.name });

    res.json({ success: true, message: "Target user bridged into channel successfully!" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. FETCH FRIEND LIST AND REQUESTS ROUTE (Expanded to return DB Groups too)
app.get('/api/friends-data/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    const groups = await Group.find({ members: req.params.username });
    
    res.json({
      friends: user && user.friends ? user.friends : [],
      requests: user && user.requests ? user.requests : [],
      groups: groups || [] // Return database verified group arrays
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 6. FETCH CHAT HISTORY
app.get('/api/messages/:user1/:user2', async (req, res) => {
  try {
    const { user1, user2 } = req.params;
    let query = user2.startsWith('group_') ? { receiver: user2 } : { $or: [{ sender: user1, receiver: user2 }, { sender: user2, receiver: user1 }] };
    const history = await Message.find(query).sort({ timestamp: 1 });
    res.json(history);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 7. WIPE CHAT HISTORY ROUTE
app.post('/api/messages/delete', async (req, res) => {
  try {
    const { sender, receiver } = req.body;
    if (receiver.startsWith('group_')) {
      await Message.deleteMany({ receiver: receiver });
    } else {
      await Message.deleteMany({ $or: [{ sender, receiver }, { sender: receiver, receiver: sender }] });
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// REAL-TIME WEBSOCKET PIPELINE
io.on('connection', (socket) => {
  socket.on('join', (roomName) => socket.join(roomName));
  
  socket.on('private_message', async (data) => {
    const { sender, receiver, message, fileData, fileType, fileName, isGroupChat } = data;
    try {
      const record = new Message({ sender, receiver, message: message || "", fileData: fileData || null, fileType: fileType || null, fileName: fileName || null });
      await record.save();
      
      if (isGroupChat) {
        io.to(receiver).emit('new_message', { sender, receiver, message, fileData, fileType, fileName, isGroup: true });
      } else {
        io.to(receiver).emit('new_message', { sender, message, fileData, fileType, fileName, isGroup: false });
      }
    } catch (err) { console.error(err); }
  });

  socket.on('typing_status', (data) => {
  const { sender, receiver } = data;
  socket.to(receiver).emit('peer_typing', data);
});

socket.on('trigger_wipe', (data) => {
  const { receiver } = data;
  io.to(receiver).emit('chat_wiped', data);
});

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Active on port ${PORT}`));
