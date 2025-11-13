// index.js
require('dotenv').config();
const express = require('express');
const qrcode = require('qrcode');
const { Client, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');
const { Low, JSONFile } = require('lowdb');
const { join } = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const google = require('googlethis');
const yts = require('yt-search');
const fs = require('fs');
const stringSimilarity = require('string-similarity');

const app = express();
let qrCodeData = null;

// Global cooldown tracker (in-memory, survives restarts via LowDB if needed)
global.geminiCooldowns = {};

// -------------------------------------------------
// 1. LOWDB SETUP
// -------------------------------------------------
const file = join(__dirname, 'db.json');
const adapter = new JSONFile(file);
const db = new Low(adapter);

async function initDB() {
  await db.read();
  db.data ||= { actions: [], users: {}, groups: {} };
  await db.write();
}

// -------------------------------------------------
// 2. GEMINI CLIENT (FREE 2.5 FLASH – v1 endpoint auto-selected)
// -------------------------------------------------
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({
  model: 'models/gemini-2.5-flash',
  safetySettings: [
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  ],
});

// Enhanced Gemini call with retry + cooldown
async function safeGeminiCall(prompt, maxRetries = 2, userId = null) {
  const now = Date.now();
  const cooldownKey = `gemini_cooldown_${userId}`;

  // Cooldown: 8 seconds between requests per user
  if (userId && global.geminiCooldowns[cooldownKey] && now - global.geminiCooldowns[cooldownKey] < 8000) {
    return { skip: true, cooldown: true };
  }

  for (let i = 0; i <= maxRetries; i++) {
    try {
      const result = await geminiModel.generateContent(prompt);
      const text = result.response.text();
      if (userId) global.geminiCooldowns[cooldownKey] = now;
      return { success: true, text };
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('503') || msg.includes('overloaded') || msg.includes('RATE_LIMIT')) {
        if (i === maxRetries) {
          console.log(`Gemini 503 – giving up after ${maxRetries + 1} attempts`);
          return { skip: true };
        }
        const delay = 1500 * (i + 1);
        console.log(`Gemini 503 – retry ${i + 1}/${maxRetries} in ${delay}ms…`);
        await new Promise(r => setTimeout(r, delay));
      } else if (msg.includes('SAFETY') || msg.includes('blocked')) {
        return { blocked: true };
      } else {
        console.log('Gemini error:', msg);
        return { skip: true };
      }
    }
  }
  return { skip: true };
}

// -------------------------------------------------
// 3. PROFANITY LIST
// -------------------------------------------------
const badWords = [
  'g***', 's***', 'b***', 'fuck', 'shit',
  'gali', 'lanat', 'haram', 'chutiya',
  'kutte', 'madarchod', 'گالی', 'حرام', 'گالی دینا'
];
function containsProfanity(text) {
  if (!text) return false;
  return badWords.some(w => text.toLowerCase().includes(w));
}

// -------------------------------------------------
// 4. QA DOCUMENT (loaded once)
// -------------------------------------------------
let qaPairs = [];
try {
  const raw = fs.readFileSync(join(__dirname, 'qa_pairs.json'), 'utf8');
  qaPairs = JSON.parse(raw);
  console.log(`Loaded ${qaPairs.length} QA pairs from qa_pairs.json`);
} catch (e) {
  console.error('Could not load qa_pairs.json – !info disabled', e.message);
}

function findBestMatch(userQuestion) {
  if (!qaPairs.length) return { bestMatch: null, rating: 0 };
  const questions = qaPairs.map(q => q.question);
  const { bestMatchIndex, rating } = stringSimilarity.findBestMatch(userQuestion, questions);
  return { bestMatch: qaPairs[bestMatchIndex], rating };
}

async function generateSmartAnswer(userQuestion) {
  const { bestMatch, rating } = findBestMatch(userQuestion);
  let prompt;

  if (bestMatch && rating > 0.55) {
    prompt = `
You are a university-help assistant. Answer **only** using the supplied document.
Relevant Q/A:
Q: ${bestMatch.question}
A: ${bestMatch.answer}

User asked: "${userQuestion}"
Rephrase the answer naturally, keep it short, and do NOT add external info.
If unsure, say: "I only know what is in the document."
`;
  } else {
    prompt = `User asked: "${userQuestion}"\nNo matching document entry. Reply exactly: "I couldn’t find that information in the provided document."`;
  }

  const res = await safeGeminiCall(prompt);
  return res.text?.trim() || 'I couldn’t find that information in the provided document.';
}

