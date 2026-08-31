import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Download, ExternalLink, Printer, QrCode, SlidersHorizontal } from 'lucide-react';
import QRCode from 'qrcode';
import { useNavigate } from 'react-router-dom';
import './pilotShopDashboard.css';

export default function PilotShopDashboard() {
  const navigate = useNavigate();
  const [qrUrl, setQrUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const shopCode = sessionStorage.getItem('v3_shop_code') || 'CANARY01';
  const shopName = sessionStorage.getItem('v3_shop_name') || 'Test Hub 1';
  const shopId = sessionStorage.getItem('v3_shop_id');
  const customerUrl = useMemo(() => `${window.location.origin}/print/${shopCode}?entry=qr`, [shopCode]);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(customerUrl, { width: 420, margin: 2, color: { dark: '#14213d', light: '#ffffff' } })
      .then((value) => { if (active) setQrUrl(value); })
      .catch(() => { if (active) setQrUrl(''); });
    return () => { active = false; };
  }, [customerUrl]);

  const copyCode = async () => {
    await navigator.clipboard.writeText(shopCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const downloadQr = () => {
    if (!qrUrl) return;
    const link = document.createElement('a');
    link.href = qrUrl;
    link.download = `autoprint-${shopCode}-qr.png`;
    link.click();
  };

  return (
    <div className="pilot-shop-dashboard">
      <header className="pilot-shop-brand"><strong>AutoPrint</strong><span>Instant printing kiosk</span></header>
      <section className="pilot-shop-home">
        <div className="pilot-shop-identity">
          <div className="pilot-shop-code"><span>Shop code</span><strong>{shopCode}</strong></div>
          <div><h1>{shopName}</h1><p>Share your QR at the counter. Students can send their PDF before they arrive.</p></div>
        </div>
        <div className="pilot-shop-home-actions">
          <button className="pilot-manage-button" type="button" onClick={() => navigate(`/v3/console/${shopId}/shms`)}><SlidersHorizontal size={17} /> Shop management</button>
          <button type="button" onClick={() => navigate('/v3/console/queue')}><ExternalLink size={18} /> Open console</button>
        </div>
      </section>

      <section className="pilot-qr-card">
        <div className="pilot-qr-image">
          {qrUrl ? <img src={qrUrl} alt="Customer portal QR code" /> : <span>Generating QR</span>}
        </div>
        <div className="pilot-qr-copy">
          <span className="pilot-shop-kicker"><QrCode size={16} /> Counter sign</span>
          <h2>Let students scan and print</h2>
          <p>Put this QR at your counter. It opens your customer portal with your shop already selected.</p>
          <div className="pilot-qr-actions">
            <button type="button" onClick={copyCode}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? 'Copied' : 'Copy shop code'}</button>
            <button type="button" onClick={downloadQr}><Download size={17} />Download counter QR</button>
          </div>
        </div>
      </section>

      <section className="pilot-shms-card">
        <div><span className="pilot-shop-kicker">Open console</span><h2>Print queue, approvals and history</h2><p>Everything needed to run the counter - nothing else.</p></div>
        <button type="button" onClick={() => navigate('/v3/console/queue')}><Printer size={18} />Open shop console</button>
      </section>
    </div>
  );
}
