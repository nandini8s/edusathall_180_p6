const mongoose = require("mongoose");

async function connectDB(uri = process.env.MONGO_URI) {
  if (!uri) {
    throw new Error("MONGO_URI is not configured");
  }
  await mongoose.connect(uri);
  console.log("MongoDB Connected Successfully!");
  return mongoose.connection;
}

module.exports = { connectDB };
