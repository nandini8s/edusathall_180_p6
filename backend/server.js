require("dotenv").config();

const { createApp } = require("./app");
const { connectDB } = require("./config/db");
const { ensureConfiguredHandlers } = require("./services/handlerService");
const app = createApp();
const PORT = process.env.PORT || 5000;

async function start() {
  try {
    await connectDB();
    await ensureConfiguredHandlers();
  } catch (error) {
    console.error("MongoDB connection error:", error.message);
  }
  return app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
}

if (require.main === module) start();

module.exports = { app, start };
