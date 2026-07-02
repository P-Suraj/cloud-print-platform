import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import Home from './pages/Home';
import Demo from './pages/Demo/Demo';
import Status from './pages/Status';
import Shop from './pages/Shop';
import ShopConsole from './pages/ShopConsole';
import ShopRates from './pages/ShopRates';

function InDevelopmentPage() {
  const navigate = useNavigate();
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 20px',
      textAlign: 'center',
      minHeight: '60vh',
      color: 'var(--text)'
    }}>
      <div style={{ fontSize: '3rem', marginBottom: 16 }}>🚧</div>
      <h2 style={{ fontSize: '1.4rem', marginBottom: 8, color: 'var(--primary-light)' }}>Feature Under Development</h2>
      <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', maxWidth: 400, marginBottom: 24, lineHeight: '1.5' }}>
        This management feature is disabled for the university pilot build to keep things focused, simple, and secure.
      </p>
      <button 
        className="btn btn-secondary" 
        onClick={() => navigate(-1)}
        style={{ padding: '8px 20px', fontSize: '0.9rem', fontWeight: 'bold' }}
      >
        Go Back
      </button>
    </div>
  );
}

function App() {
  const location = useLocation();
  const isDemo = location.pathname.startsWith('/demo');

  if (isDemo) {
    return (
      <Routes>
        <Route path="/demo/*" element={<Demo />} />
      </Routes>
    );
  }

  return (
    <div className="app-shell">
      <header className="header">
        <div className="header-center" style={{ margin: '0 auto', textAlign: 'center' }}>
          <div className="header-brand">AutoPrint</div>
          <div className="header-sub">Instant Printing Kiosk</div>
        </div>
      </header>

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/status/:jobId" element={<Status />} />
        <Route path="/shop/:shopId" element={<Shop />} />
        <Route path="/shop/:shopId/console" element={<ShopConsole />} />
        <Route path="/shop/:shopId/rates" element={<ShopRates />} />
        {/* Pilot build: redirect unused management views to a placeholder page */}
        <Route path="/shop/:shopId/ledger" element={<InDevelopmentPage />} />
        <Route path="/shop/:shopId/dashboard" element={<InDevelopmentPage />} />
        <Route path="/shop/:shopId/jobs" element={<InDevelopmentPage />} />
        <Route path="/shop/:shopId/customers" element={<InDevelopmentPage />} />
        <Route path="/shop/:shopId/files" element={<InDevelopmentPage />} />
        <Route path="/shop/:shopId/payments" element={<InDevelopmentPage />} />
      </Routes>
    </div>
  );
}

export default App;
