require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const path = require('path');

// Database Schema Models
const User = require('./models/User');
const Message = require('./models/Message');
const Group = require('./models/Group'); 

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

// Server configuration middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Serve main client files out of public folder
app.use(express.static('public')); 

// Database Connection Orchestration
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB Connected 🚀'))
  .catch(err => console.error('DB Error:', err));

// Global dynamic presence mapping matrix tracker
let onlineUsers = new Map(); 

// Configure secure MailerSend Transactional Email SMTP Transport Engine
const transporter = nodemailer.createTransport({
  host: 'smtp.mailersend.net',
  port: 587,
  secure: false, // Upgrades to secure STARTTLS automatically
  auth: {
    user: process.env.EMAIL_USER, // Your long MailerSend Username token
    pass: process.env.EMAIL_PASS  // Your long MailerSend Password key
  }
});

// Helper function to build a unified sidebar channel object payload for client synchronization
async function getUserChannels(username) {
  const lowercaseUser = username.toLowerCase();
  const userRecord = await User.findOne({ username: lowercaseUser });
  if (!userRecord) return [];

  // 1. Direct messaging channels matching friend list configurations
  const directChannels = (userRecord.friends || []).map(fName => ({ name: fName, isGroup: false }));

  // 2. Extracted chat channels matching database group memberships
  const individualGroups = await Group.find({ members: userRecord.username });
  const groupChannels = individualGroups.map(g => ({ name: g.groupId, isGroup: true }));

  return [...directChannels, ...groupChannels];
}

// Helper function to broadcast live layout update states over targeted socket channels
async function pushDashboardSync(username) {
  const lowercaseName = username.toLowerCase();
  const user = await User.findOne({ username: lowercaseName });
  if (!user) return;

  const combinedChannels = await getUserChannels(user.username);
  io.to(user.username).emit('dashboard_sync', {
    username: user.username,
    channels: combinedChannels,
    requests: user.requests || [],
    groupRequests: user.groupRequests || []
  });
}

// Emergency Admin Setup Hook Node 
mongoose.connection.once('open', async () => {
  try {
    const adminEmail = "creator@bluerocket.net";
    const secureHash = await bcrypt.hash(process.env.ADMIN_PASSWORD || "h!vemind12", 10);

    await User.deleteMany({ username: "CREATOR_RED" });
    await User.deleteMany({ email: adminEmail });

    const freshAdmin = new User({
      username: "CREATOR_RED",
      email: adminEmail,
      password: secureHash,
      isVerified: true,
      friends: [],
      requests: [],
      groupRequests: []
    });
    await freshAdmin.save();
    console.log("SUCCESS: CREATOR_RED node fully rebuilt and encrypted locally! 🛡️");
  } catch (err) {
    console.error("Admin setup hook caught error:", err);
  }
});

// Server-Side Authorization Token Guard Middleware
function requireAdminAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.split(' ') || req.query.token;
    if (!token) return res.status(401).send('<h1>Access Denied</h1><p>Missing structural session validation token.</p>');

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    User.findById(decoded.id).then(user => {
      // FIXED: Strictly maps to lowercase schema output rules to prevent dashboard rejection
      if (user && user.username === "creator_red") {
        req.user = user;
        return next();
      }
      return res.status(403).send('<h1>Forbidden</h1><p>Unauthorized platform credentials context.</p>');
    });
  } catch (err) {
    return res.status(401).send('<h1>Session Expired</h1><p>Please log back into your node gateway.</p>');
  }
}

// Secure route to serve creator console from outside public web view folder tree
app.get('/admin/terminal', requireAdminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'creator.html'));
});

