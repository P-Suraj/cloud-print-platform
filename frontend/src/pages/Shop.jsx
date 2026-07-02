import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { PrinterIcon, InfoIcon, FileIcon } from '../components/Icons';
import { generate } from '../services/lean-qr';

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

const agentDownloadUrl = import.meta.env.VITE_AGENT_DOWNLOAD_URL;

export default function Shop() {
  const { shopId } = useParams();
  const [shopName, setShopName] = useState('');
  const [shopCode, setShopCode] = useState('');
  const [printMode, setPrintMode] = useState('manual');
  const [isOnline, setIsOnline] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

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
      const { data, error: rpcErr } = await supabase.rpc('verify_shop_pin', {
        target_shop_id: shopId,
        input_pin: pinInput
      });
      if (rpcErr) throw rpcErr;
      if (data === true) {
        localStorage.setItem(`autoprint_shop_auth_${shopId}`, 'true');
        setIsAuthenticated(true);
      } else {
        setPinError('Invalid shop PIN. Please try again.');
      }
    } catch (err) {
      console.error(err);
      setPinError('Failed to verify PIN. Database connection error.');
    } finally {
      setVerifyingPin(false);
    }
  };

  const [bwSlabs, setBwSlabs] = useState([]);
  const [colorSlabs, setColorSlabs] = useState([]);
  const canvasRef = useRef(null);

  const currentDomain = window.location.origin;
  const qrUrl = shopCode ? `${currentDomain}/?shop=${shopCode}` : '';

  // Copy code handler
  const handleCopyCode = () => {
    if (!shopCode) return;
    navigator.clipboard.writeText(shopCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Download high-res QR handler
  const handleDownloadQR = () => {
    if (!qrUrl) return;
    try {
      const code = generate(qrUrl);
      const dataUrl = code.toDataURL({
        scale: 15, // High resolution (approx 500-600px square)
        on: [0, 0, 0],
        off: [255, 255, 255],
        pad: 4
      });
      
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `${shopCode}_Counter_QR.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Error generating download QR:', err);
    }
  };

  // Render QR Code canvas
  useEffect(() => {
    if (canvasRef.current && qrUrl) {
      try {
        const code = generate(qrUrl);
        code.toCanvas(canvasRef.current, {
          on: [0, 0, 0], // Black color
          off: [255, 255, 255], // White background
          pad: 2
        });
      } catch (err) {
        console.error('Error rendering QR Code:', err);
      }
    }
  }, [qrUrl]);

  // Helper to fetch print jobs list
  const fetchJobs = async () => {
    try {
      const { data: jobsData, error: jobsErr } = await supabase
        .from('print_jobs')
        .select('*')
        .eq('shop_id', shopId)
        .order('created_at', { ascending: false })
        .limit(30);

      if (!jobsErr && jobsData) {
        setJobs(jobsData);
      }
    } catch (err) {
      console.error('Error fetching jobs:', err);
    }
  };

  // Toggle print mode handler
  const handleTogglePrintMode = async (newMode) => {
    try {
      const { error: err } = await supabase.rpc('update_shop_print_mode', {
        target_shop_id: shopId,
        new_mode: newMode
      });
      if (err) {
        console.error('Error toggling print mode:', err);
      } else {
        setPrintMode(newMode);
        // Log print_mode_changed telemetry event
        supabase
          .from('events')
          .insert({
            shop_id: shopId,
            event_type: 'print_mode_changed',
            metadata: {
              new_mode: newMode
            }
          })
          .then(({ error: telemetryErr }) => {
            if (telemetryErr) {
              console.error('Failed to log print_mode_changed telemetry:', telemetryErr);
            }
          });
      }
    } catch (err) {
      console.error('Error calling update_shop_print_mode RPC:', err);
    }
  };

  // Job status actions
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

  const handleCreateSampleJob = async () => {
    try {
      const sampleJobId = crypto.randomUUID();
      const { error: err } = await supabase
        .from('print_jobs')
        .insert({
          id: sampleJobId,
          shop_id: shopId,
          file_path: 'jobs/sample.pdf',
          file_name: 'sample_document.pdf',
          copies: 1,
          page_count: 5,
          status: 'queued',
          color_mode: 'bw',
          duplex: false
        });
      if (err) {
        console.error('Error creating sample job:', err);
      }
    } catch (err) {
      console.error('Error creating sample job:', err);
    }
  };

  // Fetch shop metadata and heartbeat
  useEffect(() => {
    async function fetchShopData() {
      try {
        const { data: shopData, error: shopErr } = await supabase
          .from('shops')
          .select('name, last_seen_at, shop_code, print_mode, bw_slabs, color_slabs')
          .eq('id', shopId)
          .single();

        if (shopErr || !shopData) {
          setError('Shop not found or inactive.');
          setLoading(false);
          return;
        }

        setShopName(shopData.name);
        setShopCode(shopData.shop_code || '');
        setPrintMode(shopData.print_mode || 'manual');
        setBwSlabs(shopData.bw_slabs || []);
        setColorSlabs(shopData.color_slabs || []);
        
        // Calculate online state
        if (shopData.last_seen_at) {
          const lastSeen = new Date(shopData.last_seen_at).getTime();
          const timeDiff = Date.now() - lastSeen;
          setIsOnline(timeDiff < 90000);
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

    // Heartbeat check interval
    const interval = setInterval(() => {
      fetchShopData();
    }, 5000);

    return () => clearInterval(interval);
  }, [shopId]);

  // Set up real-time subscription for print_jobs changes
  useEffect(() => {
    if (!shopId) return;

    const channel = supabase
      .channel(`print_jobs_shop_${shopId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'print_jobs',
          filter: `shop_id=eq.${shopId}`
        },
        (payload) => {
          console.log('Realtime print_jobs change detected:', payload);
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
        <p className="load-text">Loading shop dashboard...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="page" style={{ justifyContent: 'center', alignItems: 'center', padding: 20 }}>
        <div className="status-icon-circle" style={{ borderColor: 'var(--error)', background: 'var(--error-dim)' }}>
          <span style={{ fontSize: '2rem', color: 'var(--error)' }}>✗</span>
        </div>
        <p style={{ color: 'var(--error)', fontWeight: '600', marginTop: 16 }}>
          {error}
        </p>
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
            Enter the 4-digit PIN for {shopName || 'this shop'} to access administration.
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

  const recentJobs = jobs.filter(j => j.status !== 'queued').slice(0, 10);

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

  return (
    <main className="page" style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Dashboard Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: '700', color: 'var(--text)', margin: 0 }}>
            {shopName} Queue
          </h2>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
            Live monitoring dashboard. Refreshes automatically.
          </p>
        </div>

        {/* Navigation & Heartbeat Group */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Link
            to="#"
            onClick={(e) => {
              e.preventDefault();
              alert("This feature is currently under development for the university pilot.");
            }}
            className="btn btn-primary"
            style={{
              height: 34,
              padding: '0 14px',
              fontSize: '0.82rem',
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textDecoration: 'none',
              margin: 0
            }}
          >
            📊 SHMS (Shop Management System)
          </Link>
          <Link
            to={`/shop/${shopId}/rates`}
            className="btn btn-secondary"
            style={{
              height: 34,
              padding: '0 14px',
              fontSize: '0.82rem',
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textDecoration: 'none',
              margin: 0
            }}
          >
            💰 Change Rates
          </Link>
          <Link
            to={`/shop/${shopId}/console`}
            className="btn btn-secondary"
            style={{
              height: 34,
              padding: '0 14px',
              fontSize: '0.82rem',
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textDecoration: 'none',
              margin: 0
            }}
          >
            🖥️ Open Console
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 16, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: '600', color: isOnline ? 'var(--text)' : 'var(--text-muted)' }}>
              {isOnline ? '🟢 Agent Online' : '🔴 Agent Offline'}
            </span>
          </div>
        </div>
      </header>

      {/* Main Grid/Flex Wrapper for 2-column layout */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 24,
        alignItems: 'start'
      }}>
        {/* Left Column - Control panel & pending approvals */}
        <div style={{ flex: '1 1 600px', minWidth: 0 }}>
          {/* Stats Quick Overview & Settings */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 24 }}>
            <div className="details-card" style={{ padding: 14, textAlign: 'center' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Active Queue</div>
              <div style={{ fontSize: '1.5rem', fontWeight: '700', color: 'var(--primary-light)', marginTop: 4 }}>
                {jobs.filter(j => j.status === 'queued' || j.status === 'approved' || j.status === 'processing').length}
              </div>
            </div>
            <div className="details-card" style={{ padding: 14, textAlign: 'center' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Today's Prints</div>
              <div style={{ fontSize: '1.5rem', fontWeight: '700', color: 'var(--text)', marginTop: 4 }}>
                {jobs.filter(j => j.status === 'completed').length}
              </div>
            </div>
            {/* Print Mode Card */}
            <div className="details-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 8, fontWeight: '600' }}>Print Mode</div>
              <div style={{ display: 'flex', gap: 6, width: '100%', maxWidth: '240px' }}>
                <button
                  onClick={() => handleTogglePrintMode('manual')}
                  style={{
                    flex: 1,
                    padding: '6px 0',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: printMode === 'manual' ? 'var(--primary-dim)' : 'var(--bg-card)',
                    color: printMode === 'manual' ? 'var(--primary-light)' : 'var(--text-muted)',
                    fontSize: '0.75rem',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    outline: 'none',
                    transition: 'all 0.2s'
                  }}
                >
                  Manual
                </button>
                <button
                  onClick={() => handleTogglePrintMode('auto')}
                  style={{
                    flex: 1,
                    padding: '6px 0',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: printMode === 'auto' ? 'var(--primary-dim)' : 'var(--bg-card)',
                    color: printMode === 'auto' ? 'var(--primary-light)' : 'var(--text-muted)',
                    fontSize: '0.75rem',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    outline: 'none',
                    transition: 'all 0.2s'
                  }}
                >
                  Auto
                </button>
              </div>
            </div>
          </div>

          {/* Shop Info and Agent Download Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 12, marginBottom: 24 }}>
            {/* Shop Code & QR Card */}
            <div className="details-card" style={{ padding: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: '600' }}>SHOP CODE</div>
              {shopCode ? (
                <>
                  <div style={{ fontSize: '1.8rem', fontWeight: '800', color: 'var(--primary-light)', margin: '8px 0 4px 0', letterSpacing: '2px' }}>
                    {shopCode}
                  </div>
                  <button 
                    onClick={handleCopyCode} 
                    className="btn btn-secondary" 
                    style={{ height: 28, padding: '0 12px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', marginBottom: 12 }}
                  >
                    {copied ? 'Copied! ✅' : 'Copy Code'}
                  </button>
                  
                  {/* QR Code Container */}
                  <div style={{ background: '#fff', padding: 8, borderRadius: 8, border: '1px solid var(--border)', display: 'inline-flex' }}>
                    <canvas ref={canvasRef} style={{ width: 110, height: 110 }} />
                  </div>
                  <button 
                    onClick={handleDownloadQR} 
                    className="btn btn-secondary" 
                    style={{ height: 28, padding: '0 12px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', marginTop: 10 }}
                  >
                    💾 Download QR
                  </button>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 6 }}>
                    Scan to connect customer portal
                  </div>
                </>
              ) : (
                <div style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--error)', margin: '16px 0' }}>
                  Shop Code Not Available
                </div>
              )}
            </div>

            {/* Windows Agent Download Card */}
            <div className="details-card" style={{ padding: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: '600', marginBottom: 12 }}>WINDOWS PRINT CLIENT</div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 16px 0', lineHeight: '1.4' }}>
                Install the desktop agent on your Windows computer to connect this queue directly to your physical printer.
              </p>
              {agentDownloadUrl ? (
                <a 
                  href={agentDownloadUrl} 
                  className="btn btn-primary" 
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', gap: 8, textDecoration: 'none', height: 42 }}
                >
                  <span>Download Windows Agent</span>
                </a>
              ) : (
                <div style={{ fontSize: '0.8rem', background: 'rgba(255,59,48,0.08)', color: 'var(--error)', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--error)' }}>
                  ⚠️ Installer download URL is not configured.
                </div>
              )}
            </div>
          </div>

          {/* SECTION A: Pending Approval */}
          <section className="details-card" style={{ width: '100%', marginBottom: 24 }}>
            <div className="details-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <PrinterIcon size={18} color="var(--primary-light)" />
                <span>Pending Approval</span>
              </div>
              <button
                onClick={handleCreateSampleJob}
                className="btn btn-secondary"
                style={{ height: 26, padding: '0 10px', fontSize: '0.75rem', cursor: 'pointer' }}
              >
                + Create Sample Job
              </button>
            </div>

            {jobs.filter(j => j.status === 'queued').length === 0 ? (
              <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '24px 0', fontSize: '0.85rem' }}>
                No pending print requests.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {jobs.filter(j => j.status === 'queued').map((job) => (
                  <div key={job.id} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: 12,
                    borderRadius: 8,
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid var(--border)',
                    gap: 12,
                    flexWrap: 'wrap'
                  }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flex: 1, minWidth: '240px' }}>
                      <FileIcon size={18} color="var(--text-muted)" />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--text)', wordBreak: 'break-all' }}>
                          {job.file_name}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                          <span>Job ID: #{job.id.substring(0, 4)}</span>
                          <span>•</span>
                          <span>{job.page_count === null || job.page_count === undefined ? 'Unknown' : `${job.page_count} Pages`}</span>
                          <span>•</span>
                          <span>{job.copies} Copy{job.copies > 1 ? 'ies' : ''}</span>
                          <span>•</span>
                          <span style={{ textTransform: 'uppercase' }}>{job.color_mode}</span>
                          <span>•</span>
                          <span>{job.duplex ? 'Double Side' : 'Single Side'}</span>
                          <span>•</span>
                          <span>{formatTime(job.created_at)}</span>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button
                        onClick={() => handleApproveJob(job.id)}
                        className="btn btn-primary"
                        style={{
                          height: 32,
                          padding: '0 12px',
                          fontSize: '0.8rem',
                          background: 'var(--primary-dim)',
                          color: 'var(--primary-light)',
                          border: '1px solid var(--primary-light)',
                          cursor: 'pointer'
                        }}
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleRejectJob(job.id)}
                        className="btn btn-secondary"
                        style={{
                          height: 32,
                          padding: '0 12px',
                          fontSize: '0.8rem',
                          background: 'rgba(255,59,48,0.1)',
                          color: 'var(--error)',
                          border: '1px solid var(--error)',
                          cursor: 'pointer'
                        }}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right Column - Recent 10 Prints panel */}
        <div style={{ flex: '0 0 350px', minWidth: 320, alignSelf: 'start' }}>
          <section className="details-card" style={{ width: '100%' }}>
            <div className="details-title" style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
              <PrinterIcon size={18} color="var(--primary-light)" />
              <span>Recent 10 Prints</span>
            </div>

            {recentJobs.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '24px 0', fontSize: '0.85rem' }}>
                No recent jobs processed.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {recentJobs.map((job) => {
                  const price = calculateJobPrice(job);
                  return (
                    <div key={job.id} style={{
                      display: 'flex',
                      flexDirection: 'column',
                      padding: 12,
                      borderRadius: 8,
                      background: 'rgba(255,255,255,0.02)',
                      border: '1px solid var(--border)',
                      gap: 8
                    }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                        <FileIcon size={16} color="var(--text-muted)" style={{ marginTop: 2, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '0.82rem', fontWeight: '600', color: 'var(--text)', wordBreak: 'break-all', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={job.file_name}>
                            {job.file_name}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
                            {job.page_count === null || job.page_count === undefined ? 'Unknown' : `${job.page_count} p`} · {job.copies} copy{job.copies > 1 ? 'ies' : ''} · {job.color_mode === 'color' ? 'Color' : 'B&W'} · {job.duplex ? 'Double' : 'Single'}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: 6 }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: '700', color: price ? 'var(--success)' : 'var(--text-muted)' }}>
                          {price ? `₹${price}` : '₹-- (Unknown)'}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {job.status === 'failed' && (
                            <button
                              onClick={() => handleRetryJob(job.id)}
                              className="btn btn-primary"
                              style={{
                                height: 20,
                                padding: '0 6px',
                                fontSize: '0.65rem',
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
                          <span className={`badge badge-${job.status}`} style={{ textTransform: 'capitalize', fontSize: '0.58rem', padding: '2px 6px' }}>
                            {statusLabels[job.status]}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
