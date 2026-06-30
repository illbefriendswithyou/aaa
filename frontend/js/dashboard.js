// ============================================
//  KJG BUOY TRACKER — Dashboard JS
//  Interval kirim data: 6 jam (sesuai firmware)
// ============================================

const API = 'http://localhost:3001/api';

// ── AUTH GUARD ────────────────────────────────
const token = localStorage.getItem('kjg_token');
if (!token) window.location.href = 'index.html';

const userData = JSON.parse(localStorage.getItem('kjg_user') || '{}');
if (userData.username) {
  document.getElementById('user-name').textContent = userData.username;
  document.getElementById('user-role').textContent = userData.role || 'Operator';
  document.getElementById('user-avatar').textContent = userData.username.slice(0,2).toUpperCase();
}

function logout() {
  localStorage.removeItem('kjg_token');
  localStorage.removeItem('kjg_user');
  window.location.href = 'index.html';
}

// ── HTTP HELPER ───────────────────────────────
async function apiFetch(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  if (res.status === 401) { logout(); return null; }
  return res.json();
}

// ── TOAST ─────────────────────────────────────
function showToast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast-item ${type}`;
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warn: '⚠️' };
  el.innerHTML = `<span>${icons[type]||''}</span><span>${msg}</span>`;
  document.getElementById('toast').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── LEAFLET MAP ───────────────────────────────
const map = L.map('map', { zoomControl: true }).setView([-5.9, 105.3], 8);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap',
  maxZoom: 18
}).addTo(map);

function makeIcon(status) {
  const cfg = {
    ok:      { bg: '#4BAE48', emoji: '⚓' },
    alert:   { bg: '#E63329', emoji: '⚠' },
    offline: { bg: '#9CA3AF', emoji: '📵' }
  };
  const c = cfg[status] || cfg.ok;
  return L.divIcon({
    className: '',
    html: `<div style="width:34px;height:34px;border-radius:50%;background:${c.bg};
      border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3);
      display:flex;align-items:center;justify-content:center;font-size:15px;cursor:pointer">
      ${c.emoji}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });
}

let markers = {};         // { id: L.marker }
let geofenceCircles = {}; // { id: L.circle }
let geofenceVisible = false;
let allBuoys = [];
let selectedId = null;
let currentFilter = 'all';
let searchQuery = '';

// ── BUOY DATA ─────────────────────────────────
async function loadBuoys() {
  const data = await apiFetch('/buoy');
  if (!data) return;
  allBuoys = data;
  renderStats();
  renderList();
  updateMarkers();
  updateMapMeta();
}

async function loadHistory() {
  const data = await apiFetch('/buoy/history/all?limit=10');
  if (!data) return;
  renderHistory(data);
}

// ── STATS ─────────────────────────────────────
function renderStats() {
  const total   = allBuoys.length;
  const active  = allBuoys.filter(b => b.status === 'ok').length;
  const alert   = allBuoys.filter(b => b.status === 'alert').length;
  const offline = allBuoys.filter(b => b.status === 'offline').length;

  document.getElementById('s-total').textContent   = total;
  document.getElementById('s-active').textContent  = active;
  document.getElementById('s-alert').textContent   = alert;
  document.getElementById('s-offline').textContent = offline;

  document.getElementById('s-total-sub').textContent  = `${total} unit terdaftar`;
  document.getElementById('s-active-sub').textContent = active > 0 ? `${Math.round(active/total*100)}% online` : '-';
  document.getElementById('s-alert-sub').textContent  = alert > 0 ? `${alert} perlu perhatian` : 'Semua aman';
  document.getElementById('s-offline-sub').textContent = offline > 0 ? `${offline} tidak merespons` : 'Semua online';
}

