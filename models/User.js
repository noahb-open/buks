const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isVerified: { type: Boolean, default: false },
  verificationCode: { type: String },
  friends: { type: [String], default: [] },  
  requests: { type: [String], default: [] }  
});

module.exports = mongoose.model('User', UserSchema);
