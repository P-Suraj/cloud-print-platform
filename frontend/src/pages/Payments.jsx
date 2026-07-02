import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import ShopNav from '../components/ShopNav';

export default function Payments() {
  const { shopId } = useParams();
  const navigate = useNavigate();
  const [payments, setPayments] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showAddModal, setShowAddModal] = useState(false);
  const [newPayment, setNewPayment] = useState({
    customer_id: '',
    amount: '',
    payment_method: 'upi',
    notes: ''
  });

  useEffect(() => {
    if (localStorage.getItem(`autoprint_shop_auth_${shopId}`) !== 'true') {
      navigate(`/shop/${shopId}/console`);
      return;
    }
    fetchData();
  }, [shopId]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const { data: payData, error: payErr } = await supabase
        .from('payments')
        .select('*, customers(name, company_name)')
        .eq('shop_id', shopId)
        .order('payment_date', { ascending: false });
      if (payErr) throw payErr;

      const { data: custData, error: custErr } = await supabase
        .from('customers')
        .select('id, name, company_name')
        .eq('shop_id', shopId);
      if (custErr) throw custErr;

      setPayments(payData || []);
      setCustomers(custData || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddPayment = async (e) => {
    e.preventDefault();
    try {
      const { error } = await supabase
        .from('payments')
        .insert([{
          ...newPayment,
          shop_id: shopId,
          amount: parseFloat(newPayment.amount)
        }]);
      if (error) throw error;
      setShowAddModal(false);
      setNewPayment({ customer_id: '', amount: '', payment_method: 'upi', notes: '' });
      fetchData();
    } catch (err) {
      console.error(err);
      alert('Failed to log payment');
    }
  };

  if (loading) return <div className="page"><div className="spinner lg" /></div>;

  return (
    <div className="console-layout" style={{ display: 'block', padding: 0 }}>
      <ShopNav />
      
      <div style={{ padding: '0 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: '1.4rem', margin: 0 }}>Payments & Accounts Receivable</h2>
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>+ Receive Payment</button>
        </div>

        <div className="console-panel" style={{ background: 'var(--bg-card)', padding: 16 }}>
          {payments.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
              <p>No payments recorded yet.</p>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>Date</th>
                  <th style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>Customer</th>
                  <th style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>Amount</th>
                  <th style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>Method</th>
                  <th style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {payments.map(p => (
                  <tr key={p.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '12px 8px' }}>{new Date(p.payment_date).toLocaleDateString()}</td>
                    <td style={{ padding: '12px 8px', fontWeight: 'bold' }}>{p.customers?.company_name || p.customers?.name || '-'}</td>
                    <td style={{ padding: '12px 8px', color: 'var(--success)', fontWeight: 'bold' }}>₹{p.amount.toFixed(2)}</td>
                    <td style={{ padding: '12px 8px', textTransform: 'uppercase' }}>{p.payment_method.replace('_', ' ')}</td>
                    <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>{p.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showAddModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--bg-card)', padding: 24, borderRadius: 12, width: 450, border: '1px solid var(--border)' }}>
            <h3 style={{ marginTop: 0 }}>Receive Payment</h3>
            <form onSubmit={handleAddPayment} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <select required value={newPayment.customer_id} onChange={e => setNewPayment({...newPayment, customer_id: e.target.value})} className="input-field">
                <option value="">-- Select Customer --</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name} {c.company_name ? `(${c.company_name})` : ''}</option>)}
              </select>
              <input required type="number" step="0.01" placeholder="Amount (₹)" value={newPayment.amount} onChange={e => setNewPayment({...newPayment, amount: e.target.value})} className="input-field" />
              <select value={newPayment.payment_method} onChange={e => setNewPayment({...newPayment, payment_method: e.target.value})} className="input-field">
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="cheque">Cheque</option>
              </select>
              <input placeholder="Notes / Transaction ID" value={newPayment.notes} onChange={e => setNewPayment({...newPayment, notes: e.target.value})} className="input-field" />

              <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(false)} style={{ flex: 1 }}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Record Payment</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
