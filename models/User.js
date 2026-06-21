const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: { 
    type: String, 
    required: true, 
    unique: true,
    trim: true,
    lowercase: true, // Forces "CREATOR_RED" to save as "creator_red" cleanly
    index: true 
  },
  email: { 
    type: String, 
    required: true, 
    unique: true,
    trim: true,
    lowercase: true // Normalizes emails across different signup/login attempts
  },
  password: { 
    type: String, 
    required: true 
  },
  isVerified: { 
    type: Boolean, 
    default: false 
  },
  verificationCode: {
    type: String,
    default: null // Temporarily holds the 6-digit MailerSend key string
  },
  friends: { 
    type: [String], 
    default: [] 
  },
  requests: { 
    type: [String], 
    default: [] 
  },
  groupRequests: [{
    groupId: { type: String, required: true },
    groupName: { type: String, required: true },
    invitedBy: { type: String, required: true }
  }]
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
