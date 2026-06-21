require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const path = require('path');

const User = require('./models/User');
const Message = require('./models/Message');
const Group = require('./models/Group'); 

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public')); 

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error(err));

let onlineUsers = new Map(); 

const transporter = nodemailer.createTransport({
  host: 'messa.up.railway.app',
  port: 2525,
  secure: false, 
  auth: {
    user: 'your_smtp_username_here', 
    pass: 'your_smtp_password_here'  
  }
});

async function getUserChannels(username) {
  const userRecord = await User.findOne({ username: username });
  if (!userRecord) return [];

  const directChannels = (userRecord.friends || []).map(fName => ({ name: fName, isGroup: false }));

  const individualGroups = await Group.find({ members: userRecord.username });
  const groupChannels = individualGroups.map(g => ({ name: g.groupId, isGroup: true }));

  return [...directChannels, ...groupChannels];
}

async function pushDashboardSync(username) {
  const user = await User.findOne({ username: username });
  if (!user) return;

  const combinedChannels = await getUserChannels(user.username);
  io.to(user.username).emit('dashboard_sync', {
    username: user.username,
    channels: combinedChannels,
    requests: user.requests || [],
    groupRequests: user.groupRequests || []
  });
}

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

function requireAdminAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.split(' ')[1] || req.query.token;
    if (!token) return res.status(401).send('<h1>Access Denied</h1><p>Missing structural session validation token.</p>');

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    User.findById(decoded.id).then(user => {
      if (user && user.username === "CREATOR_RED") {
        req.user = user;
        return next();
      }
      return res.status(403).send('<h1>Forbidden</h1><p>Unauthorized platform credentials context.</p>');
    });
  } catch (err) {
    return res.status(401).send('<h1>Session Expired</h1><p>Please log back into your node gateway.</p>');
  }
}

app.get('/admin/terminal', requireAdminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'creator.html'));
});

