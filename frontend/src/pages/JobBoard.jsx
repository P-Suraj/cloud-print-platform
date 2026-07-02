import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import ShopNav from '../components/ShopNav';

const KANBAN_COLUMNS = [
  { id: 'prepress', label: 'Pre-Press' },
  { id: 'printing', label: 'Printing' },
  { id: 'finishing', label: 'Finishing' },
  { id: 'ready', label: 'Ready for Pickup' },
  { id: 'delivered', label: 'Delivered' }
];

export default function JobBoard() {
  const { shopId } = useParams();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Create Job Modal
  const [showAddJob, setShowAddJob] = useState(false);
  const [newJob, setNewJob] = useState({
    customer_id: '',
    title: '',
    description: '',
    service_type: 'printing',
    priority: 'normal',
    amount: 0
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
      const { data: jobsData, error: jobsErr } = await supabase
        .from('jobs')
        .select('*, customers(name, company_name)')
        .eq('shop_id', shopId)
        .order('created_at', { ascending: false });
      if (jobsErr) throw jobsErr;

      const { data: custData, error: custErr } = await supabase
        .from('customers')
        .select('id, name, company_name')
        .eq('shop_id', shopId);
      if (custErr) throw custErr;

      setJobs(jobsData || []);
      setCustomers(custData || []);
    } catch (err) {
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (jobId, newStatus) => {
    try {
      const { error } = await supabase
        .from('jobs')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', jobId);
      if (error) throw error;
      fetchData();
    } catch (err) {
      console.error('Error updating status:', err);
    }
  };

  const handleCreateJob = async (e) => {
    e.preventDefault();
    try {
      const { error } = await supabase
        .from('jobs')
        .insert([{
          ...newJob,
          shop_id: shopId,
          status: 'prepress'
        }]);
      if (error) throw error;
      setShowAddJob(false);
      setNewJob({ customer_id: '', title: '', description: '', service_type: 'printing', priority: 'normal', amount: 0 });
      fetchData();
    } catch (err) {
      console.error('Error creating job:', err);
      alert('Failed to create job');
    }
  };

  if (loading) return <div className="page"><div className="spinner lg" /></div>;

  return (
    <div className="console-layout" style={{ display: 'block', padding: 0 }}>
      <ShopNav />
      
      <div style={{ padding: '0 24px', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 90px)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: '1.4rem', margin: 0 }}>Production Board</h2>
          <button className="btn btn-primary" onClick={() => setShowAddJob(true)}>+ New Job</button>
        </div>

        {/* Kanban Board */}
        <div style={{ display: 'flex', gap: 16, overflowX: 'auto', flex: 1, paddingBottom: 20 }}>
          {KANBAN_COLUMNS.map(col => {
            const columnJobs = jobs.filter(j => j.status === col.id);
            return (
              <div key={col.id} style={{
                flex: '0 0 300px',
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                display: 'flex',
                flexDirection: 'column'
              }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: '800' }}>{col.label}</h3>
                  <span style={{ background: 'var(--bg-raised)', padding: '2px 8px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 'bold' }}>
                    {columnJobs.length}
                  </span>
                </div>
                
                <div style={{ flex: 1, padding: 12, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {columnJobs.map(job => (
                    <div key={job.id} style={{
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      padding: 12,
                      cursor: 'grab'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 'bold' }}>#{job.job_number || job.id.substring(0,4)}</span>
                        {job.priority === 'urgent' && <span style={{ fontSize: '0.65rem', background: 'var(--error-dim)', color: 'var(--error)', padding: '2px 6px', borderRadius: 4, fontWeight: 'bold' }}>URGENT</span>}
                      </div>
                      <div style={{ fontSize: '0.95rem', fontWeight: '700', marginBottom: 4 }}>{job.title}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
                        {job.customers ? (job.customers.company_name || job.customers.name) : 'Walk-in'}
                      </div>
                      
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.75rem', textTransform: 'capitalize', color: 'var(--primary-light)' }}>{job.service_type}</span>
                        
                        <select 
                          value={job.status} 
                          onChange={(e) => handleUpdateStatus(job.id, e.target.value)}
                          style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: 4, background: 'var(--bg-raised)', color: 'var(--text)', border: '1px solid var(--border)' }}
                        >
                          {KANBAN_COLUMNS.map(c => <option key={c.id} value={c.id}>Move to {c.label}</option>)}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showAddJob && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--bg-card)', padding: 24, borderRadius: 12, width: 450, border: '1px solid var(--border)' }}>
            <h3 style={{ marginTop: 0 }}>Create Manual Job</h3>
            <form onSubmit={handleCreateJob} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <select required value={newJob.customer_id} onChange={e => setNewJob({...newJob, customer_id: e.target.value})} className="input-field">
                <option value="">-- Select Customer --</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name} {c.company_name ? `(${c.company_name})` : ''}</option>)}
              </select>
              <input required placeholder="Job Title (e.g. History Notes Binding)" value={newJob.title} onChange={e => setNewJob({...newJob, title: e.target.value})} className="input-field" />
              <input placeholder="Description" value={newJob.description} onChange={e => setNewJob({...newJob, description: e.target.value})} className="input-field" />
              
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Service</label>
                  <select value={newJob.service_type} onChange={e => setNewJob({...newJob, service_type: e.target.value})} className="input-field">
                    <option value="printing">Printing</option>
                    <option value="xerox">Xerox</option>
                    <option value="binding">Binding</option>
                    <option value="lamination">Lamination</option>
                    <option value="id_card">ID Cards</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Priority</label>
                  <select value={newJob.priority} onChange={e => setNewJob({...newJob, priority: e.target.value})} className="input-field">
                    <option value="normal">Normal</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>

              <div style={{ flex: 1, marginTop: 4 }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Estimated Amount (₹)</label>
                <input type="number" placeholder="0" value={newJob.amount} onChange={e => setNewJob({...newJob, amount: e.target.value})} className="input-field" />
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddJob(false)} style={{ flex: 1 }}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Add to Board</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
