/**
 * Memory Service
 * Manages personal context memory (file-based JSON)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MEMORY_FILE = path.join(__dirname, '..', '..', 'data', 'memory', 'memory.json');

function ensureFile() {
  const dir = path.dirname(MEMORY_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(MEMORY_FILE)) {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify({
      entries: [],
      context: {},
      updatedAt: new Date().toISOString()
    }, null, 2));
  }
}

function load() {
  ensureFile();
  return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'));
}

function save(data) {
  ensureFile();
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2));
}

function addEntry(entry) {
  const data = load();
  data.entries.push({
    id: entry.id || `mem-${crypto.randomUUID()}`,
    text: entry.text,
    type: entry.type || 'general',
    date: entry.date || new Date().toISOString(),
    ...entry
  });
  save(data);
  return data;
}

function getCount() {
  const data = load();
  return data.entries.length;
}

function getContext() {
  const data = load();
  // Return recent entries as context string
  const recent = data.entries.slice(-20);
  return recent.map(e => `[${e.date}] (${e.type}) ${e.text}`).join('\n');
}

module.exports = { load, save, addEntry, getCount, getContext };