// ── LIST ──────────────────────────────────────
function renderList(filter = currentFilter, query = searchQuery) {
  let list = allBuoys;
  if (filter !== 'all') list = list.filter(b => b.status === filter);
  if (query) list = list.filter(b => b.name.toLowerCase().includes(query.toLowerCase()) || b.device_id.toLowerCase().includes(query.toLowerCase()));

  document.getElementById('list-count').textContent = list.length + ' unit';

  if (list.length === 0) {
    document.getElementById('buoy-list').innerHTML = `
      <div class="empty-state">
        <span style="font-size:32px">🔍</span>
        <p>Tidak ada buoy ${filter !== 'all' ? 'dengan status ini' : ''}</p>
      </div>`;
    return;
  }

  document.getElementById('buoy-list').innerHTML = list.map(b => {
    const thumbClass = b.status === 'ok' ? 'thumb-ok' : b.status === 'alert' ? 'thumb-alert' : 'thumb-offline';
    const emoji      = b.status === 'ok' ? '⚓' : b.status === 'alert' ? '⚠️' : '📵';
    const sel        = selectedId === b.id ? 'selected' : '';
    const alertCls   = b.status === 'alert' ? 'is-alert' : b.status === 'offline' ? 'is-offline' : '';
    const lastSeen   = b.last_seen ? new Date(b.last_seen).toLocaleString('id-ID') : 'Belum ada data';

    return `<div class="buoy-item ${sel} ${alertCls}" onclick="selectBuoy(${b.id})">
      <div class="buoy-thumb ${thumbClass}">${emoji}</div>
      <div class="buoy-info">
        <div class="buoy-name">${b.name}</div>
        <div class="buoy-coord">${parseFloat(b.lat).toFixed(4)}, ${parseFloat(b.lng).toFixed(4)} · ${lastSeen}</div>
      </div>
      <span class="badge badge-${b.status === 'ok' ? 'ok' : b.status === 'alert' ? 'alert' : 'offline'}">
        ${b.status === 'ok' ? 'AMAN' : b.status === 'alert' ? 'ALERT' : 'OFFLINE'}
      </span>
    </div>`;
  }).join('');
}

function filterList(f) { currentFilter = f; renderList(); }
function searchBuoy(q) { searchQuery = q; renderList(); }

function setChip(el, f) {
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  filterList(f);
}

// ── SELECT BUOY ───────────────────────────────
function selectBuoy(id) {
  selectedId = id;
  const b = allBuoys.find(x => x.id === id);
  if (!b) return;

  renderList();
  renderDetail(b);

  if (b.lat && b.lng) {
    map.setView([parseFloat(b.lat), parseFloat(b.lng)], 12);
    if (markers[id]) markers[id].openPopup();
  }
}

function renderDetail(b) {
  document.getElementById('d-name').textContent = b.name;
  document.getElementById('d-id').textContent = b.device_id || `ID-${b.id}`;
  document.getElementById('d-icon').textContent = b.status === 'alert' ? '⚠️' : b.status === 'offline' ? '📵' : '⚓';

  const batt    = b.battery ?? '—';
  const speed   = b.speed != null ? parseFloat(b.speed).toFixed(1) + ' kn' : '—';
  const sats    = b.satellites ?? '—';
  const signal  = b.signal_strength ?? 0;
  const lastSeen = b.last_seen ? new Date(b.last_seen).toLocaleString('id-ID') : 'Belum ada data';

  const alertHtml = b.status === 'alert'
    ? `<div class="alert-strip">⚠️ <span>${b.alert_message || 'Buoy memerlukan perhatian segera'}</span></div>`
    : b.status === 'offline'
    ? `<div class="alert-strip" style="background:#F3F4F6;border-color:var(--border)">📵 <span style="color:var(--muted)">Buoy tidak merespons — cek koneksi perangkat</span></div>`
    : '';

  const bars = Array.from({length:4}, (_,i) =>
    `<div class="signal-bar ${i < signal ? 'active' : ''}" style="height:${(i+1)*4+4}px"></div>`
  ).join('');

  const battColor = batt < 20 ? 'var(--red)' : batt < 40 ? '#D97706' : 'var(--text)';

  document.getElementById('d-body').innerHTML = `
    ${alertHtml}
    <div class="detail-grid">
      <div class="detail-item">
        <div class="detail-item-label">Latitude</div>
        <div class="detail-item-value">${parseFloat(b.lat).toFixed(6)}°</div>
      </div>
      <div class="detail-item">
        <div class="detail-item-label">Longitude</div>
        <div class="detail-item-value">${parseFloat(b.lng).toFixed(6)}°</div>
      </div>
      <div class="detail-item">
        <div class="detail-item-label">Kecepatan</div>
        <div class="detail-item-value" style="color:${parseFloat(b.speed)>2?'var(--red)':'var(--text)'}">${speed}</div>
      </div>
      <div class="detail-item">
        <div class="detail-item-label">Baterai</div>
        <div class="detail-item-value" style="color:${battColor}">${batt !== '—' ? batt + '%' : '—'}</div>
      </div>
      <div class="detail-item">
        <div class="detail-item-label">Sinyal</div>
        <div class="signal-bars">${bars}</div>
      </div>
      <div class="detail-item">
        <div class="detail-item-label">Satelit GPS</div>
        <div class="detail-item-value">${sats}</div>
      </div>
    </div>
    <div style="font-size:11.5px;color:var(--muted);margin-bottom:12px">
      📅 Data terakhir: ${lastSeen}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-primary btn-sm" style="flex:1" onclick="map.setView([${parseFloat(b.lat)},${parseFloat(b.lng)}],14)">🎯 Fokus Peta</button>
      <button class="btn btn-outline btn-sm" style="flex:1" onclick="openEditModal(${b.id})">✏️ Edit</button>
    </div>`;
}

