import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { ArrowLeftIcon } from '../components/Icons';

export default function ShopLedger() {
  const { shopId } = useParams();
  const navigate = useNavigate();
  const [shopName, setShopName] = useState('');
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Modals
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', company: '' });

  const [showAddLog, setShowAddLog] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [newLog, setNewLog] = useState({ job_description: '', pages: 0, amount: 0 });

  // Authentication
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(`autoprint_shop_auth_${shopId}`) === 'true') {
      setIsAuthenticated(true);
      fetchData();
    } else {
      // If not authenticated, redirect to console which handles PIN
      navigate(`/shop/${shopId}/console`);
    }
  }, [shopId, navigate]);

  const fetchData = async () => {
    try {
      setLoading(true);
      
      // Get Shop
      const { data: shopData } = await supabase
        .from('shops')
        .select('name')
        .eq('id', shopId)
        .single();
      
      if (shopData) setShopName(shopData.name);

      // Get Customers with their outstanding balance
      // We will do a simple join manually for now
      const { data: custData, error: custErr } = await supabase
        .from('customers')
        .select('*')
        .eq('shop_id', shopId)
        .order('name', { ascending: true });
        
      if (custErr) throw custErr;

      const { data: ledgerData, error: ledgerErr } = await supabase
        .from('ledger_entries')
        .select('*')
        .eq('shop_id', shopId)
        .eq('status', 'unbilled');

      if (ledgerErr) throw ledgerErr;

      // Calculate outstanding for each customer
      const customersWithDues = custData.map(c => {
        const dues = ledgerData.filter(l => l.customer_id === c.id);
        const totalAmount = dues.reduce((sum, item) => sum + Number(item.amount), 0);
        const totalPages = dues.reduce((sum, item) => sum + Number(item.pages), 0);
        return {
          ...c,
          outstanding_amount: totalAmount,
          outstanding_pages: totalPages,
          unbilled_jobs: dues.length
        };
      });

      setCustomers(customersWithDues);
    } catch (err) {
      console.error(err);
      setError('Failed to load ledger data.');
    } finally {
      setLoading(false);
    }
  };

  const handleAddCustomer = async (e) => {
    e.preventDefault();
    try {
      const { error: err } = await supabase
        .from('customers')
        .insert([{
          shop_id: shopId,
          name: newCustomer.name,
          phone: newCustomer.phone,
          company: newCustomer.company
        }]);
      if (err) throw err;
      
      setShowAddCustomer(false);
      setNewCustomer({ name: '', phone: '', company: '' });
      fetchData();
    } catch (err) {
      console.error(err);
      alert('Failed to add customer');
    }
  };

  const handleAddLog = async (e) => {
    e.preventDefault();
    try {
      const { error: err } = await supabase
        .from('ledger_entries')
        .insert([{
          shop_id: shopId,
          customer_id: selectedCustomer.id,
          job_description: newLog.job_description,
          pages: parseInt(newLog.pages, 10),
          amount: parseFloat(newLog.amount),
          status: 'unbilled'
        }]);
      if (err) throw err;
      
      setShowAddLog(false);
      setNewLog({ job_description: '', pages: 0, amount: 0 });
      setSelectedCustomer(null);
      fetchData();
    } catch (err) {
      console.error(err);
      alert('Failed to log job');
    }
  };

  if (loading) return <div className="page"><div className="spinner lg" /></div>;

  return (
    <div className="console-layout">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button 
            className="back-btn" 
            onClick={() => navigate(`/shop/${shopId}/console`)} 
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              padding: '6px 12px', 
              borderRadius: 8, 
              background: 'var(--bg-raised)', 
              border: '1px solid var(--border)',
              margin: 0
            }}
          >
            <ArrowLeftIcon size={16} />
            <span style={{ marginLeft: 6, fontWeight: 'bold' }}>Console</span>
          </button>
          <div>
            <h2 style={{ fontSize: '1.4rem', fontWeight: '800', color: 'var(--text)', margin: 0 }}>
              {shopName} PrintKhata (Ledger)
            </h2>
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAddCustomer(true)} style={{ fontWeight: 'bold' }}>
          + New Customer
        </button>
      </header>

      <div className="console-grid" style={{ gridTemplateColumns: '1fr', marginTop: 20 }}>
        <div className="console-panel">
          <div className="console-panel-header">
            <span style={{ fontSize: '1.1rem', fontWeight: '800' }}>Corporate & Regular Customers</span>
          </div>

          <div style={{ padding: 16 }}>
            {customers.length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }}>No customers added yet. Start tracking your corporate clients here.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>Customer</th>
                    <th style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>Company</th>
                    <th style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>Unbilled Jobs</th>
                    <th style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>Pages (Unbilled)</th>
                    <th style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>Outstanding (₹)</th>
                    <th style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map(c => (
                    <tr key={c.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ padding: '12px 8px', fontWeight: 'bold' }}>{c.name}</td>
                      <td style={{ padding: '12px 8px' }}>{c.company || '-'}</td>
                      <td style={{ padding: '12px 8px' }}>{c.unbilled_jobs}</td>
                      <td style={{ padding: '12px 8px' }}>{c.outstanding_pages}</td>
                      <td style={{ padding: '12px 8px', fontWeight: 'bold', color: c.outstanding_amount > 0 ? 'var(--error)' : 'var(--success)' }}>
                        ₹{c.outstanding_amount.toFixed(2)}
                      </td>
                      <td style={{ padding: '12px 8px' }}>
                        <button 
                          className="btn btn-secondary" 
                          style={{ height: 30, padding: '0 12px', fontSize: '0.8rem' }}
                          onClick={() => { setSelectedCustomer(c); setShowAddLog(true); }}
                        >
                          + Log Job
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Add Customer Modal */}
      {showAddCustomer && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--bg-card)', padding: 24, borderRadius: 12, width: 400, border: '1px solid var(--border)' }}>
            <h3 style={{ marginTop: 0 }}>Add Customer</h3>
            <form onSubmit={handleAddCustomer} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input required placeholder="Name" value={newCustomer.name} onChange={e => setNewCustomer({...newCustomer, name: e.target.value})} className="input-field" />
              <input placeholder="Phone" value={newCustomer.phone} onChange={e => setNewCustomer({...newCustomer, phone: e.target.value})} className="input-field" />
              <input placeholder="Company / Institution" value={newCustomer.company} onChange={e => setNewCustomer({...newCustomer, company: e.target.value})} className="input-field" />
              <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddCustomer(false)} style={{ flex: 1 }}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Log Job Modal */}
      {showAddLog && selectedCustomer && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--bg-card)', padding: 24, borderRadius: 12, width: 400, border: '1px solid var(--border)' }}>
            <h3 style={{ marginTop: 0 }}>Log Print Job</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: 16 }}>Logging for: <strong>{selectedCustomer.name}</strong></p>
            <form onSubmit={handleAddLog} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input required placeholder="Job Description (e.g. History Notes)" value={newLog.job_description} onChange={e => setNewLog({...newLog, job_description: e.target.value})} className="input-field" />
              
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Pages</label>
                  <input required type="number" placeholder="0" value={newLog.pages} onChange={e => setNewLog({...newLog, pages: e.target.value})} className="input-field" />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Amount (₹)</label>
                  <input required type="number" step="0.01" placeholder="0.00" value={newLog.amount} onChange={e => setNewLog({...newLog, amount: e.target.value})} className="input-field" />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddLog(false)} style={{ flex: 1 }}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Log to Ledger</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
