import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { v3Api } from '../../services/v3Api';

const cardStyle = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: 18, marginBottom: 12, boxShadow: '0 1px 3px rgba(0,0,0,.05)' };

export default function CustomerDiscovery() {
  const [shops, setShops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const loadNearby = async (lat, lng) => {
    setLoading(true); setError('');
    try {
      const result = await v3Api.findNearbyShops({ lat, lng, radius_km: 5, limit: 20 });
      setShops(result.shops || []);
    } catch (err) { setError(err.message || 'Could not load nearby shops.'); }
    finally { setLoading(false); }
  };

  const runSearch = async (event) => {
    event?.preventDefault();
    if (!search.trim()) return;
    setLoading(true); setError('');
    try {
      const value = search.trim();
      const result = await v3Api.searchDiscoverableShops(/^\d{4,10}$/.test(value) ? { pincode: value } : { locality: value });
      setShops(result.shops || []);
    } catch (err) { setError(err.message || 'Could not search shops.'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (!navigator.geolocation) { setLoading(false); return; }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => loadNearby(coords.latitude, coords.longitude),
      () => setLoading(false),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
    );
  }, []);

  return <main style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px 48px', color: '#111827' }}>
    <Link to="/print" style={{ color: '#4f46e5', textDecoration: 'none', fontWeight: 700 }}>← Print with a shop code</Link>
    <h1 style={{ margin: '18px 0 6px', fontSize: 28 }}>Find a print shop</h1>
    <p style={{ marginTop: 0, color: '#4b5563' }}>Compare nearby shops, opening status, and printing options before you go.</p>
    <form onSubmit={runSearch} style={{ display: 'flex', gap: 8, margin: '18px 0' }}>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search locality or PIN code" aria-label="Search locality or PIN code" style={{ flex: 1, padding: '12px 14px', border: '1px solid #d1d5db', borderRadius: 10 }} />
      <button type="submit" style={{ border: 0, borderRadius: 10, background: '#4f46e5', color: '#fff', padding: '0 16px', fontWeight: 700 }}>Search</button>
    </form>
    {!loading && !shops.length && !error && <p style={{ color: '#4b5563' }}>Allow location access, or search by your campus/locality or PIN code.</p>}
    {loading && <p>Finding available shops…</p>}
    {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
    {shops.map((shop) => <article key={shop.shop_code} style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><div><h2 style={{ margin: 0, fontSize: 19 }}>{shop.name}</h2><p style={{ margin: '6px 0', color: '#4b5563' }}>{[shop.address_line, shop.locality, shop.pincode].filter(Boolean).join(', ')}</p></div><strong style={{ whiteSpace: 'nowrap' }}>{shop.distance_km == null ? 'Search result' : `${shop.distance_km} km`}</strong></div>
      <p style={{ margin: '8px 0' }}>{shop.open_status?.is_open ? '● Open now' : `● Closed${shop.open_status?.reason === 'manual_override' ? ' temporarily' : ''}`} · {shop.remote_orders_available ? 'Remote orders available' : 'Counter service'}</p>
      <p style={{ color: '#4b5563', margin: '8px 0' }}>{shop.capabilities?.bw_printing ? 'B&W' : ''}{shop.capabilities?.colour_printing ? ' · Colour' : ''}{shop.capabilities?.a3_paper ? ' · A3' : ''}{shop.capabilities?.duplex_printing ? ' · Duplex' : ''}</p>
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}><Link to={`/print/${encodeURIComponent(shop.shop_code)}?entry=saved_shop`} style={{ background: '#4f46e5', color: '#fff', borderRadius: 9, padding: '10px 13px', textDecoration: 'none', fontWeight: 700 }}>Start print</Link>{shop.maps_url && <a href={shop.maps_url} target="_blank" rel="noreferrer" style={{ border: '1px solid #4f46e5', color: '#4338ca', borderRadius: 9, padding: '10px 13px', textDecoration: 'none', fontWeight: 700 }}>Directions</a>}</div>
    </article>)}
  </main>;
}