// ── MARKERS ───────────────────────────────────
function updateMarkers() {
  // Hapus marker lama yang sudah tidak ada
  Object.keys(markers).forEach(id => {
    if (!allBuoys.find(b => b.id == id)) {
      map.removeLayer(markers[id]);
      delete markers[id];
    }
  });

  allBuoys.forEach(b => {
    const lat = parseFloat(b.lat);
    const lng = parseFloat(b.lng);
    if (isNaN(lat) || isNaN(lng)) return;

    const popupHtml = `<div class="buoy-popup">
      <strong>⚓ ${b.name}</strong>
      <div class="popup-row"><span>ID</span><span><code>${b.device_id||'—'}</code></span></div>
      <div class="popup-row"><span>Koordinat</span><span>${lat.toFixed(4)}, ${lng.toFixed(4)}</span></div>
      <div class="popup-row"><span>Status</span><span>${b.status === 'ok' ? '✅ Aman' : b.status === 'alert' ? '⚠️ Alert' : '📵 Offline'}</span></div>
      <div class="popup-row"><span>Baterai</span><span>${b.battery != null ? b.battery + '%' : '—'}</span></div>
      <div style="margin-top:8px">
        <button onclick="selectBuoy(${b.id})" style="width:100%;padding:6px;font-size:12px;background:#2E7FC7;color:#fff;border:none;border-radius:5px;cursor:pointer">Lihat Detail</button>
      </div>
    </div>`;

    if (markers[b.id]) {
      markers[b.id].setLatLng([lat, lng]);
      markers[b.id].setIcon(makeIcon(b.status));
      markers[b.id].setPopupContent(popupHtml);
    } else {
      const m = L.marker([lat, lng], { icon: makeIcon(b.status) })
        .addTo(map)
        .bindPopup(popupHtml);
      m.on('click', () => selectBuoy(b.id));
      markers[b.id] = m;
    }

    // Geofence circle
    if (geofenceCircles[b.id]) map.removeLayer(geofenceCircles[b.id]);
    const radius = (parseFloat(b.geofence_radius) || 2) * 1000;
    geofenceCircles[b.id] = L.circle([lat, lng], {
      radius,
      color: '#2E7FC7',
      fillColor: '#2E7FC7',
      fillOpacity: 0.05,
      weight: 1,
      dashArray: '5 5'
    });
    if (geofenceVisible) geofenceCircles[b.id].addTo(map);
  });
}

function toggleGeofence() {
  geofenceVisible = !geofenceVisible;
  Object.values(geofenceCircles).forEach(c =>
    geofenceVisible ? c.addTo(map) : map.removeLayer(c)
  );
  showToast(geofenceVisible ? 'Geofence ditampilkan' : 'Geofence disembunyikan', 'info');
}

function fitAllMarkers() {
  const pts = allBuoys.filter(b => b.lat && b.lng).map(b => [parseFloat(b.lat), parseFloat(b.lng)]);
  if (pts.length > 0) map.fitBounds(pts, { padding: [40, 40] });
}

function updateMapMeta() {
  document.getElementById('map-meta').textContent =
    `${allBuoys.length} buoy terdaftar · Data dikirim setiap 6 jam`;
}

// ── HISTORY ───────────────────────────────────
function renderHistory(logs) {
  if (!logs || logs.length === 0) {
    document.getElementById('history-body').innerHTML =
      `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--muted)">Belum ada log aktivitas</td></tr>`;
    return;
  }

  document.getElementById('history-body').innerHTML = logs.map(h => {
    const time = new Date(h.created_at).toLocaleString('id-ID');
    const stClass = h.status === 'ok' ? 'ev-ok' : h.status === 'alert' ? 'ev-alert' : h.status === 'offline' ? 'ev-offline' : 'ev-normal';
    const stLabel = h.status === 'ok' ? 'NORMAL' : h.status === 'alert' ? 'ALERT' : h.status === 'offline' ? 'OFFLINE' : 'INFO';
    const batt = h.battery != null ? h.battery + '%' : '—';

    return `<tr>
      <td style="font-family:monospace;font-size:12px;color:var(--muted)">${time}</td>
      <td><code class="id-chip">${h.device_id || '—'}</code></td>
      <td style="font-weight:500">${h.buoy_name || '—'}</td>
      <td style="font-family:monospace;font-size:12px;color:var(--muted)">${parseFloat(h.lat).toFixed(4)}, ${parseFloat(h.lng).toFixed(4)}</td>
      <td style="color:${h.battery < 20 ? 'var(--red)' : 'var(--text)'}">${batt}</td>
      <td><span class="badge ${stClass}">${stLabel}</span></td>
      <td style="color:var(--muted);font-size:12.5px">${h.note || '—'}</td>
    </tr>`;
  }).join('');
}