app.post('/api/signup', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    const existing = await User.findOne({ $or: [{ email: email }, { username: username }] });
    if (existing) return res.status(400).json({ error: 'Username or Email already taken' });

    const dynamicTokenCode = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({ 
      username: username, 
      email: email, 
      password: hashedPassword, 
      verificationCode: dynamicTokenCode, 
      friends: [], 
      requests: [], 
      groupRequests: [] 
    });
    await newUser.save();

    const mailOptions = {
      from: '"Blue Rocket Core" <no-reply@messa.up.railway.app>',
      to: email,
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
      if (error) console.error(error);
      console.log(`Fallback debug access key token for dev runtime testing [${email}]: ${dynamicTokenCode}`);
    });

    res.status(201).json({ message: 'User verification frame staged.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/verify', async (req, res) => {
  try {
    const { email, code } = req.body;
    const user = await User.findOne({ email: email });

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

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email });
    
    if (!user) return res.status(404).json({ success: false, message: 'User matching credentials not found.' });
    if (!user.isVerified) return res.status(401).json({ success: false, message: 'Verify account node first.' });

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) return res.status(400).json({ success: false, message: 'Wrong credentials.' });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, username: user.username });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/friends-data/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    if (!user) return res.status(404).json({ error: "User records missing." });
    
    res.json({
      friends: user.friends || [],
      requests: user.requests || [],
      groupRequests: user.groupRequests || []
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/messages/:me/:peer', async (req, res) => {
  try {
    const { me, peer } = req.params;
    let query;

    if (peer.startsWith('group_')) {
      query = { receiver: peer, isGroupChat: true };
    } else {
      query = {
        $or: [
          { sender: me, receiver: peer, isGroupChat: false },
          { sender: peer, receiver: me, isGroupChat: false }
        ]
      };
    }

    const logs = await Message.find(query).sort({ createdAt: 1 }).limit(150);
    res.json(logs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/friends/request', async (req, res) => {
  try {
    const { myUsername, friendUsername } = req.body;

    if (myUsername === friendUsername) return res.status(400).json({ error: "Cannot add yourself." });

    const target = await User.findOne({ username: friendUsername });
    if (!target) return res.status(404).json({ error: "Target profile node does not exist." });

    const me = await User.findOne({ username: myUsername });
    if (me.friends.includes(friendUsername)) return res.status(400).json({ error: "Already friends." });
    if (target.requests.includes(myUsername)) return res.status(400).json({ error: "Request already processing." });

    target.requests.push(myUsername);
    await target.save();

    await pushDashboardSync(target.username);
    res.json({ success: true, message: "Request mapped successfully." });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/friends/accept', async (req, res) => {
  try {
    const { myUsername, requesterUsername } = req.body;

    const me = await User.findOne({ username: myUsername });
    const requester = await User.findOne({ username: requesterUsername });

    if (!me || !requester) return res.status(404).json({ error: "Data frames disconnected." });

    me.requests = me.requests.filter(name => name !== requesterUsername);
    if (!me.friends.includes(requesterUsername)) me.friends.push(requesterUsername);
    if (!requester.friends.includes(myUsername)) requester.friends.push(myUsername);

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
    const me = await User.findOne({ username: myUsername });
    if (!me) return res.status(404).json({ error: "User records missing." });

    me.requests = me.requests.filter(name => name !== requesterUsername);
    await me.save();

    await pushDashboardSync(me.username);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/groups/create', async (req, res) => {
  try {
    const { name, creator } = req.body;
    if (!name || !creator) return res.status(400).json({ error: "Parameters truncated." });

    const groupId = 'group_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now().toString().slice(-4);
    const newGroup = new Group({ name, groupId, creator: creator, members: [creator], invites: [] });
    await newGroup.save();

    await pushDashboardSync(creator);
    res.status(201).json({ success: true, group: newGroup });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/groups/invite', async (req, res) => {
  try {
    const { groupId, creatorUsername, targetUsername } = req.body;

    const group = await Group.findOne({ groupId });
    if (!group) return res.status(404).json({ error: "Room not found." });
    if (group.creator !== creatorUsername) return res.status(403).json({ error: "Creator scope constraint violation." });

    const targetUser = await User.findOne({ username: targetUsername });
    if (!targetUser) return res.status(404).json({ error: "Target node unknown." });

    if (group.members.includes(targetUsername)) return res.status(400).json({ error: "User active inside channel." });
    if (group.invites.includes(targetUsername)) return res.status(400).json({ error: "Invite sequence already processing." });

    await Group.updateOne({ groupId }, { $addToSet: { invites: targetUsername } });
    await User.updateOne({ username: targetUsername }, { 
      $addToSet: { groupRequests: { groupId, groupName: group.name, invitedBy: creatorUsername } } 
    });

    await pushDashboardSync(targetUsername);
    res.json({ success: true, message: "Invitation pending user acceptance!" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/groups/accept', async (req, res) => {
  try {
    const { myUsername, groupId } = req.body;

    const group = await Group.findOne({ groupId });
    if (!group) return res.status(404).json({ error: "Group missing." });

    await User.updateOne({ username: myUsername }, { $pull: { groupRequests: { groupId } } });
    await Group.updateOne({ groupId }, { $pull: { invites: myUsername }, $addToSet: { members: myUsername } });

    io.to(groupId).emit('incoming_group_request'); 
    await pushDashboardSync(myUsername);

    res.json({ success: true, groupName: group.name, groupId: group.groupId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/groups/decline', async (req, res) => {
  try {
    const { myUsername, groupId } = req.body;

    await User.updateOne({ username: myUsername }, { $pull: { groupRequests: { groupId } } });
    await Group.updateOne({ groupId }, { $pull: { invites: myUsername } });

    await pushDashboardSync(myUsername);
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

io.on('connection', (socket) => {
  let boundSessionUser = null;

  socket.on('join', async (username) => {
    if (!username) return;
    boundSessionUser = username; 
    
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
      const targetSocketId = onlineUsers.get(data.receiver);
      if (targetSocketId) io.to(targetSocketId).emit('typing_status', data);
    }
  });

  socket.on('private_message', async (payload) => {
    try {
      const author = payload.sender;
      const destination = payload.receiver.trim();

      if (destination === "GLOBAL_BROADCAST" && author === "CREATOR_RED") {
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
        receiver: destination,
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
        const recipientSocket = onlineUsers.get(destination);
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
server.listen(PORT, () => console.log(`Engine live running on layout node port: ${PORT}`));
