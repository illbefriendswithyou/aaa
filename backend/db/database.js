// ============================================
//  KJG BUOY TRACKER — Database Setup (SQLite)
//  Menggunakan SQLite agar mudah dijalankan
//  tanpa instalasi database server terpisah
// ============================================

const Database = require('better-sqlite3');
const bcrypt   = require('bcrypt');
const path     = require('path');

const DB_PATH = path.join(__dirname, '..', 'kjg_buoy.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL'); // Performa lebih baik untuk concurrent reads
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    -- Tabel user untuk login
    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      username   TEXT UNIQUE NOT NULL,
      password   TEXT NOT NULL,
      role       TEXT DEFAULT 'operator',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- Tabel buoy (data yang didaftarkan admin)
    CREATE TABLE IF NOT EXISTS buoys (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      name             TEXT NOT NULL,
      device_id        TEXT UNIQUE,
      lat              REAL NOT NULL DEFAULT 0,
      lng              REAL NOT NULL DEFAULT 0,
      status           TEXT DEFAULT 'offline',
      battery          REAL,
      speed            REAL DEFAULT 0,
      heading          REAL DEFAULT 0,
      satellites       INTEGER DEFAULT 0,
      signal_strength  INTEGER DEFAULT 0,
      geofence_radius  REAL DEFAULT 2.0,
      description      TEXT,
      alert_message    TEXT,
      last_seen        TEXT,
      created_at       TEXT DEFAULT (datetime('now','localtime')),
      updated_at       TEXT DEFAULT (datetime('now','localtime'))
    );

    -- Tabel log / history kiriman data dari device
    CREATE TABLE IF NOT EXISTS buoy_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      buoy_id     INTEGER REFERENCES buoys(id) ON DELETE CASCADE,
      device_id   TEXT,
      buoy_name   TEXT,
      lat         REAL NOT NULL,
      lng         REAL NOT NULL,
      altitude    REAL DEFAULT 0,
      speed       REAL DEFAULT 0,
      heading     REAL DEFAULT 0,
      battery     REAL,
      satellites  INTEGER DEFAULT 0,
      hdop        REAL DEFAULT 0,
      status      TEXT DEFAULT 'ok',
      note        TEXT,
      created_at  TEXT DEFAULT (datetime('now','localtime'))
    );

    -- Index untuk query cepat
    CREATE INDEX IF NOT EXISTS idx_logs_buoy ON buoy_logs(buoy_id);
    CREATE INDEX IF NOT EXISTS idx_logs_time ON buoy_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_logs_device ON buoy_logs(device_id);
  `);

  // Seed: buat user admin default jika belum ada
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!existing) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, 'admin')").run('admin', hash);
    console.log('[DB] User admin default dibuat: admin / admin123 — GANTI PASSWORD SETELAH LOGIN!');
  }

  // Seed: tambah beberapa buoy contoh jika tabel masih kosong
  const buoyCount = db.prepare('SELECT COUNT(*) as c FROM buoys').get().c;
  if (buoyCount === 0) {
    const insert = db.prepare(`
      INSERT INTO buoys (name, device_id, lat, lng, status, battery, geofence_radius, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const seedBuoys = [
      ['Buoy Utara 1', 'BJG-001', -5.6235, 105.3142, 'ok',      85, 2.0, 'Buoy di perairan utara'],
      ['Buoy Selatan A', 'BJG-002', -6.1102, 105.2384, 'alert',  67, 2.0, 'Perairan selatan zona A'],
      ['Buoy Timur 1', 'BJG-003', -5.9012, 105.8234, 'offline',  0, 3.0, 'Area timur pelabuhan'],
    ];
    seedBuoys.forEach(b => insert.run(...b));
    console.log('[DB] Data buoy contoh berhasil ditambahkan');
  }

  console.log('[DB] Schema inisialisasi selesai:', DB_PATH);
}

module.exports = { getDb };
