import React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Headphones, LockKeyhole, Printer } from 'lucide-react';
import './v3Shell.css';

export default function V3Layout() {
  const location = useLocation();
  const isConsole = location.pathname.startsWith('/v3/console');
  const shopId = sessionStorage.getItem('v3_shop_id');

  return (
    <div className="v3-shell">
      <header className="v3-topbar">
        <Link className="v3-brand" to={isConsole ? (shopId ? `/v3/console/${shopId}/dashboard` : '/v3/console/login') : '/print'}>
          <span className="v3-brand-mark" aria-hidden="true"><Printer size={22} strokeWidth={2.4} /></span>
          <span>
            <strong>AutoPrint</strong>
            <small>Print without the queue</small>
          </span>
        </Link>

        <div className="v3-topbar-actions">
          <span className="v3-trust-label"><LockKeyhole size={15} /> Secure document handling</span>
          <Link className="v3-console-link" to={isConsole ? '/print' : '/v3/console/login'}>
            {isConsole ? 'Customer printing' : 'Shop console'}
          </Link>
        </div>
      </header>

      <main className="v3-main"><Outlet /></main>

      <footer className="v3-footer">
        <span>© 2026 AutoPrint</span>
        <span><Headphones size={15} /> Need help? Ask at the print counter.</span>
      </footer>
    </div>
  );
}
