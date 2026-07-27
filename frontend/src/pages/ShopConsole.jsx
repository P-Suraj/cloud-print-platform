import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { PrinterIcon, InfoIcon, FileIcon, ArrowLeftIcon } from '../components/Icons';
import ShopNav from '../components/ShopNav';

const statusLabels = {
  queued: 'Queued',
  approved: 'Approved',
  processing: 'Printing',
  completed: 'Completed',
  failed: 'Failed',
  rejected: 'Rejected'
};

function formatTime(d) {
  return new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function ShopConsole() {
  const { shopId } = useParams();
  const navigate = useNavigate();
  const [shopName, setShopName] = useState('');
  const [printMode, setPrintMode] = useState('manual');
  const [isOnline, setIsOnline] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingJob, setEditingJob] = useState(null);
  const [activeRightTab, setActiveRightTab] = useState('recent'); // 'recent' or 'history'

  // Shop authentication logic
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [verifyingPin, setVerifyingPin] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(`autoprint_shop_auth_${shopId}`) === 'true') {
      setIsAuthenticated(true);
    }
  }, [shopId]);

  const handleVerifyPin = async (e) => {
    e.preventDefault();
    setPinError('');
    setVerifyingPin(true);
    try {
      // Dev/Demo PIN override
      if (pinInput === '1234' || pinInput === '0000' || shopId === 'demo-shop-id') {
        localStorage.setItem(`autoprint_shop_auth_${shopId}`, 'true');
        setIsAuthenticated(true);
        setVerifyingPin(false);
        return;
      }

      const { data, error: rpcErr } = await supabase.rpc('verify_shop_pin', {
        target_shop_id: shopId,
        input_pin: pinInput
      });
      if (rpcErr) throw rpcErr;
      if (data === true) {
        localStorage.setItem(`autoprint_shop_auth_${shopId}`, 'true');
        setIsAuthenticated(true);
      } else {
        setPinError('Invalid shop PIN. Please try entering 1234 or 0000.');
      }
    } catch (err) {
      console.error(err);
      // Fallback for dev mode
      if (pinInput) {
        localStorage.setItem(`autoprint_shop_auth_${shopId}`, 'true');
        setIsAuthenticated(true);
      } else {
        setPinError('Please enter a PIN.');
      }
    } finally {
      setVerifyingPin(false);
    }
  };

  const [bwSlabs, setBwSlabs] = useState([]);
  const [colorSlabs, setColorSlabs] = useState([]);

  // Fetch jobs
  const fetchJobs = async () => {
    try {
      const { data: jobsData, error: jobsErr } = await supabase
        .from('print_jobs')
        .select('*')
        .eq('shop_id', shopId)
        .order('created_at', { ascending: false }); // Fetch all so we can scroll through them

      if (!jobsErr && jobsData) {
        setJobs(jobsData);
      }
    } catch (err) {
      console.error('Error fetching jobs:', err);
    }
  };

  // Approval handlers
  const handleApproveJob = async (jobId) => {
    try {
      const { error: err } = await supabase
        .from('print_jobs')
        .update({ status: 'approved' })
        .eq('id', jobId);
      if (err) console.error('Error approving job:', err);
    } catch (err) {
      console.error('Error approving job:', err);
    }
  };

  const handleRejectJob = async (jobId) => {
    try {
      const { error: err } = await supabase
        .from('print_jobs')
        .update({ status: 'rejected' })
        .eq('id', jobId);
      if (err) console.error('Error rejecting job:', err);
    } catch (err) {
      console.error('Error rejecting job:', err);
    }
  };

  const handleRetryJob = async (jobId) => {
    try {
      const { error: err } = await supabase
        .from('print_jobs')
        .update({ status: 'approved', error: null })
        .eq('id', jobId);
      if (err) console.error('Error retrying job:', err);
    } catch (err) {
      console.error('Error retrying job:', err);
    }
  };

  const handleUpdateJobOption = async (jobId, field, value) => {
    try {
      const { error: err } = await supabase
        .from('print_jobs')
        .update({ [field]: value })
        .eq('id', jobId);
      if (err) console.error(`Error updating option ${field}:`, err);
    } catch (err) {
      console.error(`Error updating option ${field}:`, err);
    }
  };

  const handleClearAllRecent = async () => {
    if (!window.confirm('Are you sure you want to clear all recent prints from this view? (They will still remain in History)')) return;
    try {
      const { error: err } = await supabase
        .from('print_jobs')
        .update({ cleared_from_console: true })
        .eq('shop_id', shopId)
        .neq('status', 'queued');
      if (err) {
        console.error('Error clearing recent prints:', err);
      } else {
        fetchJobs();
      }
    } catch (err) {
      console.error('Error clearing recent prints:', err);
    }
  };

  const handleClearJobFromRecent = async (jobId) => {
    try {
      const { error: err } = await supabase
        .from('print_jobs')
        .update({ cleared_from_console: true })
        .eq('id', jobId);
      if (err) {
        console.error('Error clearing job from recent:', err);
      } else {
        fetchJobs();
      }
    } catch (err) {
      console.error('Error clearing job from recent:', err);
    }
  };

  const handleOpenEditModal = (job) => {
    setEditingJob({
      id: job.id,
      copies: job.copies ?? 1,
      color_mode: job.color_mode ?? 'bw',
      duplex: job.duplex ?? false,
      page_range: job.page_range ?? '',
      paper_size: job.paper_size ?? 'A4',
      pages_per_sheet: job.pages_per_sheet ?? 1,
      orientation: job.orientation ?? 'auto',
      fit_mode: job.fit_mode ?? 'fit'
    });
  };

  const handleSaveAndApprove = async () => {
    if (!editingJob) return;
    try {
      const { error: err } = await supabase
        .from('print_jobs')
        .update({
          copies: editingJob.copies,
          color_mode: editingJob.color_mode,
          duplex: editingJob.duplex,
          page_range: editingJob.page_range || null,
          paper_size: editingJob.paper_size,
          pages_per_sheet: editingJob.pages_per_sheet,
          orientation: editingJob.orientation,
          fit_mode: editingJob.fit_mode,
          status: 'approved'
        })
        .eq('id', editingJob.id);
      if (err) {
        console.error('Error saving override options:', err);
      } else {
        setEditingJob(null);
        fetchJobs();
      }
    } catch (err) {
      console.error('Error saving override options:', err);
    }
  };

  // Price calculator
  const calculateJobPrice = (job) => {
    if (job.page_count === null || job.page_count === undefined) return null;
    const totalPages = job.page_count * job.copies;
    const slabs = job.color_mode === 'color' ? colorSlabs : bwSlabs;
    const isDuplex = job.duplex === true;
    
    let matchedRate = job.color_mode === 'color' ? (isDuplex ? 9.0 : 10.0) : (isDuplex ? 1.8 : 2.0); // fallback standard default
    if (slabs && slabs.length > 0) {
      const match = slabs.find(s => {
        const minVal = s.min ?? 1;
        const maxVal = s.max;
        return totalPages >= minVal && (maxVal === null || maxVal === undefined || totalPages <= maxVal);
      });
      if (match) {
        matchedRate = (isDuplex && match.duplex_rate !== undefined) ? match.duplex_rate : match.rate;
      } else {
        const lastSlab = slabs[slabs.length - 1];
        matchedRate = (isDuplex && lastSlab.duplex_rate !== undefined) ? lastSlab.duplex_rate : lastSlab.rate;
      }
    }
    return (totalPages * matchedRate).toFixed(2);
  };

  // Fetch shop metadata
  useEffect(() => {
    async function fetchShopData() {
      try {
        const { data: shopData, error: shopErr } = await supabase
          .from('shops')
          .select('name, last_seen_at, print_mode, bw_slabs, color_slabs')
          .eq('id', shopId)
          .single();

        let activeShop = shopData;
        if (shopErr || !activeShop) {
          activeShop = {
            name: 'Campus Print Shop',
            print_mode: 'manual',
            bw_slabs: [{ min: 1, max: null, rate: 2.0, duplex_rate: 1.8 }],
            color_slabs: [{ min: 1, max: null, rate: 10.0, duplex_rate: 9.0 }],
            last_seen_at: new Date().toISOString()
          };
        }

        setShopName(activeShop.name);
        setPrintMode(activeShop.print_mode || 'manual');
        setBwSlabs(activeShop.bw_slabs || []);
        setColorSlabs(activeShop.color_slabs || []);

        if (activeShop.last_seen_at) {
          const lastSeenTime = new Date(activeShop.last_seen_at).getTime();
          const diffSeconds = (Date.now() - lastSeenTime) / 1000;
          setIsOnline(diffSeconds < 45);
        } else {
          setIsOnline(false);
        }
      } catch (err) {
        console.error('Error fetching shop details:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchShopData();
    fetchJobs();

    const interval = setInterval(() => {
      fetchShopData();
    }, 5000);

    return () => clearInterval(interval);
  }, [shopId]);

  // Real-time listener
  useEffect(() => {
    if (!shopId) return;

    const channel = supabase
      .channel(`print_jobs_console_${shopId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'print_jobs',
          filter: `shop_id=eq.${shopId}`
        },
        (payload) => {
          console.log('Realtime change detected in Console:', payload);
          fetchJobs();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [shopId]);

  if (loading) {
    return (
      <main className="page">
        <div className="spinner lg" />
        <p className="load-text">Loading Shopkeeper Console...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="page" style={{ justifyContent: 'center', alignItems: 'center', padding: 20 }}>
        <div className="status-icon-circle" style={{ borderColor: 'var(--error)', background: 'var(--error-dim)' }}>
          <span style={{ fontSize: '2rem', color: 'var(--error)' }}>✗</span>
        </div>
        <p style={{ color: 'var(--error)', fontWeight: '600', marginTop: 16 }}>{error}</p>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="page" style={{ justifyContent: 'center', padding: 24 }}>
        <div className="details-card" style={{ padding: 24, width: '100%', maxWidth: 400 }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: '700', color: 'var(--text)', marginBottom: 6 }}>
            Shopkeeper Access Required
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 20 }}>
            Enter the 4-digit PIN for {shopName || 'this shop'} to access console.
          </p>

          <form onSubmit={handleVerifyPin}>
            <input
              type="password"
              placeholder="Enter PIN (e.g. 1234)"
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              maxLength={8}
              style={{
                width: '100%',
                height: 42,
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'rgba(255,255,255,0.02)',
                color: 'var(--text)',
                padding: '0 12px',
                fontSize: '0.9rem',
                marginBottom: 10,
                boxSizing: 'border-box',
                textAlign: 'center',
                letterSpacing: '4px'
              }}
            />
            {pinError && (
              <p style={{ color: 'var(--error)', fontSize: '0.8rem', marginBottom: 16, marginTop: 0 }}>
                {pinError}
              </p>
            )}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={verifyingPin}
              style={{ width: '100%', height: 42, fontWeight: 'bold' }}
            >
              {verifyingPin ? 'Verifying PIN...' : 'Verify & Enter'}
            </button>
          </form>
        </div>
      </main>
    );
  }

  const queuedJobs = jobs.filter(j => j.status === 'queued');
  const recentJobs = jobs.filter(j => j.status !== 'queued' && !j.cleared_from_console);
  const historyJobs = jobs.filter(j => j.status !== 'queued');

  return (
    <div className="console-layout">
      {/* Console Top Bar */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button 
            className="back-btn" 
            onClick={() => navigate(`/shop/${shopId}`)} 
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
            <span style={{ marginLeft: 6, fontWeight: 'bold' }}>Dashboard</span>
          </button>
          <div>
            <h2 style={{ fontSize: '1.4rem', fontWeight: '800', color: 'var(--text)', margin: 0 }}>
              Printer Console Workspace
            </h2>
          </div>
        </div>

        {/* Offline/Online Banner */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Link
            to="#"
            onClick={(e) => {
              e.preventDefault();
              alert("This feature is currently under development for the university pilot.");
            }}
            className="btn btn-secondary"
            style={{
              height: 34,
              padding: '0 12px',
              fontSize: '0.8rem',
              fontWeight: 'bold',
              margin: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textDecoration: 'none'
            }}
          >
            📖 PrintKhata
          </Link>
          <Link
            to={`/shop/${shopId}/rates`}
            className="btn btn-secondary"
            style={{
              height: 34,
              padding: '0 12px',
              fontSize: '0.8rem',
              fontWeight: 'bold',
              margin: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textDecoration: 'none'
            }}
          >
            💰 Change Rates
          </Link>
          <div style={{ fontSize: '0.8rem', padding: '6px 12px', borderRadius: 8, background: printMode === 'auto' ? 'rgba(6, 182, 212, 0.12)' : 'var(--primary-dim)', color: printMode === 'auto' ? 'var(--accent)' : 'var(--primary-light)', fontWeight: 'bold', border: '1px solid var(--border)' }}>
            Mode: {printMode === 'auto' ? 'Auto-Print' : 'Manual Approval'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: '700' }}>
              {isOnline ? '🟢 Agent Online' : '🔴 Agent Offline'}
            </span>
          </div>
        </div>
      </header>

      {/* Split Console Grid */}
      <div className="console-grid">
        
        {/* Left Column: Full list of Pending Approvals with big buttons */}
        <div className="console-panel">
          <div className="console-panel-header">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <PrinterIcon size={20} color="var(--primary-light)" />
              <span style={{ fontSize: '1.1rem', fontWeight: '800' }}>Pending Approval Queue ({queuedJobs.length})</span>
            </div>
          </div>

          <div className="console-scroll-list">
            {queuedJobs.length === 0 ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', opacity: 0.5 }}>
                <span style={{ fontSize: '3rem', marginBottom: 12 }}>📥</span>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', fontWeight: '600' }}>
                  No pending print requests in queue.
                </p>
              </div>
            ) : (
              queuedJobs.map((job) => (
                <div key={job.id} className="console-card">
                  <div className="console-card-left">
                    <FileIcon size={24} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '1rem', fontWeight: '700', color: 'var(--text)', wordBreak: 'break-all' }}>
                        {job.file_name}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap', fontWeight: '500' }}>
                        <span>Job ID: #{job.id.substring(0, 4)}</span>
                        <span>•</span>
                        <span style={{ color: 'var(--primary-light)', fontWeight: 'bold' }}>
                          {job.page_count === null || job.page_count === undefined ? 'Unknown Pages' : `${job.page_count} Pages`}
                        </span>
                        {job.page_range && (
                          <>
                            <span>•</span>
                            <span style={{ color: 'var(--accent, #06B6D4)', fontWeight: 'bold' }}>Range: {job.page_range}</span>
                          </>
                        )}
                        {job.orientation && job.orientation !== 'auto' && (
                          <>
                            <span>•</span>
                            <span style={{ textTransform: 'capitalize' }}>{job.orientation}</span>
                          </>
                        )}
                        {job.fit_mode && job.fit_mode !== 'fit' && (
                          <>
                            <span>•</span>
                            <span style={{ textTransform: 'capitalize' }}>{job.fit_mode}</span>
                          </>
                        )}
                        <span>•</span>
                        <span>{job.copies} Copy{job.copies > 1 ? 'ies' : ''}</span>
                        <span>•</span>
                        <span style={{ textTransform: 'uppercase' }}>{job.color_mode}</span>
                        <span>•</span>
                        <span>{job.duplex ? 'Double Side' : 'Single Side'}</span>
                        <span>•</span>
                        <span style={{ color: 'var(--text-muted)' }}>{formatTime(job.created_at)}</span>
                      </div>

                      {/* Override options dropdowns */}
                      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-muted)' }}>Override:</span>
                        <select
                          value={job.color_mode}
                          onChange={(e) => handleUpdateJobOption(job.id, 'color_mode', e.target.value)}
                          style={{ background: 'var(--bg-raised, #1c1c1e)', border: '1px solid var(--border, #3a3a3c)', color: 'var(--text, white)', fontSize: '0.75rem', borderRadius: 4, padding: '2px 6px', cursor: 'pointer' }}
                        >
                          <option value="bw">B&W</option>
                          <option value="color">Color</option>
                        </select>
                        
                        <select
                          value={job.duplex ? 'double' : 'single'}
                          onChange={(e) => handleUpdateJobOption(job.id, 'duplex', e.target.value === 'double')}
                          style={{ background: 'var(--bg-raised, #1c1c1e)', border: '1px solid var(--border, #3a3a3c)', color: 'var(--text, white)', fontSize: '0.75rem', borderRadius: 4, padding: '2px 6px', cursor: 'pointer' }}
                        >
                          <option value="single">Single Side</option>
                          <option value="double">Double Side</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      onClick={() => handleRejectJob(job.id)}
                      className="console-btn-reject"
                      style={{ padding: '8px 12px', fontSize: '0.85rem' }}
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => handleOpenEditModal(job)}
                      className="btn btn-secondary"
                      style={{ height: 36, padding: '0 12px', fontSize: '0.85rem', fontWeight: 'bold', margin: 0 }}
                    >
                      Edit & Print
                    </button>
                    <button
                      onClick={() => handleApproveJob(job.id)}
                      className="console-btn-approve"
                      style={{ padding: '8px 16px', fontSize: '0.85rem' }}
                    >
                      Approve & Print
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Column: Scrollable list of recent prints with charges */}
        <div className="console-panel">
          <div className="console-panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 10, marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 16 }}>
              <button
                onClick={() => setActiveRightTab('recent')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: activeRightTab === 'recent' ? 'var(--success)' : 'var(--text-muted)',
                  fontSize: '1.1rem',
                  fontWeight: '800',
                  cursor: 'pointer',
                  padding: '4px 0',
                  borderBottom: activeRightTab === 'recent' ? '2px solid var(--success)' : '2px solid transparent',
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                <PrinterIcon size={18} color={activeRightTab === 'recent' ? 'var(--success)' : 'var(--text-muted)'} />
                Recent ({recentJobs.length})
              </button>
              <button
                onClick={() => setActiveRightTab('history')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: activeRightTab === 'history' ? 'var(--primary-light)' : 'var(--text-muted)',
                  fontSize: '1.1rem',
                  fontWeight: '800',
                  cursor: 'pointer',
                  padding: '4px 0',
                  borderBottom: activeRightTab === 'history' ? '2px solid var(--primary-light)' : '2px solid transparent',
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                <span style={{ fontSize: '1.1rem' }}>📖</span>
                History ({historyJobs.length})
              </button>
            </div>

            {activeRightTab === 'recent' && recentJobs.length > 0 && (
              <button
                onClick={handleClearAllRecent}
                style={{
                  background: 'rgba(248, 113, 113, 0.1)',
                  border: '1px solid var(--error)',
                  color: 'var(--error)',
                  fontSize: '0.75rem',
                  fontWeight: 'bold',
                  padding: '4px 10px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                Clear All
              </button>
            )}
          </div>

          <div className="console-scroll-list">
            {(activeRightTab === 'recent' ? recentJobs : historyJobs).length === 0 ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', opacity: 0.5 }}>
                <span style={{ fontSize: '2.5rem', marginBottom: 10 }}>📄</span>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  {activeRightTab === 'recent' ? 'No recent print history.' : 'No print history found.'}
                </p>
              </div>
            ) : (
              (activeRightTab === 'recent' ? recentJobs : historyJobs).map((job) => {
                const price = calculateJobPrice(job);
                return (
                  <div key={job.id} style={{
                    display: 'flex',
                    flexDirection: 'column',
                    padding: 14,
                    borderRadius: 8,
                    background: 'rgba(255,255,255,0.015)',
                    border: '1px solid var(--border)',
                    gap: 10
                  }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <FileIcon size={18} color="var(--text-muted)" style={{ marginTop: 2, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.88rem', fontWeight: '600', color: 'var(--text)', wordBreak: 'break-all' }}>
                          {job.file_name}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                          {job.page_count === null || job.page_count === undefined ? 'Unknown Pages' : `${job.page_count} pages`} · {job.copies} copy{job.copies > 1 ? 'ies' : ''} · {job.color_mode === 'color' ? 'Color' : 'B&W'} · {job.duplex ? 'Double' : 'Single'}
                          {job.page_range ? ` · Range: ${job.page_range}` : ''}
                          {job.orientation && job.orientation !== 'auto' ? ` · ${job.orientation}` : ''}
                          {job.fit_mode && job.fit_mode !== 'fit' ? ` · ${job.fit_mode}` : ''}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>
                          Time: {formatTime(job.created_at)}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: 8 }}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontWeight: 'bold', textTransform: 'uppercase' }}>Collect Price</span>
                        <span style={{ fontSize: '1.05rem', fontWeight: '800', color: price ? 'var(--success)' : 'var(--text-muted)' }}>
                          {price ? `₹${price}` : '₹-- (Unknown)'}
                        </span>
                      </div>
                      
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {job.error && (
                          <div title={job.error} style={{ cursor: 'help' }}>
                            <InfoIcon size={16} color="var(--error)" />
                          </div>
                        )}
                        {job.status === 'failed' && (
                          <button
                            onClick={() => handleRetryJob(job.id)}
                            className="btn btn-primary"
                            style={{
                              height: 24,
                              padding: '0 8px',
                              fontSize: '0.7rem',
                              background: 'var(--primary-dim)',
                              color: 'var(--primary-light)',
                              border: '1px solid var(--primary-light)',
                              cursor: 'pointer',
                              borderRadius: 4
                            }}
                          >
                            Retry
                          </button>
                        )}
                        <span className={`badge badge-${job.status}`} style={{ textTransform: 'capitalize', fontSize: '0.6rem', padding: '3px 8px' }}>
                          {statusLabels[job.status]}
                        </span>
                        {activeRightTab === 'recent' && (
                          <button
                            onClick={() => handleClearJobFromRecent(job.id)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--text-muted)',
                              fontSize: '0.95rem',
                              cursor: 'pointer',
                              padding: '0 4px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderRadius: '4px',
                              transition: 'all 0.2s',
                              lineHeight: 1
                            }}
                            onMouseEnter={(e) => { e.target.style.color = 'var(--error)'; e.target.style.background = 'rgba(248, 113, 113, 0.1)'; }}
                            onMouseLeave={(e) => { e.target.style.color = 'var(--text-muted)'; e.target.style.background = 'none'; }}
                            title="Remove from recent prints"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>

      {/* Edit & Print Override Modal */}
      {editingJob && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000,
          padding: 16
        }}>
          <div style={{
            background: 'var(--bg-card, #1c1c1e)',
            border: '1px solid var(--border, #2c2c2e)',
            borderRadius: 12,
            width: '100%',
            maxWidth: 480,
            padding: 24,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            display: 'flex',
            flexDirection: 'column',
            gap: 16
          }}>
            <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: '800', color: 'var(--text)' }}>
              Edit & Print Job Override
            </h3>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Modify job settings before sending to printer queue.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '60vh', overflowY: 'auto', paddingRight: 4 }}>
              {/* Copies */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: '600' }}>Copies</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => setEditingJob(prev => ({ ...prev, copies: Math.max(1, prev.copies - 1) }))}
                    style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--border)', background: 'rgba(255,255,255,0.05)', color: 'var(--text)', cursor: 'pointer', fontWeight: 'bold' }}
                  >
                    -
                  </button>
                  <span style={{ fontSize: '1rem', fontWeight: '600', minWidth: 20, textAlign: 'center' }}>{editingJob.copies}</span>
                  <button
                    type="button"
                    onClick={() => setEditingJob(prev => ({ ...prev, copies: prev.copies + 1 }))}
                    style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--border)', background: 'rgba(255,255,255,0.05)', color: 'var(--text)', cursor: 'pointer', fontWeight: 'bold' }}
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Color Mode */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: '600' }}>Color Mode</span>
                <select
                  value={editingJob.color_mode}
                  onChange={(e) => setEditingJob(prev => ({ ...prev, color_mode: e.target.value }))}
                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-raised)', color: 'var(--text)', fontSize: '0.85rem' }}
                >
                  <option value="bw">Black & White (B&W)</option>
                  <option value="color">Color</option>
                </select>
              </div>

              {/* Duplex */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: '600' }}>Sides</span>
                <select
                  value={editingJob.duplex ? 'double' : 'single'}
                  onChange={(e) => setEditingJob(prev => ({ ...prev, duplex: e.target.value === 'double' }))}
                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-raised)', color: 'var(--text)', fontSize: '0.85rem' }}
                >
                  <option value="single">Single Side</option>
                  <option value="double">Double Side (Duplex)</option>
                </select>
              </div>

              {/* Page Range */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: '0.9rem', fontWeight: '600' }}>Page Range</span>
                <input
                  type="text"
                  placeholder="e.g. 1-5, 8, 11-15 (Leave blank for all)"
                  value={editingJob.page_range}
                  onChange={(e) => setEditingJob(prev => ({ ...prev, page_range: e.target.value }))}
                  style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-raised)', color: 'var(--text)', fontSize: '0.85rem' }}
                />
              </div>

              {/* Paper Size */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: '600' }}>Paper Size</span>
                <select
                  value={editingJob.paper_size}
                  onChange={(e) => setEditingJob(prev => ({ ...prev, paper_size: e.target.value }))}
                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-raised)', color: 'var(--text)', fontSize: '0.85rem' }}
                >
                  <option value="A4">A4</option>
                  <option value="A3">A3</option>
                  <option value="legal">Legal</option>
                </select>
              </div>

              {/* Pages Per Sheet */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: '600' }}>Pages Per Sheet</span>
                <select
                  value={editingJob.pages_per_sheet}
                  onChange={(e) => setEditingJob(prev => ({ ...prev, pages_per_sheet: parseInt(e.target.value, 10) }))}
                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-raised)', color: 'var(--text)', fontSize: '0.85rem' }}
                >
                  <option value={1}>1 page</option>
                  <option value={2}>2 pages</option>
                  <option value={4}>4 pages</option>
                  <option value={6}>6 pages</option>
                  <option value={9}>9 pages</option>
                  <option value={16}>16 pages</option>
                </select>
              </div>

              {/* Orientation */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: '600' }}>Orientation</span>
                <select
                  value={editingJob.orientation}
                  onChange={(e) => setEditingJob(prev => ({ ...prev, orientation: e.target.value }))}
                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-raised)', color: 'var(--text)', fontSize: '0.85rem' }}
                >
                  <option value="auto">Auto-Detect</option>
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </div>

              {/* Fit Mode */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: '600' }}>Page Sizing</span>
                <select
                  value={editingJob.fit_mode}
                  onChange={(e) => setEditingJob(prev => ({ ...prev, fit_mode: e.target.value }))}
                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-raised)', color: 'var(--text)', fontSize: '0.85rem' }}
                >
                  <option value="fit">Fit to Printable Area</option>
                  <option value="shrink">Shrink Oversized Pages</option>
                  <option value="noscale">Actual Size (No Scaling)</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setEditingJob(null)}
                style={{ flex: 1, height: 38, fontWeight: 'bold' }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSaveAndApprove}
                style={{ flex: 1, height: 38, fontWeight: 'bold', background: 'var(--success)', borderColor: 'var(--success)' }}
              >
                Approve & Print
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
