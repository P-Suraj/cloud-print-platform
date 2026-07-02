import { Link, useLocation, useParams } from 'react-router-dom';

export default function ShopNav() {
  const { shopId } = useParams();
  const location = useLocation();

  const links = [
    { name: 'Dashboard', path: `/shop/${shopId}/dashboard` },
    { name: 'Job Board', path: `/shop/${shopId}/jobs` },
    { name: 'Print Queue', path: `/shop/${shopId}/console` }, // Existing console
    { name: 'Customers', path: `/shop/${shopId}/customers` },
    { name: 'Files', path: `/shop/${shopId}/files` },
    { name: 'Payments', path: `/shop/${shopId}/payments` },
    { name: 'Settings', path: `/shop/${shopId}/rates` }
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
