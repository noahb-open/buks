const mongoose = require('mongoose');

const GroupSchema = new mongoose.Schema({
  name: { type: String, required: true },
  groupId: { type: String, required: true, unique: true },
  creator: { type: String, required: true },
  members: [{ type: String }],  // Users who are active members
  invites: [{ type: String }]   // 👥 NEW: Users who have a pending invite
}, { timestamps: true });

module.exports = mongoose.model('Group', GroupSchema);
