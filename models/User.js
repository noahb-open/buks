const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isVerified: { type: Boolean, default: false },
  friends: { type: [String], default: [] },
  requests: { type: [String], default: [] },
  // 👥 CRITICAL: Must be structured exactly like this to hold pending room values
  groupRequests: [{
    groupId: String,
    groupName: String,
    invitedBy: String
  }]
});
