import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export default function PickupQr({ payload, size = 180 }) {
  const [dataUrl, setDataUrl] = useState('');

  useEffect(() => {
    if (!payload) {
      setDataUrl('');
      return;
    }
    let isMounted = true;
    QRCode.toDataURL(payload, {
      width: size,
      margin: 2,
      color: {
        dark: '#1e293b',
        light: '#ffffff',
      },
    })
      .then((url) => {
        if (isMounted) setDataUrl(url);
      })
      .catch(() => {
        if (isMounted) setDataUrl('');
      });
    return () => {
      isMounted = false;
    };
  }, [payload, size]);

  if (!dataUrl) {
    return (
      <div
        style={{
          width: size,
          height: size,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f8fafc',
          borderRadius: 8,
          border: '1px solid #e2e8f0',
        }}
      >
        <span style={{ fontSize: 12, color: '#94a3b8' }}>Generating QR...</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'inline-block', padding: 8, background: '#ffffff', borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
      <img src={dataUrl} alt="Pickup verification QR code" width={size} height={size} style={{ display: 'block', borderRadius: 6 }} />
    </div>
  );
}
