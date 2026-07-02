import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import ShopNav from '../components/ShopNav';

export default function DashboardOverview() {
  const { shopId } = useParams();
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState({
    todaysRevenue: 0,
    pendingJobs: 0,
    readyJobs: 0,
    outstandingBalance: 0
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (localStorage.getItem(`autoprint_shop_auth_${shopId}`) !== 'true') {
      navigate(`/shop/${shopId}/console`);
      return;
    }
    fetchMetrics();
  }, [shopId]);

  const fetchMetrics = async () => {
    try {
      setLoading(true);
      
      const today = new Date();
      today.setHours(0,0,0,0);

      // Fetch Jobs (for pending and ready)
      const { data: jobs } = await supabase
        .from('jobs')
        .select('*')
        .eq('shop_id', shopId);
        
      // Fetch Payments (for today's revenue)
      const { data: payments } = await supabase
        .from('payments')
        .select('amount, payment_date')
        .eq('shop_id', shopId)
        .gte('payment_date', today.toISOString());

      // Fetch Customers (for outstanding balances)
      const { data: customers } = await supabase
        .from('customers')
        .select('id')
        .eq('shop_id', shopId);

      let pendingCount = 0;
      let readyCount = 0;
      let outstanding = 0; // In a full system, you sum all unbilled jobs and subtract payments. We'll approximate for demo by looking at jobs without payments or ledger entries.
      
      if (jobs) {
        pendingCount = jobs.filter(j => ['prepress', 'printing', 'finishing'].includes(j.status)).length;
        readyCount = jobs.filter(j => j.status === 'ready').length;
        
        // Approximate outstanding: total job amounts that aren't delivered/paid
        outstanding = jobs
          .filter(j => j.status !== 'delivered' && j.status !== 'cancelled')
          .reduce((sum, j) => sum + Number(j.amount || 0), 0);
      }

      let revenueToday = 0;
      if (payments) {
        revenueToday = payments.reduce((sum, p) => sum + Number(p.amount), 0);
      }

      setMetrics({
        todaysRevenue: revenueToday,
        pendingJobs: pendingCount,
        readyJobs: readyCount,
        outstandingBalance: outstanding
      });

    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="page"><div className="spinner lg" /></div>;

  return (
    <div className="console-layout" style={{ display: 'block', padding: 0 }}>
      <ShopNav />
      
      <div style={{ padding: '0 24px' }}>
        <h2 style={{ fontSize: '1.6rem', margin: '0 0 24px 0' }}>Dashboard Overview</h2>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20 }}>
          {/* Metric 1 */}
          <div style={{ background: 'var(--bg-card)', padding: 24, borderRadius: 12, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', fontWeight: 'bold', textTransform: 'uppercase' }}>Today's Revenue</div>
            <div style={{ fontSize: '2rem', fontWeight: '800', color: 'var(--success)', marginTop: 8 }}>₹{metrics.todaysRevenue.toFixed(2)}</div>
          </div>
          
          {/* Metric 2 */}
          <div style={{ background: 'var(--bg-card)', padding: 24, borderRadius: 12, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', fontWeight: 'bold', textTransform: 'uppercase' }}>Pending Production</div>
            <div style={{ fontSize: '2rem', fontWeight: '800', color: 'var(--primary-light)', marginTop: 8 }}>{metrics.pendingJobs} <span style={{fontSize: '1rem', color: 'var(--text-muted)'}}>Jobs</span></div>
          </div>

          {/* Metric 3 */}
          <div style={{ background: 'var(--bg-card)', padding: 24, borderRadius: 12, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', fontWeight: 'bold', textTransform: 'uppercase' }}>Ready For Pickup</div>
            <div style={{ fontSize: '2rem', fontWeight: '800', color: 'var(--accent)', marginTop: 8 }}>{metrics.readyJobs} <span style={{fontSize: '1rem', color: 'var(--text-muted)'}}>Jobs</span></div>
          </div>

          {/* Metric 4 */}
          <div style={{ background: 'var(--bg-card)', padding: 24, borderRadius: 12, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', fontWeight: 'bold', textTransform: 'uppercase' }}>Outstanding Dues</div>
            <div style={{ fontSize: '2rem', fontWeight: '800', color: 'var(--error)', marginTop: 8 }}>₹{metrics.outstandingBalance.toFixed(2)}</div>
          </div>
        </div>

      </div>
    </div>
  );
}