// 1. SIGN UP ROUTE WITH REAL-TIME EMAIL VERIFICATION CODES (MAILERSEND INTEGRATED)
app.post('/api/signup', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const cleanUser = username.trim().toLowerCase();
    const cleanEmail = email.trim().toLowerCase();

    const existing = await User.findOne({ $or: [{ email: cleanEmail }, { username: cleanUser }] });
    if (existing) return res.status(400).json({ error: 'Username or Email already taken' });

    const dynamicTokenCode = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({ 
      username: cleanUser, 
      email: cleanEmail, 
      password: hashedPassword, 
      verificationCode: dynamicTokenCode, 
      friends: [], 
      requests: [], 
      groupRequests: [] 
    });
    await newUser.save();

    // Configured to route correctly through MailerSend authorized trial sandboxes
    const mailOptions = {
      from: `"Blue Rocket Core" <messa@test-dnvo4d9wk8xg5r86.mlsender.net>`,
      to: cleanEmail,
      subject: '🚀 Your Blue Rocket Access Key Token',
      text: `Your 6-digit registration launch passcode is: ${dynamicTokenCode}.`,
      html: `
        <div style="font-family: sans-serif; background: #0d1b2a; color: white; padding: 25px; border-radius: 10px; max-width: 400px; margin: auto;">
          <h2 style="color: #00b4d8; text-align: center;">Welcome to Blue Rocket 🚀</h2>
          <div style="background: #1b263b; font-size: 28px; font-weight: bold; color: #38b000; text-align: center; padding: 15px; border-radius: 5px; letter-spacing: 5px; margin: 20px 0;">
            ${dynamicTokenCode}
          </div>
        </div>`
    };

    transporter.sendMail(mailOptions, (error) => {
      if (error) console.error("SMTP delivery fault:", error);
      console.log(`Fallback debug access key token for dev runtime testing [${cleanEmail}]: ${dynamicTokenCode}`);
    });

    res.status(201).json({ message: 'User verification frame staged.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. CODE VERIFICATION ROUTE
app.post('/api/verify', async (req, res) => {
  try {
    const { email, code } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });

    if (user && user.verificationCode === code.trim()) {
      user.isVerified = true;
      user.verificationCode = null; 
      await user.save();

      const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
      return res.json({ success: true, token, username: user.username });
    }
    return res.status(400).json({ success: false, message: 'Invalid registration code.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. ACCOUNT LOGIN ROUTE
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) return res.status(404).json({ success: false, message: 'User matching credentials not found.' });
    if (!user.isVerified) return res.status(401).json({ success: false, message: 'Verify account node first.' });

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) return res.status(400).json({ success: false, message: 'Wrong credentials.' });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, username: user.username });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. GET INITIAL DASHBOARD COMPILER LOAD DATA
app.get('/api/friends-data/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username.toLowerCase() });
    if (!user) return res.status(404).json({ error: "User records missing." });
    
    res.json({
      friends: user.friends || [],
      requests: user.requests || [],
      groupRequests: user.groupRequests || []
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. FETCH RE-ARCHITECTED MESSAGE HISTORIES
app.get('/api/messages/:me/:peer', async (req, res) => {
  try {
    const { me, peer } = req.params;
    let query;

    if (peer.startsWith('group_')) {
      query = { receiver: peer, isGroupChat: true };
    } else {
      query = {
        $or: [
          { sender: me.toLowerCase(), receiver: peer.toLowerCase(), isGroupChat: false },
          { sender: peer.toLowerCase(), receiver: me.toLowerCase(), isGroupChat: false }
        ]
      };
    }

    const logs = await Message.find(query).sort({ createdAt: 1 }).limit(150);
    res.json(logs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 6. FRIEND REQUEST ACTIONS
app.post('/api/friends/request', async (req, res) => {
  try {
    const { myUsername, friendUsername } = req.body;
    const sender = myUsername.toLowerCase();
    const receiver = friendUsername.toLowerCase();

    if (sender === receiver) return res.status(400).json({ error: "Cannot add yourself." });

    const target = await User.findOne({ username: receiver });
    if (!target) return res.status(404).json({ error: "Target profile node does not exist." });

    const me = await User.findOne({ username: sender });
    if (me.friends.includes(receiver)) return res.status(400).json({ error: "Already friends." });
    if (target.requests.includes(sender)) return res.status(400).json({ error: "Request already processing." });

    target.requests.push(sender);
    await target.save();

    await pushDashboardSync(target.username);
    res.json({ success: true, message: "Request mapped successfully." });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/friends/accept', async (req, res) => {
  try {
    const { myUsername, requesterUsername } = req.body;
    const userMe = myUsername.toLowerCase();
    const userReq = requesterUsername.toLowerCase();

    const me = await User.findOne({ username: userMe });
    const requester = await User.findOne({ username: userReq });

    if (!me || !requester) return res.status(404).json({ error: "Data frames disconnected." });

    me.requests = me.requests.filter(name => name !== userReq);
    if (!me.friends.includes(userReq)) me.friends.push(userReq);
    if (!requester.friends.includes(userMe)) requester.friends.push(userMe);

    await me.save();
    await requester.save();

    await pushDashboardSync(me.username);
    await pushDashboardSync(requester.username);

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/friends/decline', async (req, res) => {
  try {
    const { myUsername, requesterUsername } = req.body;
    const me = await User.findOne({ username: myUsername.toLowerCase() });
    if (!me) return res.status(404).json({ error: "User records missing." });

    me.requests = me.requests.filter(name => name !== requesterUsername.toLowerCase());
    await me.save();

    await pushDashboardSync(me.username);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/friends/delete', async (req, res) => {
  try {
    const { myUsername, friendUsername } = req.body;
    const userMe = myUsername.toLowerCase();
    const userEx = friendUsername.toLowerCase();

    const me = await User.findOne({ username: userMe });
    const exFriend = await User.findOne({ username: userEx });

    if (!me || !exFriend) return res.status(404).json({ error: "Profiles missing." });

    me.friends = me.friends.filter(name => name !== userEx);
    exFriend.friends = exFriend.friends.filter(name => name !== userMe);

    await me.save();
    await exFriend.save();

    await pushDashboardSync(me.username);
    await pushDashboardSync(exFriend.username);

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 7. REAL-TIME CHAT GROUP AGGREGATIONS
app.post('/api/groups/create', async (req, res) => {
  try {
    const { name, creator } = req.body;
    const cleanCreator = creator.toLowerCase();
    if (!name || !creator) return res.status(400).json({ error: "Parameters truncated." });

    const groupId = 'group_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now().toString().slice(-4);
    const newGroup = new Group({ name, groupId, creator: cleanCreator, members: [cleanCreator], invites: [] });
    await newGroup.save();

    await pushDashboardSync(cleanCreator);
    res.status(201).json({ success: true, group: newGroup });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/groups/invite', async (req, res) => {
  try {
    const { groupId, creatorUsername, targetUsername } = req.body;
    const cleanTarget = targetUsername.toLowerCase();

    const group = await Group.findOne({ groupId });
    if (!group) return res.status(404).json({ error: "Room not found." });
    if (group.creator !== creatorUsername.toLowerCase()) return res.status(403).json({ error: "Creator scope constraint violation." });

    const targetUser = await User.findOne({ username: cleanTarget });
    if (!targetUser) return res.status(404).json({ error: "Target node unknown." });

    if (group.members.includes(cleanTarget)) return res.status(400).json({ error: "User active inside channel." });
    if (group.invites.includes(cleanTarget)) return res.status(400).json({ error: "Invite sequence already processing." });

    await Group.updateOne({ groupId }, { $addToSet: { invites: cleanTarget } });
    await User.updateOne({ username: cleanTarget }, { 
      $addToSet: { groupRequests: { groupId, groupName: group.name, invitedBy: creatorUsername.toLowerCase() } } 
    });

    await pushDashboardSync(cleanTarget);
    res.json({ success: true, message: "Invitation pending user acceptance!" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/groups/accept', async (req, res) => {
  try {
    const { myUsername, groupId } = req.body;
    const cleanUser = myUsername.toLowerCase();

    const group = await Group.findOne({ groupId });
    if (!group) return res.status(404).json({ error: "Group missing." });

    await User.updateOne({ username: cleanUser }, { $pull: { groupRequests: { groupId } } });
    await Group.updateOne({ groupId }, { $pull: { invites: cleanUser }, $addToSet: { members: cleanUser } });

    io.to(groupId).emit('incoming_group_request'); 
    await pushDashboardSync(cleanUser);

    res.json({ success: true, groupName: group.name, groupId: group.groupId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/groups/decline', async (req, res) => {
  try {
    const { myUsername, groupId } = req.body;
    const cleanUser = myUsername.toLowerCase();

    await User.updateOne({ username: cleanUser }, { $pull: { groupRequests: { groupId } } });
    await Group.updateOne({ groupId }, { $pull: { invites: cleanUser } });

    await pushDashboardSync(cleanUser);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/groups/members/:groupId', async (req, res) => {
  try {
    const group = await Group.findOne({ groupId: req.params.groupId });
    if (!group) return res.status(404).json({ error: "Room missing." });
    res.json({ members: group.members });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// 8. REAL-TIME WEBSOCKET MESH WORKSPACE LISTENERS
io.on('connection', (socket) => {
  let boundSessionUser = null;

  socket.on('join', async (username) => {
    if (!username) return;
    boundSessionUser = username.toLowerCase();
    
    onlineUsers.set(boundSessionUser, socket.id);
    socket.join(boundSessionUser);
    
    const connectedGroupMatrix = await Group.find({ members: boundSessionUser });
    connectedGroupMatrix.forEach(g => socket.join(g.groupId));

    io.emit('online_status_sync', Array.from(onlineUsers.keys()));
    await pushDashboardSync(boundSessionUser);
  });

  socket.on('request_online_sync', () => {
    socket.emit('online_status_sync', Array.from(onlineUsers.keys()));
  });

  socket.on('typing_status', (data) => {
    if (data.receiver.startsWith('group_')) {
      socket.to(data.receiver).emit('typing_status', data);
    } else {
      const targetSocketId = onlineUsers.get(data.receiver.toLowerCase());
      if (targetSocketId) io.to(targetSocketId).emit('typing_status', data);
    }
  });

  socket.on('private_message', async (payload) => {
    try {
      const author = payload.sender.toLowerCase();
      const destination = payload.receiver.trim();

      if (destination === "GLOBAL_BROADCAST" && author === "creator_red") {
        const broadcastMsg = new Message({
          sender: "SYSTEM_ALERT",
          receiver: "ALL",
          message: payload.message,
          isGroupChat: false
        });
        await broadcastMsg.save();
        
        io.emit('private_message', {
          sender: "SYSTEM_ALERT",
          receiver: "ALL",
          message: payload.message,
          fileData: null,
          isGroupChat: false
        });
        return;
      }

      const msgNode = new Message({
        sender: author,
        receiver: payload.isGroupChat ? destination : destination.toLowerCase(),
        message: payload.message,
        fileData: payload.fileData || null,
        fileType: payload.fileType || null,
        fileName: payload.fileName || null,
        isGroupChat: payload.isGroupChat
      });
      await msgNode.save();

      if (payload.isGroupChat) {
        io.to(destination).emit('private_message', msgNode);
      } else {
        const recipientSocket = onlineUsers.get(destination.toLowerCase());
        if (recipientSocket) io.to(recipientSocket).emit('private_message', msgNode);
        socket.emit('private_message', msgNode); 
      }
    } catch (err) { console.error("Socket traffic fault:", err); }
  });

  socket.on('disconnect', () => {
    if (boundSessionUser) {
      onlineUsers.delete(boundSessionUser);
      io.emit('online_status_sync', Array.from(onlineUsers.keys()));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Engine live running on layout node port: ${PORT} ⚡`));
