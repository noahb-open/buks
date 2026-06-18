const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  sender: { type: String, required: true },
  receiver: { type: String, default: null }, // Null if it's a group message
  groupId: { type: String, default: null },   // 🚀 NEW: Links to a group chat room
  message: { type: String, default: "" }, 
  fileData: { type: String, default: null }, 
  fileType: { type: String, default: null }, 
  fileName: { type: String, default: null }, 
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Message', MessageSchema);
