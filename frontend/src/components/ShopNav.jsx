import { Link, useLocation, useParams } from 'react-router-dom';

export default function ShopNav() {
  const { shopId } = useParams();
  const location = useLocation();
  const isV3 = location.pathname.startsWith('/v3/console');
  const path = (page) => isV3 ? `/v3/console/${shopId}/${page}` : `/shop/${shopId}/${page}`;

  const links = [
    { name: 'Dashboard', path: path('dashboard') },
    { name: 'Production', path: path('production') },
    { name: 'Print Queue', path: isV3 ? '/v3/console/queue' : `/shop/${shopId}/console` },
    { name: 'Customers', path: path('customers') },
    { name: 'Files', path: path('files') },
    { name: 'Payments', path: path('payments') },
    { name: 'Ledger', path: path('ledger') },
    { name: 'Rates', path: path('rates') }
  ];

  return (
    <div style={{
      display: 'flex',
      gap: 16,
      background: 'var(--bg-card)',
      padding: '12px 24px',
      borderBottom: '1px solid var(--border)',
      marginBottom: '20px',
      overflowX: 'auto',
      whiteSpace: 'nowrap'
    }}>
      {links.map(link => {
        const isActive = location.pathname.includes(link.path);
        return (
          <Link
            key={link.name}
            to={link.path}
            style={{
              textDecoration: 'none',
              padding: '8px 16px',
              borderRadius: 8,
              fontSize: '0.9rem',
              fontWeight: '600',
              color: isActive ? 'var(--primary-light)' : 'var(--text-muted)',
              background: isActive ? 'var(--primary-dim)' : 'transparent',
              transition: 'all 0.2s'
            }}
          >
            {link.name}
          </Link>
        );
      })}
    </div>
  );
}
