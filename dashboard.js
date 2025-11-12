// dashboard.js
require('dotenv').config();
const express = require('express');
const { Low, JSONFile } = require('lowdb');
const path = require('path');

const adapter = new JSONFile('db.json');
const db = new Low(adapter);

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

app.get('/', async (req, res) => {
  await db.read();
  const actions = db.data.actions || [];
  res.render('index', { actions });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`📊 Dashboard running on http://localhost:${PORT}`));
 
