// ============================================
//  KJG BUOY TRACKER — Buoy Routes
//
//  ENDPOINT DASHBOARD (butuh token):
//  GET    /api/buoy            → daftar semua buoy
//  POST   /api/buoy            → tambah buoy baru
//  PUT    /api/buoy/:id        → edit buoy
//  DELETE /api/buoy/:id        → hapus buoy
//  GET    /api/buoy/:id        → detail buoy
//  GET    /api/buoy/:id/history → history kiriman data
//  GET    /api/buoy/history/all → semua log terbaru
//
//  ENDPOINT ESP32 (pakai device_key, tanpa login):
//  POST   /api/buoy/data       → kirim data GPS dari device
// ============================================

const express = require('express');
const { getDb }          = require('../db/database');
const { authMiddleware } = require('../middleware/authMiddleware');

const router  = express.Router();

// Device key — ESP32 harus kirim ini di header x-device-key
// Ganti sesuai kebutuhan, bisa juga pakai per-device key di database
const DEVICE_KEY = process.env.DEVICE_KEY || 'kjg_device_secret_2026';

// ── HAVERSINE ─────────────────────────────────
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ── [ESP32] KIRIM DATA GPS ────────────────────
// ESP32 memanggil endpoint ini setiap 6 jam
// Header: x-device-key: <DEVICE_KEY>
// Body: { "id": "BJG-001", "lat": -5.62, "lng": 105.31, "bat": 85, ... }
router.post('/data', (req, res) => {
  const key = req.headers['x-device-key'];
  if (key !== DEVICE_KEY) {
    return res.status(403).json({ message: 'Device key tidak valid' });
  }

  const { id: device_id, lat, lng, alt, speed, heading, sats, hdop, batt, geofence } = req.body;

  if (!device_id || lat == null || lng == null) {
    return res.status(400).json({ message: 'Field id, lat, lng wajib ada' });
  }

  try {
    const db   = getDb();
    const buoy = db.prepare('SELECT * FROM buoys WHERE device_id = ?').get(device_id);

    if (!buoy) {
      return res.status(404).json({ message: `Device "${device_id}" belum terdaftar. Daftarkan dulu di dashboard.` });
    }

    // Cek geofence
    const fence  = parseFloat(buoy.geofence_radius) || 2.0;
    const dist   = haversineKm(parseFloat(buoy.lat), parseFloat(buoy.lng), parseFloat(lat), parseFloat(lng));
    const fenceOk = dist <= fence;
    const spd    = parseFloat(speed) || 0;
    const battPct = parseFloat(batt) || 0;

    // Tentukan status dan pesan alert
    let status = 'ok';
    let note   = 'Data rutin';
    let alertMsg = null;

    if (!fenceOk) {
      status   = 'alert';
      note     = `Keluar geofence (${dist.toFixed(2)} km dari titik asal)`;
      alertMsg = `Buoy berjarak ${dist.toFixed(1)} km dari zona aman!`;
    } else if (spd > 2.0) {
      status   = 'alert';
      note     = `Kecepatan tidak wajar: ${spd.toFixed(1)} knot`;
      alertMsg = `Kecepatan ${spd.toFixed(1)} kn — kemungkinan hanyut atau dicuri!`;
    } else if (battPct < 20 && battPct > 0) {
      note = `Baterai rendah: ${battPct.toFixed(0)}%`;
      alertMsg = `Baterai kritis ${battPct.toFixed(0)}%`;
    }

    // Simpan log
    db.prepare(`
      INSERT INTO buoy_logs (buoy_id, device_id, buoy_name, lat, lng, altitude, speed, heading, battery, satellites, hdop, status, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(buoy.id, device_id, buoy.name, lat, lng, alt || 0, speed || 0, heading || 0, batt || null, sats || 0, hdop || 0, status, note);

    // Update posisi terkini di tabel buoy
    db.prepare(`
      UPDATE buoys SET
        lat             = ?,
        lng             = ?,
        status          = ?,
        battery         = ?,
        speed           = ?,
        heading         = ?,
        satellites      = ?,
        alert_message   = ?,
        last_seen       = datetime('now','localtime'),
        updated_at      = datetime('now','localtime')
      WHERE device_id = ?
    `).run(lat, lng, status, batt || null, speed || 0, heading || 0, sats || 0, alertMsg, device_id);

    console.log(`[DATA] ${device_id} → lat:${lat} lng:${lng} bat:${batt}% status:${status}`);

    return res.json({
      message:     'ok',
      status,
      geofence_ok: fenceOk,
      distance_km: dist.toFixed(3),
      note
    });

  } catch (err) {
    console.error('[DATA] Error:', err);
    return res.status(500).json({ message: 'Gagal menyimpan data' });
  }
});

// ── GET SEMUA BUOY ────────────────────────────
router.get('/', authMiddleware, (req, res) => {
  try {
    const db   = getDb();
    const rows = db.prepare('SELECT * FROM buoys ORDER BY name ASC').all();
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ message: 'Gagal mengambil data buoy' });
  }
});

// ── GET DETAIL BUOY ───────────────────────────
router.get('/:id(\\d+)', authMiddleware, (req, res) => {
  try {
    const db  = getDb();
    const row = db.prepare('SELECT * FROM buoys WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ message: 'Buoy tidak ditemukan' });
    return res.json(row);
  } catch (err) {
    return res.status(500).json({ message: 'Gagal mengambil detail buoy' });
  }
});

// ── TAMBAH BUOY ───────────────────────────────
router.post('/', authMiddleware, (req, res) => {
  const { name, lat, lng, geofence_radius, description } = req.body;
  if (!name || lat == null || lng == null) {
    return res.status(400).json({ message: 'Nama, lat, lng wajib diisi' });
  }

  try {
    const db = getDb();

    // Auto-generate device_id dari nama: "Buoy Utara 1" → "BJG-004"
    const count = db.prepare('SELECT COUNT(*) as c FROM buoys').get().c;
    const device_id = `BJG-${String(count + 1).padStart(3, '0')}`;

    const result = db.prepare(`
      INSERT INTO buoys (name, device_id, lat, lng, geofence_radius, description, status)
      VALUES (?, ?, ?, ?, ?, ?, 'offline')
    `).run(name, device_id, lat, lng, geofence_radius || 2.0, description || '');

    console.log(`[BUOY] Tambah: ${name} (${device_id})`);
    return res.status(201).json({ id: result.lastInsertRowid, device_id, message: 'ok' });
  } catch (err) {
    console.error('[BUOY] Error tambah:', err);
    return res.status(500).json({ message: 'Gagal menambah buoy' });
  }
});

// ── EDIT BUOY ─────────────────────────────────
router.put('/:id', authMiddleware, (req, res) => {
  const { name, lat, lng, geofence_radius, description } = req.body;
  if (!name || lat == null || lng == null) {
    return res.status(400).json({ message: 'Nama, lat, lng wajib diisi' });
  }

  try {
    const db = getDb();
    const info = db.prepare(`
      UPDATE buoys SET name=?, lat=?, lng=?, geofence_radius=?, description=?, updated_at=datetime('now','localtime')
      WHERE id=?
    `).run(name, lat, lng, geofence_radius || 2.0, description || '', req.params.id);

    if (info.changes === 0) return res.status(404).json({ message: 'Buoy tidak ditemukan' });
    return res.json({ message: 'ok' });
  } catch (err) {
    return res.status(500).json({ message: 'Gagal memperbarui buoy' });
  }
});

// ── HAPUS BUOY ────────────────────────────────
router.delete('/:id', authMiddleware, (req, res) => {
  try {
    const db   = getDb();
    const info = db.prepare('DELETE FROM buoys WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ message: 'Buoy tidak ditemukan' });
    return res.json({ message: 'ok' });
  } catch (err) {
    return res.status(500).json({ message: 'Gagal menghapus buoy' });
  }
});

// ── HISTORY PER BUOY ──────────────────────────
router.get('/:id/history', authMiddleware, (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  try {
    const db   = getDb();
    const rows = db.prepare('SELECT * FROM buoy_logs WHERE buoy_id = ? ORDER BY created_at DESC LIMIT ?').all(req.params.id, limit);
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ message: 'Gagal mengambil history' });
  }
});

// ── HISTORY SEMUA BUOY ────────────────────────
router.get('/history/all', authMiddleware, (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT l.*, b.name as buoy_name
      FROM buoy_logs l
      LEFT JOIN buoys b ON l.buoy_id = b.id
      ORDER BY l.created_at DESC
      LIMIT ?
    `).all(limit);
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ message: 'Gagal mengambil log' });
  }
});

module.exports = router;
