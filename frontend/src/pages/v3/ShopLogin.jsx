import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './shopConsole.css';

// Use the environment-configured API base URL — never localhost hardcode
const API_BASE = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_BASE_URL || '');

export default function ShopLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      let response = await fetch(`${API_BASE}/api/v3/auth/pilot-login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AutoPrint-Contract-Version': '3',
        },
        credentials: 'include',
      });

      // The pilot endpoint is intentionally enabled only for the temporary
      // test environment. Normal deployments fall back to password login.
      if (response.status === 403) {
        response = await fetch(`${API_BASE}/api/v3/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-AutoPrint-Contract-Version': '3' },
          credentials: 'include',
          body: JSON.stringify({ email, password }),
        });
      }

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || data.detail || 'Login failed');
      }

      sessionStorage.setItem('v3_csrf', data.csrf_token);
      sessionStorage.setItem('v3_shop_id', data.user.shop_id);
      sessionStorage.setItem('v3_shop_role', data.user.role);
      // Compatibility gate for the feature-rich management modules. The real
      // authentication boundary remains the HttpOnly v3 server session.
      localStorage.setItem(`autoprint_shop_auth_${data.user.shop_id}`, 'true');
      navigate(`/v3/console/${data.user.shop_id}/dashboard`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="v3-shop-container" style={{ maxWidth: 420 }}>
      <h2>Shopkeeper Console Login (v3)</h2>
      <p style={{ color: '#6b7280' }}>Pilot test access opens instantly. Full login can be restored after pilot validation.</p>

      {error && (
        <div style={{ padding: 12, background: '#fee2e2', color: '#991b1b', borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <form onSubmit={handleLogin} style={{ background: '#fff', padding: 24, borderRadius: 12, border: '1px solid #e5e7eb' }}>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Email Address</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            style={{ width: '100%', padding: 10, borderRadius: 6, border: '1px solid #d1d5db' }}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            style={{ width: '100%', padding: 10, borderRadius: 6, border: '1px solid #d1d5db' }}
          />
        </div>

        <button
          type="submit"
          className="v3-btn-action v3-btn-approve"
          style={{ width: '100%', padding: 12, fontSize: '1rem' }}
          disabled={loading}
        >
          {loading ? 'Opening console...' : 'Open Pilot Shop Console'}
        </button>
      </form>
    </div>
  );
}
