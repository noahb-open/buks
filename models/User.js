const mongoose = require('mongoose'); // 🚀 FIXED: Added the missing import line

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isVerified: { type: Boolean, default: false },
  friends: { type: [String], default: [] },
  requests: { type: [String], default: [] },
  groupRequests: [{
    groupId: String,
    groupName: String,
    invitedBy: String
  }]
});

module.exports = mongoose.model('User', UserSchema);
