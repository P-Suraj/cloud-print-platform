import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import ShopNav from '../components/ShopNav';

export default function Customers() {
  const { shopId } = useParams();
  const navigate = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newCustomer, setNewCustomer] = useState({
    customer_type: 'corporate',
    name: '',
    phone: '',
    email: '',
    company_name: '',
    gstin: '',
    address: '',
    credit_limit: 0,
    payment_terms: 'Net 30',
    notes: ''
  });

  useEffect(() => {
    if (localStorage.getItem(`autoprint_shop_auth_${shopId}`) !== 'true') {
      navigate(`/shop/${shopId}/console`);
      return;
    }
    fetchCustomers();
  }, [shopId]);

  const fetchCustomers = async () => {
    try {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('shop_id', shopId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setCustomers(data || []);
    } catch (err) {
      console.error('Error fetching customers:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddCustomer = async (e) => {
    e.preventDefault();
    try {
      const { error } = await supabase
        .from('customers')
        .insert([{ ...newCustomer, shop_id: shopId }]);
      if (error) throw error;
      setShowAddModal(false);
      setNewCustomer({
        customer_type: 'corporate', name: '', phone: '', email: '', company_name: '',
        gstin: '', address: '', credit_limit: 0, payment_terms: 'Net 30', notes: ''
      });
      fetchCustomers();
    } catch (err) {
      console.error('Error adding customer:', err);
      alert('Failed to add customer');
    }
  };

  if (loading) return <div className="page"><div className="spinner lg" /></div>;

  return (
    <div className="console-layout" style={{ display: 'block', padding: 0 }}>
      <ShopNav />
      
      <div style={{ padding: '0 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: '1.4rem', margin: 0 }}>Customers Directory</h2>
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>+ New Customer</button>
        </div>

        <div className="console-panel" style={{ background: 'var(--bg-card)', padding: 16 }}>
          {customers.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
              <p>No customers found. Add your first corporate client or walk-in customer.</p>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>Name</th>
                  <th style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>Company</th>
                  <th style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>Type</th>
                  <th style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>Contact</th>
                  <th style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>Credit Limit</th>
                </tr>
              </thead>
              <tbody>
                {customers.map(c => (
                  <tr key={c.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '12px 8px', fontWeight: 'bold' }}>{c.name}</td>
                    <td style={{ padding: '12px 8px' }}>{c.company_name || c.company || '-'}</td>
                    <td style={{ padding: '12px 8px', textTransform: 'capitalize' }}>{c.customer_type}</td>
                    <td style={{ padding: '12px 8px' }}>{c.phone || c.email || '-'}</td>
                    <td style={{ padding: '12px 8px', color: 'var(--success)' }}>₹{c.credit_limit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showAddModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--bg-card)', padding: 24, borderRadius: 12, width: 450, maxHeight: '90vh', overflowY: 'auto', border: '1px solid var(--border)' }}>
            <h3 style={{ marginTop: 0 }}>Add New Customer</h3>
            <form onSubmit={handleAddCustomer} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <select value={newCustomer.customer_type} onChange={e => setNewCustomer({...newCustomer, customer_type: e.target.value})} className="input-field">
                <option value="corporate">Corporate</option>
                <option value="student">Student</option>
                <option value="institution">Institution</option>
                <option value="walk_in">Walk-in</option>
                <option value="government">Government</option>
              </select>
              <input required placeholder="Contact Name" value={newCustomer.name} onChange={e => setNewCustomer({...newCustomer, name: e.target.value})} className="input-field" />
              <input placeholder="Company / Institution Name" value={newCustomer.company_name} onChange={e => setNewCustomer({...newCustomer, company_name: e.target.value})} className="input-field" />
              <input placeholder="Phone Number" value={newCustomer.phone} onChange={e => setNewCustomer({...newCustomer, phone: e.target.value})} className="input-field" />
              <input placeholder="Email Address" type="email" value={newCustomer.email} onChange={e => setNewCustomer({...newCustomer, email: e.target.value})} className="input-field" />
              <input placeholder="GSTIN (Optional)" value={newCustomer.gstin} onChange={e => setNewCustomer({...newCustomer, gstin: e.target.value})} className="input-field" />
              
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Credit Limit (₹)</label>
                  <input type="number" placeholder="0" value={newCustomer.credit_limit} onChange={e => setNewCustomer({...newCustomer, credit_limit: e.target.value})} className="input-field" />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Payment Terms</label>
                  <input placeholder="e.g. Net 30" value={newCustomer.payment_terms} onChange={e => setNewCustomer({...newCustomer, payment_terms: e.target.value})} className="input-field" />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(false)} style={{ flex: 1 }}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Save Customer</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
