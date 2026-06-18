const mongoose = require('mongoose');

const GroupSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  creator: { type: String, required: true },
  members: [{ type: String }],
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Group', GroupSchema);
