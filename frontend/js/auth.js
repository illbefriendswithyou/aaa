// ============================================
//  KJG BUOY TRACKER — Auth JS (Login Page)
// ============================================

const API = 'http://localhost:3001/api';

if (localStorage.getItem('kjg_token')) {
  window.location.href = 'dashboard.html';
}

function togglePassword() {
  const input = document.getElementById('password');
  const isText = input.type === 'text';
  input.type = isText ? 'password' : 'text';
  document.getElementById('eye-icon').style.opacity = isText ? '1' : '0.4';
}

function showAlert(msg, type = 'error') {
  const el = document.getElementById('alert-box');
  el.className = 'alert-box alert-' + type;
  el.textContent = msg;
  el.style.display = 'block';
}

function hideAlert() {
  document.getElementById('alert-box').style.display = 'none';
}

function setLoading(state) {
  const btn = document.getElementById('btn-login');
  document.getElementById('btn-text').style.display = state ? 'none' : 'flex';
  document.getElementById('btn-loading').style.display = state ? 'flex' : 'none';
  btn.disabled = state;
}

document.getElementById('login-form').addEventListener('submit', async function(e) {
  e.preventDefault();
  hideAlert();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  if (!username || !password) {
    showAlert('Username dan password harus diisi');
    return;
  }

  setLoading(true);

  try {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();

    if (res.ok && data.token) {
      localStorage.setItem('kjg_token', data.token);
      localStorage.setItem('kjg_user', JSON.stringify(data.user));
      showAlert('Login berhasil! Mengalihkan...', 'success');
      setTimeout(() => { window.location.href = 'dashboard.html'; }, 600);
    } else {
      showAlert(data.message || 'Username atau password salah');
      setLoading(false);
    }
  } catch (err) {
    showAlert('Tidak dapat terhubung ke server. Pastikan backend berjalan.');
    setLoading(false);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('login-form').dispatchEvent(new Event('submit'));
});