// -------------------------------------------------
// 5. MAIN STARTUP
// -------------------------------------------------
(async () => {
  try {
    await initDB();
    console.log('LowDB ready');

    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB connected');
    await new Promise(r => setTimeout(r, 2000));

    const CLIENT_ID = 'nupac-bot';
    const store = new MongoStore({ mongoose, clientId: CLIENT_ID });

    const client = new Client({
      authStrategy: new RemoteAuth({
        store,
        backupSyncIntervalMs: 300_000,
        clientId: CLIENT_ID
      }),
puppeteer: {
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-zygote',
    '--single-process',
  ],
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium'
}


    });

    // Events
    client.on('remote_session_saved', () => console.log('Session SAVED to MongoDB!'));
    client.on('authenticated', () => console.log('Session RESTORED from MongoDB!'));
    client.on('qr', async qr => {
      console.log('QR Needed – session NOT restored');
      qrCodeData = await qrcode.toDataURL(qr);
      console.log('Scan at http://localhost:3000/qr');
    });
    client.on('ready', () => {
      console.log('WhatsApp client ready!');
      qrCodeData = null;
    });
    client.on('disconnected', reason => {
      console.log('Disconnected:', reason);
      setTimeout(() => client.initialize(), 10_000);
    });

    // -------------------------------------------------
    // MESSAGE HANDLER
    // -------------------------------------------------
    client.on('message', async message => {
      try {
        if (message.fromMe) return;

        const chat = await message.getChat();
        const contact = await message.getContact();
        const text = (message.body || '').trim();
        const isGroup = chat.isGroup;
        const userId = contact.id._serialized;
        const groupId = chat.id._serialized;

        // ---------- PROFANITY ----------
        let flagged = containsProfanity(text);

        // ---------- GEMINI SAFETY ----------
        if (!flagged && text.length > 5) {
          const res = await safeGeminiCall(text);
          if (res.blocked) flagged = true;
        }

        // ---------- STICKER BLOCK (groups) ----------
        if (isGroup && message.type === 'sticker') {
          if (!db.data.groups[groupId]) {
            db.data.groups[groupId] = { strikes: {} };
            await db.write();
          }
          const g = db.data.groups[groupId];
          const strikes = (g.strikes[userId] || 0) + 1;
          g.strikes[userId] = strikes;
          await db.write();

          try { await message.delete(true); } catch {}
          await chat.sendMessage(
            `Warning @${contact.number}, stickers are not allowed. Strike: ${strikes}`,
            { mentions: [contact.id._serialized] }
          );
          db.data.actions.push({
            type: 'sticker_violation',
            time: new Date().toISOString(),
            user: contact.pushname || contact.number,
            number: contact.number,
            chatName: chat.name,
            strikes
          });
          await db.write();

          if (strikes >= 4) {
            try {
              await chat.removeParticipants([userId]);
              await chat.sendMessage(
                `Removed @${contact.number} for repeated sticker violations.`,
                { mentions: [contact.id._serialized] }
              );
            } catch {
              await chat.sendMessage(
                `Cannot remove @${contact.number}. Bot must be admin.`,
                { mentions: [contact.id._serialized] }
              );
            }
          }
          return;
        }

        // ---------- GROUP LOGIC ----------
        if (isGroup) {
          if (!db.data.groups[groupId]) {
            db.data.groups[groupId] = { strikes: {} };
            await db.write();
          }
          const groupData = db.data.groups[groupId];

          if (flagged) {
            const strikes = (groupData.strikes[userId] || 0) + 1;
            groupData.strikes[userId] = strikes;
            await db.write();

            try { await message.delete(true); } catch {}
            await chat.sendMessage(
              `Warning @${contact.number}: message removed. Strike: ${strikes}`,
              { mentions: [contact.id._serialized] }
            );
            db.data.actions.push({
              type: 'violation',
              time: new Date().toISOString(),
              user: contact.pushname || contact.number,
              number: contact.number,
              chatName: chat.name,
              message: text,
              strikes
            });
            await db.write();

            if (strikes >= 2) {
              try {
                await chat.removeParticipants([userId]);
                await chat.sendMessage(
                  `Removed @${contact.number} for repeated violations.`,
                  { mentions: [contact.id._serialized] }
                );
              } catch {
                await chat.sendMessage(
                  `Cannot remove @${contact.number}. Bot must be admin.`,
                  { mentions: [contact.id._serialized] }
                );
              }
            }
            return;
          }

          // ---- !bot ----
          if (text.startsWith('!bot') || text.startsWith('@bot')) {
            const question = text.replace(/^(!bot|@bot)\s*/i, '').trim();
            if (!question) {
              await chat.sendMessage('Please ask a question after `!bot`');
              return;
            }

            await chat.sendMessage('Thinking...');

            const res = await safeGeminiCall(question, 2, userId);

            if (res.cooldown) {
              await chat.sendMessage('Please wait a few seconds before asking again.');
            } else if (res.skip) {
              await chat.sendMessage('Gemini is busy right now. Try again in a minute.');
            } else if (res.blocked) {
              await chat.sendMessage('I can’t answer that — it violates safety rules.');
            } else {
              await chat.sendMessage(res.text || 'No answer.');
            }
            return;
          }

          // ---- !google ----
          if (text.startsWith('!google ')) {
            const query = text.replace('!google ', '').trim();
            if (!query) return;
            try {
              const results = await google.search(query, { safe: false });
              let reply = `*Google Search – _${query}_*\n\n`;
              if (results.results?.length) {
                reply += results.results.slice(0, 3)
                  .map(r => `• *${r.title}*\n${r.url}`)
                  .join('\n\n');
              } else {
                reply += '_No results found._';
              }
              await chat.sendMessage(reply);
            } catch (e) {
              console.error('Google error:', e.message);
              const fallback = await safeGeminiCall(`Summarize top info about "${query}"`);
              await chat.sendMessage(fallback.text || 'Search failed.');
            }
            return;
          }

          // ---- !yt ----
          if (text.startsWith('!yt ')) {
            const q = text.replace('!yt ', '').trim();
            if (!q) return;
            const { videos } = await yts(q);
            const top = videos.slice(0, 3)
              .map(v => `*${v.title}*\n${v.url}`)
              .join('\n\n');
            await chat.sendMessage(`YouTube – _${q}_\n\n${top}`);
            return;
          }

          // ---- !owner ----
          if (text === '!owner') {
            await chat.sendMessage('*Bot Owner*\nName: *Mr Shah*\nWhatsApp: wa.me/923405424517');
            return;
          }

          // ---- !help ----
          if (text === '!help') {
            const helpText = `
*Bot Commands*

- \`!bot <question>\` – Ask Gemini
- \`!google <query>\` – Web search
- \`!yt <query>\` – YouTube search
- \`!info <question>\` – University document Q&A
- \`!owner\` – Owner info
- \`!ping\` – Bot latency
- \`!help\` – This list

Profanity & stickers are auto-punished.
            `.trim();
            await chat.sendMessage(helpText);
            return;
          }

          // ---- !info ----
          if (text.startsWith('!info ')) {
            const q = text.replace('!info ', '').trim();
            if (!q) return;
            const answer = await generateSmartAnswer(q);
            await chat.sendMessage(`*Answer*\n${answer}`);
            return;
          }

          // ---- !ping ----
          if (text.toLowerCase() === '!ping') {
            const start = Date.now();
            await chat.sendMessage('Pong!');
            const latency = Date.now() - start;
            await chat.sendMessage(`Alive! Response time: ${latency} ms`);
            return;
          }
        }
        // ---------- PRIVATE CHAT ----------
        else {
          if (flagged) {
            await contact.block();
            await message.reply('Blocked for abusive language.');
            db.data.actions.push({
              type: 'blocked',
              time: new Date().toISOString(),
              user: contact.pushname || contact.number,
              number: contact.number,
              message: text
            });
            await db.write();
          }
        }
      } catch (e) {
        console.error('Message handler error:', e);
      }
    });

    // -------------------------------------------------
    // START WHATSAPP
    // -------------------------------------------------
    console.log('Initializing WhatsApp client...');
    await client.initialize();

    // -------------------------------------------------
    // EXPRESS QR ENDPOINT
    // -------------------------------------------------
    app.get('/qr', (req, res) => {
      if (qrCodeData) {
        res.send(`<h2>Scan QR to login</h2><img src="${qrCodeData}" style="max-width:300px"/>`);
      } else {
        res.send('<h2>Logged in – no QR needed</h2>');
      }
    });

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Server → http://localhost:${PORT}/qr`));

  } catch (e) {
    console.error('Startup error:', e);
  }
})();
