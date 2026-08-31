import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Copy, Check, MapPin, QrCode, ShieldCheck, AlertCircle } from 'lucide-react';
import PickupQr from './PickupQr';
import { v3Api } from '../../services/v3Api';

export default function PickupCard({ orderId, capabilityToken, pickupData, onRefresh }) {
  const [codeData, setCodeData] = useState(null);
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeError, setCodeError] = useState('');
  const [copied, setCopied] = useState(false);

  const status = pickupData?.status || 'awaiting_print';
  const isActive = status === 'ready_for_pickup' || status === 'hold_expired';
  const isCollected = status === 'collected';
  const isHoldExpired = status === 'hold_expired';
  const isNoShow = status === 'no_show';

  useEffect(() => {
    if (!orderId || !capabilityToken || !isActive) return;

    let isMounted = true;
    setCodeLoading(true);
    v3Api
      .getPickupCode(orderId, capabilityToken)
      .then((res) => {
        if (isMounted) {
          setCodeData(res);
          setCodeError('');
        }
      })
      .catch((err) => {
        if (isMounted) {
          setCodeError(err.message || 'Could not load pickup code');
        }
      })
      .finally(() => {
        if (isMounted) setCodeLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [orderId, capabilityToken, isActive]);

  const handleCopy = () => {
    if (!codeData?.pickup_code) return;
    navigator.clipboard.writeText(codeData.pickup_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatDeadline = (iso) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  const formatCodeDisplay = (code) => {
    if (!code || code.length !== 8) return code;
    return `${code.slice(0, 4)} - ${code.slice(4)}`;
  };

  if (isCollected) {
    return (
      <div style={{ marginTop: 20, padding: 20, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 16, textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', padding: 10, background: '#dcfce7', borderRadius: '50%', color: '#16a34a', marginBottom: 12 }}>
          <CheckCircle2 size={32} />
        </div>
        <h3 style={{ margin: '0 0 6px', color: '#166534', fontSize: 18 }}>Order Collected</h3>
        <p style={{ margin: 0, color: '#15803d', fontSize: 14 }}>
          This print order has been verified and collected. Thank you for using AutoPrint!
        </p>
      </div>
    );
  }

  if (isNoShow) {
    return (
      <div style={{ marginTop: 20, padding: 20, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 16, textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', padding: 10, background: '#fee2e2', borderRadius: '50%', color: '#dc2626', marginBottom: 12 }}>
          <AlertCircle size={32} />
        </div>
        <h3 style={{ margin: '0 0 6px', color: '#991b1b', fontSize: 18 }}>Marked as Uncollected</h3>
        <p style={{ margin: 0, color: '#b91c1c', fontSize: 14 }}>
          The hold period for this document ended. You can still order prints on arrival at the counter.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        marginTop: 20,
        padding: 24,
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: 16,
        boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
        textAlign: 'center',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: '#0284c7', fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        <ShieldCheck size={16} />
        <span>One-Time Pickup Verification</span>
      </div>

      <h2 style={{ margin: '0 0 8px', fontSize: 22, color: '#0f172a' }}>
        {isHoldExpired ? 'Hold Period Expired' : 'Ready for Counter Pickup'}
      </h2>

      <p style={{ margin: '0 0 20px', color: '#64748b', fontSize: 14 }}>
        Show this pickup code or QR to the counter staff to collect your printed document.
      </p>

      {/* Code Display */}
      {codeLoading && (
        <div style={{ padding: 20, background: '#f8fafc', borderRadius: 12, color: '#94a3b8', fontSize: 14 }}>
          Generating secure pickup code...
        </div>
      )}

      {codeError && (
        <div style={{ padding: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#dc2626', fontSize: 13 }}>
          {codeError}
        </div>
      )}

      {codeData?.pickup_code && (
        <div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              padding: '14px 24px',
              background: '#f8fafc',
              border: '2px dashed #cbd5e1',
              borderRadius: 12,
              marginBottom: 18,
            }}
          >
            <span
              style={{
                fontFamily: 'monospace',
                fontSize: 26,
                fontWeight: 700,
                letterSpacing: 2,
                color: '#0f172a',
              }}
            >
              {formatCodeDisplay(codeData.pickup_code)}
            </span>
            <button
              onClick={handleCopy}
              title="Copy code"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: copied ? '#16a34a' : '#64748b',
                display: 'flex',
                alignItems: 'center',
                padding: 4,
              }}
            >
              {copied ? <Check size={18} /> : <Copy size={18} />}
            </button>
          </div>

          {/* QR Code */}
          {codeData.qr_payload && (
            <div style={{ marginBottom: 20 }}>
              <PickupQr payload={codeData.qr_payload} size={160} />
            </div>
          )}
        </div>
      )}

      {/* Hold details */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '12px 16px',
          background: isHoldExpired ? '#fff1f2' : '#f8fafc',
          border: `1px solid ${isHoldExpired ? '#ffe4e6' : '#e2e8f0'}`,
          borderRadius: 10,
          fontSize: 13,
          color: isHoldExpired ? '#9f1239' : '#475569',
          textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Clock size={15} style={{ flexShrink: 0 }} />
          <span>
            <strong>Hold deadline:</strong> {formatDeadline(pickupData?.hold_until)}
          </span>
        </div>
        {pickupData?.shop?.name && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MapPin size={15} style={{ flexShrink: 0 }} />
            <span>
              <strong>Collect at:</strong> {pickupData.shop.name}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
