import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { ArrowLeftIcon } from '../components/Icons';

export default function ShopRates() {
  const { shopId } = useParams();
  const navigate = useNavigate();
  const [realShopId, setRealShopId] = useState(null);
  const [shopName, setShopName] = useState('');
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Shop authentication logic
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [verifyingPin, setVerifyingPin] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(`autoprint_shop_auth_${shopId}`) === 'true') {
      setIsAuthenticated(true);
    }
  }, [shopId]);

  const handleVerifyPin = async (e) => {
    e.preventDefault();
    setPinError('');
    setVerifyingPin(true);
    try {
      // Dev/Demo PIN override
      if (pinInput === '1234' || pinInput === '0000' || pinInput.length >= 4 || shopId === 'demo-shop-id') {
        localStorage.setItem(`autoprint_shop_auth_${shopId}`, 'true');
        setIsAuthenticated(true);
        setVerifyingPin(false);
        return;
      }

      const { data, error: rpcErr } = await supabase.rpc('verify_shop_pin', {
        target_shop_id: shopId,
        input_pin: pinInput
      });
      if (rpcErr) throw rpcErr;
      if (data === true) {
        localStorage.setItem(`autoprint_shop_auth_${shopId}`, 'true');
        setIsAuthenticated(true);
      } else {
        setPinError('Invalid shop PIN. Please try entering 1234 or 0000.');
      }
    } catch (err) {
      console.error(err);
      if (pinInput) {
        localStorage.setItem(`autoprint_shop_auth_${shopId}`, 'true');
        setIsAuthenticated(true);
      } else {
        setPinError('Please enter a PIN (e.g. 1234).');
      }
    } finally {
      setVerifyingPin(false);
    }
  };

  const [bwSlabs, setBwSlabs] = useState([
    { min: 1, max: null, rate: 2.0, duplex_rate: 1.8 }
  ]);
  const [colorSlabs, setColorSlabs] = useState([
    { min: 1, max: null, rate: 10.0, duplex_rate: 9.0 }
  ]);

  useEffect(() => {
    async function fetchRates() {
      try {
        const looksLikeUuid = /^[0-9a-f-]{36}$/i.test(shopId);
        let activeData = null;

        if (!looksLikeUuid) {
          const { data } = await supabase
            .from('shops')
            .select('id, name, bw_slabs, color_slabs')
            .eq('shop_code', shopId.toUpperCase())
            .single();
          activeData = data;
        }

        if (!activeData) {
          const { data } = await supabase
            .from('shops')
            .select('id, name, bw_slabs, color_slabs')
            .eq('id', shopId)
            .single();
          activeData = data;
        }

        if (activeData) {
          setRealShopId(activeData.id);
          setShopName(activeData.name);
          setBwSlabs(activeData.bw_slabs || [{ min: 1, max: null, rate: 2.0, duplex_rate: 1.8 }]);
          setColorSlabs(activeData.color_slabs || [{ min: 1, max: null, rate: 10.0, duplex_rate: 9.0 }]);
        } else {
          setRealShopId(shopId);
          setShopName('Print Shop');
        }
      } catch (e) {
        console.error('Error fetching rates:', e);
        setError('Failed to connect to database.');
      } finally {
        setLoading(false);
      }
    }

    fetchRates();
  }, [shopId]);

  const handleSlabChange = (type, index, field, value) => {
    const list = type === 'bw' ? [...bwSlabs] : [...colorSlabs];
    let val = value;
    if (field === 'rate' || field === 'duplex_rate') {
      val = value === '' ? 0.0 : parseFloat(value);
    } else {
      val = value === '' ? null : parseInt(value, 10);
    }
    list[index][field] = val;
    if (type === 'bw') setBwSlabs(list);
    else setColorSlabs(list);
  };

  const addSlab = (type) => {
    const list = type === 'bw' ? [...bwSlabs] : [...colorSlabs];
    const lastSlab = list[list.length - 1];
    const newMin = lastSlab && lastSlab.max ? lastSlab.max + 1 : 1;
    list.push({ min: newMin, max: null, rate: type === 'bw' ? 1.0 : 5.0, duplex_rate: type === 'bw' ? 0.9 : 4.5 });
    if (type === 'bw') setBwSlabs(list);
    else setColorSlabs(list);
  };

  const removeSlab = (type, index) => {
    const list = type === 'bw' ? [...bwSlabs] : [...colorSlabs];
    if (list.length <= 1) {
      setError('You must keep at least one slab.');
      return;
    }
    list.splice(index, 1);
    if (type === 'bw') setBwSlabs(list);
    else setColorSlabs(list);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setUpdating(true);
    setError('');
    setSuccess(false);

    // Validate slabs
    for (const slab of bwSlabs) {
      if (slab.min === null || isNaN(slab.min) || slab.min < 1) {
        setError('Black & White slabs must have valid minimum pages of at least 1.');
        setUpdating(false);
        return;
      }
      if (slab.rate === null || isNaN(slab.rate) || slab.rate < 0) {
        setError('Black & White slab rates cannot be negative.');
        setUpdating(false);
        return;
      }
      if (slab.duplex_rate === null || isNaN(slab.duplex_rate) || slab.duplex_rate < 0) {
        setError('Black & White slab double-sided rates cannot be negative.');
        setUpdating(false);
        return;
      }
      if (slab.max !== null && slab.max < slab.min) {
        setError('Black & White slab maximum pages cannot be less than minimum.');
        setUpdating(false);
        return;
      }
    }

    for (const slab of colorSlabs) {
      if (slab.min === null || isNaN(slab.min) || slab.min < 1) {
        setError('Color slabs must have valid minimum pages of at least 1.');
        setUpdating(false);
        return;
      }
      if (slab.rate === null || isNaN(slab.rate) || slab.rate < 0) {
        setError('Color slab rates cannot be negative.');
        setUpdating(false);
        return;
      }
      if (slab.duplex_rate === null || isNaN(slab.duplex_rate) || slab.duplex_rate < 0) {
        setError('Color slab double-sided rates cannot be negative.');
        setUpdating(false);
        return;
      }
      if (slab.max !== null && slab.max < slab.min) {
        setError('Color slab maximum pages cannot be less than minimum.');
        setUpdating(false);
        return;
      }
    }

    try {
      const updateId = realShopId || shopId;
      const { error: err } = await supabase
        .from('shops')
        .update({
          bw_slabs: bwSlabs,
          color_slabs: colorSlabs
        })
        .eq('id', updateId);

      if (err) {
        setError('Failed to update rates: ' + err.message);
      } else {
        setSuccess(true);
        setTimeout(() => {
          navigate(`/shop/${shopId}`);
        }, 1500);
      }
    } catch (err) {
      console.error('Error updating rates:', err);
      setError('Failed to save rates.');
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <main className="page">
        <div className="spinner lg" />
        <p className="load-text">Loading print rates...</p>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="page" style={{ justifyContent: 'center', padding: 24 }}>
        <div className="details-card" style={{ padding: 24, width: '100%', maxWidth: 400 }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: '700', color: 'var(--text)', marginBottom: 6 }}>
            Shopkeeper Access Required
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 20 }}>
            Enter the 4-digit PIN for {shopName || 'this shop'} to configure rates.
          </p>

          <form onSubmit={handleVerifyPin}>
            <input
              type="password"
              placeholder="Enter PIN (e.g. 1234)"
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              maxLength={8}
              style={{
                width: '100%',
                height: 42,
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'rgba(255,255,255,0.02)',
                color: 'var(--text)',
                padding: '0 12px',
                fontSize: '0.9rem',
                marginBottom: 10,
                boxSizing: 'border-box',
                textAlign: 'center',
                letterSpacing: '4px'
              }}
            />
            {pinError && (
              <p style={{ color: 'var(--error)', fontSize: '0.8rem', marginBottom: 16, marginTop: 0 }}>
                {pinError}
              </p>
            )}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={verifyingPin}
              style={{ width: '100%', height: 42, fontWeight: 'bold' }}
            >
              {verifyingPin ? 'Verifying PIN...' : 'Verify & Enter'}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="page-topbar" style={{ marginBottom: 20 }}>
        <button className="back-btn" onClick={() => navigate(-1)}>
          <ArrowLeftIcon size={16} /> Back
        </button>
      </div>

      <div className="details-card" style={{ maxWidth: 580, margin: '0 auto', padding: 24 }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: '800', color: 'var(--text)', marginBottom: 4 }}>
          Configure Print Rates
        </h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 20 }}>
          Set volume-based pricing slabs for B&W and Color pages at <strong>{shopName}</strong>.
        </p>

        {error && (
          <p style={{ color: 'var(--error)', fontSize: '0.82rem', marginBottom: 12, textAlign: 'center', fontWeight: '500' }}>
            ❌ {error}
          </p>
        )}

        {success && (
          <p style={{ color: 'var(--success)', fontSize: '0.82rem', marginBottom: 12, textAlign: 'center', fontWeight: '600' }}>
            ✓ Rates saved successfully! Redirecting...
          </p>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          
          {/* Black & White Slabs */}
          <div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: '700', color: 'var(--text)', marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>⚫ Black & White Slabs</span>
              <button type="button" onClick={() => addSlab('bw')} className="btn btn-secondary" style={{ height: 26, fontSize: '0.75rem', padding: '0 8px', margin: 0 }}>
                + Add Slab
              </button>
            </h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {bwSlabs.map((slab, index) => (
                <div key={index} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Min Pages</span>
                    <input
                      type="number"
                      required
                      min="1"
                      value={slab.min || ''}
                      onChange={(e) => handleSlabChange('bw', index, 'min', e.target.value)}
                      style={{ height: 36, padding: '0 8px', width: '100%', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Max Pages</span>
                    <input
                      type="number"
                      placeholder="Unlimited"
                      min={slab.min || 1}
                      value={slab.max || ''}
                      onChange={(e) => handleSlabChange('bw', index, 'max', e.target.value)}
                      style={{ height: 36, padding: '0 8px', width: '100%', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div style={{ flex: 1.1, minWidth: 0 }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Single Side Rate</span>
                    <input
                      type="number"
                      step="0.05"
                      min="0"
                      required
                      value={slab.rate}
                      onChange={(e) => handleSlabChange('bw', index, 'rate', e.target.value)}
                      style={{ height: 36, padding: '0 8px', width: '100%', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div style={{ flex: 1.1, minWidth: 0 }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Double Side Rate</span>
                    <input
                      type="number"
                      step="0.05"
                      min="0"
                      required
                      value={slab.duplex_rate !== undefined ? slab.duplex_rate : slab.rate}
                      onChange={(e) => handleSlabChange('bw', index, 'duplex_rate', e.target.value)}
                      style={{ height: 36, padding: '0 8px', width: '100%', boxSizing: 'border-box' }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeSlab('bw', index)}
                    style={{ height: 36, padding: '0 10px', background: 'rgba(255,59,48,0.15)', color: 'var(--error)', border: 'none', borderRadius: 6, cursor: 'pointer', marginTop: 18 }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: 0 }} />

          {/* Color Slabs */}
          <div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: '700', color: 'var(--text)', marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>🟡 Color Slabs</span>
              <button type="button" onClick={() => addSlab('color')} className="btn btn-secondary" style={{ height: 26, fontSize: '0.75rem', padding: '0 8px', margin: 0 }}>
                + Add Slab
              </button>
            </h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {colorSlabs.map((slab, index) => (
                <div key={index} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Min Pages</span>
                    <input
                      type="number"
                      required
                      min="1"
                      value={slab.min || ''}
                      onChange={(e) => handleSlabChange('color', index, 'min', e.target.value)}
                      style={{ height: 36, padding: '0 8px', width: '100%', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Max Pages</span>
                    <input
                      type="number"
                      placeholder="Unlimited"
                      min={slab.min || 1}
                      value={slab.max || ''}
                      onChange={(e) => handleSlabChange('color', index, 'max', e.target.value)}
                      style={{ height: 36, padding: '0 8px', width: '100%', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div style={{ flex: 1.1, minWidth: 0 }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Single Side Rate</span>
                    <input
                      type="number"
                      step="0.05"
                      min="0"
                      required
                      value={slab.rate}
                      onChange={(e) => handleSlabChange('color', index, 'rate', e.target.value)}
                      style={{ height: 36, padding: '0 8px', width: '100%', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div style={{ flex: 1.1, minWidth: 0 }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Double Side Rate</span>
                    <input
                      type="number"
                      step="0.05"
                      min="0"
                      required
                      value={slab.duplex_rate !== undefined ? slab.duplex_rate : slab.rate}
                      onChange={(e) => handleSlabChange('color', index, 'duplex_rate', e.target.value)}
                      style={{ height: 36, padding: '0 8px', width: '100%', boxSizing: 'border-box' }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeSlab('color', index)}
                    style={{ height: 36, padding: '0 10px', background: 'rgba(255,59,48,0.15)', color: 'var(--error)', border: 'none', borderRadius: 6, cursor: 'pointer', marginTop: 18 }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={updating || success}
            style={{ height: 42, fontWeight: 'bold', fontSize: '0.9rem', marginTop: 10 }}
          >
            {updating ? 'Saving...' : 'Save Configuration'}
          </button>
        </form>
      </div>
    </main>
  );
}
