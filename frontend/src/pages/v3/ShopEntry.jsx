import React, { useState } from 'react';
import { ArrowRight, Bookmark, MapPin, QrCode, Store, Trash2 } from 'lucide-react';
import { isValidShopCode, normalizeShopCode } from '../../lib/savedShops';

export default function ShopEntry({ savedShops, error, loading, onSelectShop, onRemoveSaved }) {
  const [shopCode, setShopCode] = useState('');
  const [localError, setLocalError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    const normalized = normalizeShopCode(shopCode);
    if (!isValidShopCode(normalized)) {
      setLocalError('Enter a valid shop code using 3–20 letters or numbers.');
      return;
    }
    setLocalError('');
    await onSelectShop(normalized, 'shop_code');
  };

  return (
    <div className="v3-customer-container v3-entry-container">
      <section className="v3-entry-hero">
        <span className="v3-eyebrow"><Store size={14} /> Choose where to print</span>
        <h1>Your print shop,<br /><em>already connected.</em></h1>
        <p>Scan the shop QR, enter its code, or reopen a shop saved on this device. Every option continues inside AutoPrint.</p>
      </section>

      <div className="v3-entry-grid">
        <section className="v3-entry-card v3-code-card">
          <span className="v3-entry-icon"><MapPin size={23} /></span>
          <div><h2>Enter shop code</h2><p>The code is printed near the shop QR or available from the counter.</p></div>
          <form className="v3-shop-code-form" onSubmit={handleSubmit}>
            <label htmlFor="v3-shop-code">Shop code</label>
            <div>
              <input
                id="v3-shop-code"
                value={shopCode}
                onChange={(event) => { setShopCode(event.target.value.toUpperCase()); setLocalError(''); }}
                placeholder="Example: CANARY01"
                autoCapitalize="characters"
                autoComplete="off"
                maxLength={20}
              />
              <button type="submit" disabled={loading}>{loading ? 'Checking…' : <>Continue <ArrowRight size={17} /></>}</button>
            </div>
          </form>
          {(localError || error) && <p className="v3-entry-error" role="alert">{localError || error}</p>}
        </section>

        <section className="v3-entry-card v3-qr-card">
          <span className="v3-entry-icon qr"><QrCode size={25} /></span>
          <div><h2>Scan the shop QR</h2><p>Use your phone camera to scan the AutoPrint QR displayed at the shop. The QR opens this same app with that shop already selected—there is no separate kiosk or redirected software.</p></div>
          <div className="v3-qr-steps"><span>1</span> Open camera <i /> <span>2</span> Scan QR <i /> <span>3</span> Upload here</div>
        </section>
      </div>

      <section className="v3-saved-section" aria-labelledby="saved-shops-heading">
        <div className="v3-saved-heading">
          <div><span className="v3-entry-icon saved"><Bookmark size={21} /></span><div><h2 id="saved-shops-heading">Saved shops</h2><p>Stored only on this device for quick access.</p></div></div>
          <span>{savedShops.length}/10</span>
        </div>
        {savedShops.length > 0 ? (
          <div className="v3-saved-list">
            {savedShops.map(shop => (
              <article key={shop.shopCode} className="v3-saved-shop">
                <button className="v3-saved-open" type="button" onClick={() => onSelectShop(shop.shopCode, 'saved_shop')} disabled={loading}>
                  <span className="v3-shop-avatar">{shop.name.slice(0, 1).toUpperCase()}</span>
                  <span><strong>{shop.name}</strong><small>{shop.shopCode}</small></span><ArrowRight size={18} />
                </button>
                <button className="v3-saved-remove" type="button" onClick={() => onRemoveSaved(shop.shopCode)} aria-label={`Remove ${shop.name} from saved shops`}><Trash2 size={16} /></button>
              </article>
            ))}
          </div>
        ) : (
          <div className="v3-saved-empty"><Bookmark size={22} /><span><strong>No saved shops yet</strong>Open a shop and tap “Save shop” to keep it here.</span></div>
        )}
      </section>
    </div>
  );
}