// ── MODAL ADD BUOY ────────────────────────────
function openAddBuoyModal() {
  ['add-name','add-lat','add-lng','add-desc'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('add-fence').value = '2.0';
  document.getElementById('modal-add').style.display = 'flex';
}

async function submitAddBuoy() {
  const name  = document.getElementById('add-name').value.trim();
  const lat   = document.getElementById('add-lat').value;
  const lng   = document.getElementById('add-lng').value;
  const fence = document.getElementById('add-fence').value || '2.0';
  const desc  = document.getElementById('add-desc').value.trim();

  if (!name || !lat || !lng) { showToast('Nama, latitude, dan longitude wajib diisi', 'error'); return; }
  if (isNaN(parseFloat(lat)) || isNaN(parseFloat(lng))) { showToast('Koordinat tidak valid', 'error'); return; }

  const res = await apiFetch('/buoy', {
    method: 'POST',
    body: JSON.stringify({ name, lat: parseFloat(lat), lng: parseFloat(lng), geofence_radius: parseFloat(fence), description: desc })
  });

  if (res && res.id) {
    showToast(`Buoy "${name}" berhasil ditambahkan`, 'success');
    closeModal('modal-add');
    await loadBuoys();
    await loadHistory();
    selectBuoy(res.id);
  } else {
    showToast(res?.message || 'Gagal menambah buoy', 'error');
  }
}

// ── MODAL EDIT BUOY ───────────────────────────
function openEditModal(id) {
  const b = allBuoys.find(x => x.id === id);
  if (!b) return;
  document.getElementById('edit-id').value   = b.id;
  document.getElementById('edit-name').value = b.name;
  document.getElementById('edit-lat').value  = parseFloat(b.lat);
  document.getElementById('edit-lng').value  = parseFloat(b.lng);
  document.getElementById('edit-fence').value = b.geofence_radius || '2.0';
  document.getElementById('edit-desc').value = b.description || '';
  document.getElementById('modal-edit').style.display = 'flex';
}

async function submitEditBuoy() {
  const id    = document.getElementById('edit-id').value;
  const name  = document.getElementById('edit-name').value.trim();
  const lat   = document.getElementById('edit-lat').value;
  const lng   = document.getElementById('edit-lng').value;
  const fence = document.getElementById('edit-fence').value;
  const desc  = document.getElementById('edit-desc').value;

  if (!name || !lat || !lng) { showToast('Nama dan koordinat wajib diisi', 'error'); return; }

  const res = await apiFetch(`/buoy/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ name, lat: parseFloat(lat), lng: parseFloat(lng), geofence_radius: parseFloat(fence), description: desc })
  });

  if (res && res.message === 'ok') {
    showToast('Buoy berhasil diperbarui', 'success');
    closeModal('modal-edit');
    await loadBuoys();
  } else {
    showToast(res?.message || 'Gagal memperbarui', 'error');
  }
}

async function deleteBuoy() {
  const id   = document.getElementById('edit-id').value;
  const name = document.getElementById('edit-name').value;
  if (!confirm(`Hapus buoy "${name}"? Tindakan ini tidak dapat dibatalkan.`)) return;

  const res = await apiFetch(`/buoy/${id}`, { method: 'DELETE' });
  if (res && res.message === 'ok') {
    showToast(`Buoy "${name}" telah dihapus`, 'success');
    closeModal('modal-edit');
    selectedId = null;
    document.getElementById('d-body').innerHTML = '<p style="color:var(--muted);text-align:center;padding:12px">Pilih buoy dari daftar atau peta</p>';
    document.getElementById('d-name').textContent = 'Pilih Buoy';
    document.getElementById('d-id').textContent = '';
    await loadBuoys();
  } else {
    showToast(res?.message || 'Gagal menghapus', 'error');
  }
}

// ── MODAL HELPER ──────────────────────────────
function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

// Tutup modal dengan klik di luar
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.style.display = 'none';
  });
});

// ── AUTO REFRESH (setiap 30 menit cek update baru) ──
// Data dikirim device setiap 6 jam, tapi kita cek server lebih sering
// agar kalau ada data masuk tidak tertunda terlalu lama
let refreshTimer = null;
function startAutoRefresh() {
  refreshTimer = setInterval(async () => {
    await loadBuoys();
    await loadHistory();
    const now = new Date().toLocaleTimeString('id-ID');
    document.getElementById('last-update').textContent = `Terakhir cek: ${now}`;
  }, 30 * 60 * 1000); // 30 menit
}

// ── INIT ──────────────────────────────────────
(async () => {
  await loadBuoys();
  await loadHistory();
  startAutoRefresh();
  document.getElementById('last-update').textContent = 'Kirim data setiap 6 jam';
})();
