const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  sender: { type: String, required: true },
  receiver: { type: String, required: true },
  message: { type: String, default: "" }, // Keep blank if just sending a picture
  fileData: { type: String, default: null }, // 🚀 NEW: Holds the Base64 image/file string data
  fileType: { type: String, default: null }, // 🚀 NEW: e.g., 'image/png', 'application/pdf'
  fileName: { type: String, default: null }, // 🚀 NEW: original name of uploaded file
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Message', MessageSchema);
