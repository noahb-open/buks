const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  sender: { type: String, required: true },
  receiver: { type: String, required: true }, // Serves as the target username OR the group_id string
  message: { type: String, default: "" }, 
  fileData: { type: String, default: null }, 
  fileType: { type: String, default: null }, 
  fileName: { type: String, default: null }, 
  isGroupChat: { type: Boolean, default: false } // Matches your server.js model instantiation
}, { 
  timestamps: true // This automatically adds perfect createdAt and updatedAt fields for your sorting hooks!
});

module.exports = mongoose.model('Message', MessageSchema);
