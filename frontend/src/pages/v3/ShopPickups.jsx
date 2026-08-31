import React, { useState, useEffect } from 'react';
import { CheckCircle2, Clock, ShieldCheck, AlertTriangle, Search, PackageCheck, AlertCircle, RefreshCw, X } from 'lucide-react';
import { v3Api } from '../../services/v3Api';
import './shopConsole.css';

export default function ShopPickups() {
  const [pickups, setPickups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeFilter, setActiveFilter] = useState(''); // '' means all, or 'ready_for_pickup', 'hold_expired', 'collected', 'no_show'
  
  // Redeem bar state
  const [codeInput, setCodeInput] = useState('');
  const [redeemLoading, setRedeemLoading] = useState(false);
  const [redeemMessage, setRedeemMessage] = useState(null); // { type: 'success' | 'error', text: '' }

  // Modals state
  const [activeModal, setActiveModal] = useState(null); // { type: 'manual' | 'no_show', pickup: ... }
  const [reasonInput, setReasonInput] = useState('');
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState('');

  const getCsrfToken = () => sessionStorage.getItem('v3_csrf_token') || '';

  const fetchPickups = async () => {
    setLoading(true);
    try {
      const res = await v3Api.listShopPickups(activeFilter, 50);
      setPickups(res.pickups || []);
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to load shop pickups');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPickups();
    const interval = setInterval(fetchPickups, 8000);
    return () => clearInterval(interval);
  }, [activeFilter]);

  const handleRedeemCode = async (e) => {
    if (e) e.preventDefault();
    const cleanCode = codeInput.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!cleanCode || cleanCode.length !== 8) {
      setRedeemMessage({ type: 'error', text: 'Please enter a valid 8-character pickup code.' });
      return;
    }

    setRedeemLoading(true);
    setRedeemMessage(null);

    // Find the pickup with matching code if in list or search across ready pickups
    // Since code is verified server-side, find candidate pickup ID from active list or prompt
    const candidate = pickups.find((p) => p.status === 'ready_for_pickup' || p.status === 'hold_expired');
    if (!candidate) {
      // Try with first eligible pickup in list
      setRedeemMessage({ type: 'error', text: 'No active pickup found in current queue. Please select a specific pickup card below to verify.' });
      setRedeemLoading(false);
      return;
    }

    try {
      const csrf = getCsrfToken();
      await v3Api.collectPickupWithCode(candidate.id, csrf, { code: cleanCode, method: 'code' });
      setRedeemMessage({ type: 'success', text: `Pickup code verified! Order collected successfully.` });
      setCodeInput('');
      fetchPickups();
    } catch (err) {
      setRedeemMessage({ type: 'error', text: err.message || 'Invalid pickup code or order not eligible for collection.' });
    } finally {
      setRedeemLoading(false);
    }
  };

  const handleDirectRedeem = async (pickupId) => {
    const code = prompt('Enter the customer’s 8-character pickup code:');
    if (!code) return;
    const cleanCode = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (cleanCode.length !== 8) {
      alert('Pickup code must be exactly 8 characters.');
      return;
    }

    try {
      const csrf = getCsrfToken();
      await v3Api.collectPickupWithCode(pickupId, csrf, { code: cleanCode, method: 'code' });
      alert('Pickup verified and marked as collected!');
      fetchPickups();
    } catch (err) {
      alert(`Redemption failed: ${err.message || 'Invalid code'}`);
    }
  };

  const handleModalSubmit = async () => {
    if (!activeModal || !reasonInput.trim()) return;
    if (reasonInput.trim().length < 10) {
      setModalError('A detailed reason of at least 10 characters is required.');
      return;
    }

    setModalLoading(true);
    setModalError('');
    const csrf = getCsrfToken();

    try {
      if (activeModal.type === 'manual') {
        const idemKey = `manual-${activeModal.pickup.id}-${Date.now()}`;
        await v3Api.manualCollectPickup(activeModal.pickup.id, csrf, idemKey, { reason: reasonInput.trim() });
      } else if (activeModal.type === 'no_show') {
        await v3Api.recordPickupNoShow(activeModal.pickup.id, csrf, { reason: reasonInput.trim() });
      }
      setActiveModal(null);
      setReasonInput('');
      fetchPickups();
    } catch (err) {
      setModalError(err.message || 'Operation failed');
    } finally {
      setModalLoading(false);
    }
  };

  const formatTime = (iso) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  const getStatusBadge = (st) => {
    const map = {
      ready_for_pickup: { bg: '#e0f2fe', color: '#0369a1', label: 'Ready for Pickup' },
      hold_expired: { bg: '#fef3c7', color: '#b45309', label: 'Hold Expired' },
      collected: { bg: '#dcfce7', color: '#15803d', label: 'Collected' },
      no_show: { bg: '#fee2e2', color: '#b91c1c', label: 'No-Show' },
      voided: { bg: '#f1f5f9', color: '#64748b', label: 'Voided' },
      awaiting_print: { bg: '#f1f5f9', color: '#475569', label: 'Awaiting Print' },
    };
    const s = map[st] || { bg: '#f1f5f9', color: '#475569', label: st };
    return (
      <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: s.bg, color: s.color }}>
        {s.label}
      </span>
    );
  };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: '0 0 4px', fontSize: 24, color: '#0f172a' }}>Pickup & Collection Management</h1>
          <p style={{ margin: 0, color: '#64748b', fontSize: 14 }}>
            Verify customer pickup codes, handle hold expirations, and record manual collections.
          </p>
        </div>
        <button
          onClick={fetchPickups}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 14px',
            background: '#ffffff',
            border: '1px solid #cbd5e1',
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: 13,
            color: '#334155',
          }}
        >
          <RefreshCw size={14} /> Refresh Queue
        </button>
      </div>

      {/* Quick Verification Bar */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          padding: 20,
          marginBottom: 24,
          boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <ShieldCheck size={18} color="#0284c7" />
          <h3 style={{ margin: 0, fontSize: 16, color: '#0f172a' }}>Quick Code Verification</h3>
        </div>
        <form onSubmit={handleRedeemCode} style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Enter 8-character customer code (e.g. 23AB78KL)"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            maxLength={10}
            style={{
              flex: '1 1 280px',
              padding: '10px 14px',
              fontFamily: 'monospace',
              fontSize: 16,
              letterSpacing: 1.5,
              textTransform: 'uppercase',
              border: '1px solid #cbd5e1',
              borderRadius: 8,
            }}
          />
          <button
            type="submit"
            disabled={redeemLoading}
            style={{
              padding: '10px 20px',
              background: '#0284c7',
              color: '#ffffff',
              border: 'none',
              borderRadius: 8,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {redeemLoading ? 'Verifying...' : 'Verify & Collect'}
          </button>
        </form>

        {redeemMessage && (
          <div
            style={{
              marginTop: 12,
              padding: '8px 12px',
              borderRadius: 6,
              fontSize: 13,
              background: redeemMessage.type === 'success' ? '#dcfce7' : '#fee2e2',
              color: redeemMessage.type === 'success' ? '#166534' : '#991b1b',
              border: `1px solid ${redeemMessage.type === 'success' ? '#bbf7d0' : '#fecaca'}`,
            }}
          >
            {redeemMessage.text}
          </div>
        )}
      </div>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, overflowX: 'auto', paddingBottom: 4 }}>
        {[
          { label: 'All Pickups', val: '' },
          { label: 'Ready for Pickup', val: 'ready_for_pickup' },
          { label: 'Hold Expired', val: 'hold_expired' },
          { label: 'Collected', val: 'collected' },
          { label: 'No-Show', val: 'no_show' },
        ].map((tab) => (
          <button
            key={tab.val}
            onClick={() => setActiveFilter(tab.val)}
            style={{
              padding: '6px 14px',
              borderRadius: 20,
              border: '1px solid',
              borderColor: activeFilter === tab.val ? '#0284c7' : '#e2e8f0',
              background: activeFilter === tab.val ? '#0284c7' : '#ffffff',
              color: activeFilter === tab.val ? '#ffffff' : '#475569',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Pickups Table / Cards */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading pickup queue...</div>
      ) : error ? (
        <div style={{ padding: 16, background: '#fee2e2', color: '#991b1b', borderRadius: 8 }}>{error}</div>
      ) : pickups.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', background: '#ffffff', borderRadius: 12, border: '1px solid #e2e8f0', color: '#64748b' }}>
          No pickups found in this view.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {pickups.map((p) => (
            <div
              key={p.id}
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: 10,
                padding: '14px 18px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <strong style={{ fontSize: 14, color: '#0f172a' }}>Order #{p.order_id?.slice(0, 8)}</strong>
                  {getStatusBadge(p.status)}
                </div>
                <div style={{ fontSize: 12, color: '#64748b', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  <span>Ready: {formatTime(p.ready_at)}</span>
                  <span>Hold until: {formatTime(p.hold_until)}</span>
                  {p.collection_method && <span>Method: {p.collection_method}</span>}
                  {p.no_show_reason && <span>Reason: {p.no_show_reason}</span>}
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8 }}>
                {(p.status === 'ready_for_pickup' || p.status === 'hold_expired') && (
                  <button
                    onClick={() => handleDirectRedeem(p.id)}
                    style={{
                      padding: '6px 12px',
                      background: '#0284c7',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Enter Code
                  </button>
                )}

                {(p.status === 'ready_for_pickup' || p.status === 'hold_expired') && (
                  <button
                    onClick={() => {
                      setActiveModal({ type: 'manual', pickup: p });
                      setReasonInput('');
                      setModalError('');
                    }}
                    style={{
                      padding: '6px 12px',
                      background: '#f8fafc',
                      color: '#475569',
                      border: '1px solid #cbd5e1',
                      borderRadius: 6,
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    Manual Override
                  </button>
                )}

                {p.status === 'hold_expired' && (
                  <button
                    onClick={() => {
                      setActiveModal({ type: 'no_show', pickup: p });
                      setReasonInput('');
                      setModalError('');
                    }}
                    style={{
                      padding: '6px 12px',
                      background: '#fff1f2',
                      color: '#be123c',
                      border: '1px solid #fecdd3',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Record No-Show
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal for Manual Collect & No-Show */}
      {activeModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 14,
              padding: 24,
              maxWidth: 480,
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 18, color: '#0f172a' }}>
                {activeModal.type === 'manual' ? 'Manual Collection Override' : 'Record Customer No-Show'}
              </h3>
              <button
                onClick={() => setActiveModal(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}
              >
                <X size={20} />
              </button>
            </div>

            <p style={{ margin: '0 0 16px', fontSize: 13, color: '#64748b' }}>
              {activeModal.type === 'manual'
                ? 'Use manual override only when a customer collected in person but code verification was not possible. An audited reason of 10–500 characters is required.'
                : 'Recording a no-show confirms the customer did not collect within the published hold period. No financial debt is created.'}
            </p>

            <textarea
              rows={3}
              placeholder="Enter detailed reason (10 to 500 characters)..."
              value={reasonInput}
              onChange={(e) => setReasonInput(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #cbd5e1',
                fontSize: 13,
                boxSizing: 'border-box',
                marginBottom: 12,
              }}
            />

            {modalError && (
              <div style={{ padding: '8px 12px', background: '#fee2e2', color: '#991b1b', borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
                {modalError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                style={{
                  padding: '8px 16px',
                  background: '#f1f5f9',
                  color: '#475569',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleModalSubmit}
                disabled={modalLoading}
                style={{
                  padding: '8px 16px',
                  background: activeModal.type === 'manual' ? '#0284c7' : '#dc2626',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 6,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                {modalLoading ? 'Saving...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
