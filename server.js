const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Serve the frontend index.html
app.use(express.static(path.join(__dirname, 'public')));

// Connect to SQLite Database
const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('Error opening database', err);
  else console.log('Connected to SQLite database.');
});

// Initialize table
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS store (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);
});

// Helper to query db
const getStoreValue = (key) => {
  return new Promise((resolve, reject) => {
    db.get('SELECT value FROM store WHERE key = ?', [key], (err, row) => {
      if (err) reject(err);
      else resolve(row ? JSON.parse(row.value) : null);
    });
  });
};

const setStoreValue = (key, value) => {
  return new Promise((resolve, reject) => {
    const jsonStr = JSON.stringify(value);
    db.run(
      'INSERT INTO store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      [key, jsonStr],
      function (err) {
        if (err) reject(err);
        else resolve();
      }
    );
  });
};

// API: Get all data
app.get('/api/data', async (req, res) => {
  try {
    const tables = await getStoreValue('tables') || [];
    const menu = await getStoreValue('menu') || [];
    const orders = await getStoreValue('orders') || [];
    const items = await getStoreValue('items') || [];
    const cfg = await getStoreValue('cfg') || {};
    res.json({ tables, menu, orders, items, cfg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Save specific key
app.post('/api/save/:key', async (req, res) => {
  const { key } = req.params;
  const allowedKeys = ['tables', 'menu', 'orders', 'items', 'cfg'];
  if (!allowedKeys.includes(key)) return res.status(400).json({ error: 'Invalid key' });

  try {
    await setStoreValue(key, req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start Server
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
