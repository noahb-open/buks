const mongoose = require('mongoose');

const GroupSchema = new mongoose.Schema({
  name: { type: String, required: true },
  groupId: { type: String, required: true, unique: true }, // e.g., 'group_rocket_squad'
  creator: { type: String, required: true },
  members: [{ type: String }] // Array of usernames allowed inside
});

module.exports = mongoose.model('Group', GroupSchema);
