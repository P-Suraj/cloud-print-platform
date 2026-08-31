import React, { useState, useEffect } from 'react';
import { ShieldCheck, Clock, AlertCircle, Save, CheckCircle2 } from 'lucide-react';
import { v3Api } from '../../services/v3Api';
import './shopConsole.css';

export default function ShopPickupPolicy() {
  const [enabled, setEnabled] = useState(false);
  const [holdHours, setHoldHours] = useState(72);
  const [noShowRestricts, setNoShowRestricts] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const getCsrfToken = () => sessionStorage.getItem('v3_csrf_token') || '';

  useEffect(() => {
    v3Api
      .getShopPickupPolicy()
      .then((res) => {
        const p = res.policy || {};
        setEnabled(Boolean(p.pickup_workflow_enabled));
        setHoldHours(Math.round((p.hold_period_minutes || 4320) / 60));
        setNoShowRestricts(p.no_show_disables_unpaid_preprint !== false);
        setError('');
      })
      .catch((err) => {
        setError(err.message || 'Failed to load policy');
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');

    const holdMinutes = Math.min(20160, Math.max(720, holdHours * 60));
    const csrf = getCsrfToken();

    try {
      await v3Api.updateShopPickupPolicy(csrf, {
        pickup_workflow_enabled: enabled,
        hold_period_minutes: holdMinutes,
        reminder_offsets_minutes: [],
        no_show_disables_unpaid_preprint: noShowRestricts,
      });
      setSuccess('Pickup policy updated successfully!');
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      setError(err.message || 'Failed to update pickup policy');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading pickup policy...</div>;
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 24, color: '#0f172a' }}>Shop Pickup & Hold Policy</h1>
        <p style={{ margin: 0, color: '#64748b', fontSize: 14 }}>
          Configure pickup rules, hold periods, and collection verification for remote print orders.
        </p>
      </div>

      <form onSubmit={handleSave} style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
        {/* Enable Toggle */}
        <div style={{ paddingBottom: 20, borderBottom: '1px solid #f1f5f9', marginBottom: 20 }}>
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
            <div>
              <strong style={{ fontSize: 16, color: '#0f172a' }}>Enable Pickup Workflow</strong>
              <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 13 }}>
                Generate secure pickup codes and hold periods after verified printing.
              </p>
            </div>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              style={{ width: 20, height: 20, cursor: 'pointer', accentColor: '#0284c7' }}
            />
          </label>
        </div>

        {/* Hold Period */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', marginBottom: 6 }}>
            <strong style={{ fontSize: 14, color: '#0f172a' }}>Document Hold Duration (Hours)</strong>
            <p style={{ margin: '2px 0 8px', color: '#64748b', fontSize: 13 }}>
              How long printed documents are held before marking hold-expired. (Min 12 hrs, max 336 hrs / 14 days)
            </p>
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input
              type="number"
              min={12}
              max={336}
              value={holdHours}
              onChange={(e) => setHoldHours(Number(e.target.value))}
              style={{
                width: 100,
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid #cbd5e1',
                fontSize: 14,
              }}
            />
            <span style={{ fontSize: 13, color: '#64748b' }}>
              = {(holdHours / 24).toFixed(1)} days
            </span>
          </div>
        </div>

        {/* Trust Policy */}
        <div style={{ paddingBottom: 20, borderBottom: '1px solid #f1f5f9', marginBottom: 20 }}>
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
            <div>
              <strong style={{ fontSize: 14, color: '#0f172a' }}>Restrict Unpaid Preprints on Verified No-Show</strong>
              <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 13 }}>
                If a customer does not collect a document, require counter arrival for future unpaid orders at this shop.
              </p>
            </div>
            <input
              type="checkbox"
              checked={noShowRestricts}
              onChange={(e) => setNoShowRestricts(e.target.checked)}
              style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#0284c7' }}
            />
          </label>
        </div>

        {/* Status Messages */}
        {error && (
          <div style={{ padding: '10px 14px', background: '#fee2e2', color: '#991b1b', borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}
        {success && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: '#dcfce7', color: '#166534', borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
            <CheckCircle2 size={16} />
            <span>{success}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={saving}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 20px',
            background: '#0284c7',
            color: '#ffffff',
            border: 'none',
            borderRadius: 8,
            fontWeight: 600,
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          <Save size={16} />
          {saving ? 'Saving Changes...' : 'Save Policy'}
        </button>
      </form>
    </div>
  );
}
