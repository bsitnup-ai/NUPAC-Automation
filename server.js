import express from "express";
import { exec } from "child_process";

const app = express();

// ---- KEEP-ALIVE ENDPOINT ----
app.get("/", (req, res) => {
  res.send("✅ WhatsApp bot running - " + new Date().toISOString());
});

// ---- START YOUR BOT ----
const bot = exec("npm start", { stdio: "inherit" });

bot.on("exit", (code) => {
  console.error(`Bot exited with code ${code}`);
});

// ---- RUN EXPRESS ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
