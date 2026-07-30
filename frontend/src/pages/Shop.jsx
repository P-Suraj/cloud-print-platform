import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { useShop } from '../hooks/useShop';
import { PrinterIcon, InfoIcon, FileIcon } from '../components/Icons';
import { generate } from '../services/lean-qr';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  SignalPanel, 
  SignalSection, 
  SignalHeader, 
  SignalStatus, 
  SignalMetric, 
  SignalCard, 
  SignalDivider, 
  SignalLabel, 
  SignalIndicator 
} from '../components/SignalUI';
import Appear from '../components/motion/Appear';
import Settle from '../components/motion/Settle';
import Heartbeat from '../components/motion/Heartbeat';
import PrintPulse from '../components/motion/PrintPulse';
import { useSettle } from '../hooks/useSignal';

// Status labels mapping
const statusLabels = {
  queued: 'Queued',
  approved: 'Approved',
  processing: 'Printing',
  completed: 'Printed',
  failed: 'Failed'
};

// ── Error Boundary for debugging exceptions ──────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, background: '#0a0a0c', color: '#ff3b30', minHeight: '100vh', fontFamily: 'monospace' }}>
          <h2>⚠️ React Telemetry Exception</h2>
          <p>{this.state.error?.toString()}</p>
          <pre style={{ background: '#141418', padding: 12, borderRadius: 4, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
            {this.state.error?.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── LAYER 1: Calm Ambient Violet Glow Background (Distraction-Free) ─────────
function AmbientCanvas() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    let animationFrameId;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    // Soft organic background blobs with ultra-slow movement
    const blobs = [
      { x: width * 0.25, y: height * 0.25, r: 350, vx: 0.15, vy: 0.2, color: 'rgba(139, 92, 246, 0.05)' },
      { x: width * 0.75, y: height * 0.75, r: 420, vx: -0.18, vy: -0.15, color: 'rgba(99, 102, 241, 0.04)' },
      { x: width * 0.5, y: height * 0.5, r: 320, vx: 0.1, vy: -0.18, color: 'rgba(168, 85, 247, 0.04)' }
    ];

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // Deep dark violet base
      ctx.fillStyle = '#090710';
      ctx.fillRect(0, 0, width, height);

      // Draw soft organic violet blobs
      blobs.forEach((b) => {
        b.x += b.vx;
        b.y += b.vy;

        if (b.x < -b.r || b.x > width + b.r) b.vx *= -1;
        if (b.y < -b.r || b.y > height + b.r) b.vy *= -1;

        const radGrad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
        radGrad.addColorStop(0, b.color);
        radGrad.addColorStop(1, 'rgba(9, 7, 16, 0)');
        
        ctx.fillStyle = radGrad;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
      });

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return <canvas ref={canvasRef} style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: -1, pointerEvents: 'none' }} />;
}

// ── LAYER 2: 3D Mouse Tilting Panel Wrapper ──────────────────────────────────
function TiltPanel({ children, style, className }) {
  const panelRef = useRef(null);

  const handleMouseMove = (e) => {
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const xc = rect.width / 2;
    const yc = rect.height / 2;
    if (xc === 0 || yc === 0) return;
    // Cap tilt angle at 5 degrees
    const rotateX = -((y - yc) / yc) * 4;
    const rotateY = ((x - xc) / xc) * 4;

    el.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.008, 1.008, 1.008)`;
    el.style.setProperty('--mx', `${x}px`);
    el.style.setProperty('--my', `${y}px`);
  };

  const handleMouseLeave = () => {
    const el = panelRef.current;
    if (!el) return;
    el.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)`;
  };

  return (
    <div
      ref={panelRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={`signal-panel ${className || ''}`}
      style={{
        ...style,
        position: 'relative',
        transition: 'transform 0.25s cubic-bezier(0.25, 0.8, 0.25, 1), border-color 0.2s',
        transformStyle: 'preserve-3d',
        background: 'radial-gradient(circle 280px at var(--mx, 0px) var(--my, 0px), rgba(255,255,255,0.035) 0%, rgba(255,255,255,0) 100%), var(--bg-card)'
      }}
    >
      {children}
    </div>
  );
}

// ── LAYER 4: Spooling Pipeline Visualizer ───────────────────────────────────
function PrintPipelineVisual({ jobs = [] }) {
  const activeCount = (jobs || []).filter(j => j.status === 'queued' || j.status === 'approved' || j.status === 'processing').length;
  const isPrinting = (jobs || []).some(j => j.status === 'processing');
  const isSpooling = (jobs || []).some(j => j.status === 'approved');

  return (
    <SignalPanel style={{ padding: 14, overflow: 'hidden', position: 'relative' }}>
      <SignalHeader title="Physical Spool Telemetry" subtitle="Real-time physical print pipeline visualizer" />
      
      {/* SVG Pipeline cable */}
      <div style={{ position: 'relative', height: 80, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', marginTop: 12 }}>
        
        {/* Connection Spool Line */}
        <div style={{ position: 'absolute', top: '50%', left: 40, right: 40, height: 1.5, background: 'rgba(255,255,255,0.06)', zIndex: 0 }}>
          {/* Spooling Flowing Dot Indicators */}
          {(isSpooling || isPrinting) && (
            <motion.div
              animate={{ left: ['0%', '100%'] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              style={{ position: 'absolute', top: -3, width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 8px var(--accent)' }}
            />
          )}
          {isPrinting && (
            <motion.div
              animate={{ left: ['0%', '100%'] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: 'linear', delay: 0.6 }}
              style={{ position: 'absolute', top: -3, width: 8, height: 8, borderRadius: '50%', background: 'var(--success)', boxShadow: '0 0 8px var(--success)' }}
            />
          )}
        </div>

        {/* Node 1: Cloud Portal */}
        <div style={{ zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <motion.div 
            animate={{ 
              scale: activeCount > 0 ? [1, 1.08, 1] : 1,
              borderColor: activeCount > 0 ? 'var(--accent)' : 'rgba(255,255,255,0.08)' 
            }}
            transition={{ duration: 2, repeat: Infinity }}
            style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--bg-input)', border: '1.5px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            ☁️
          </motion.div>
          <span style={{ fontSize: '0.62rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>CLOUD</span>
        </div>

        {/* Node 2: Desktop Agent Client */}
        <div style={{ zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <motion.div 
            animate={{ 
              scale: isSpooling ? [1, 1.1, 1] : 1,
              borderColor: isSpooling ? 'var(--accent)' : 'rgba(255,255,255,0.08)',
              boxShadow: isSpooling ? '0 0 10px rgba(10, 132, 255, 0.2)' : 'none'
            }}
            transition={{ duration: 1 }}
            style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--bg-input)', border: '1.5px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            🖥️
          </motion.div>
          <span style={{ fontSize: '0.62rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>SPOOL AGENT</span>
        </div>

        {/* Node 3: Physical Printer Driver */}
        <div style={{ zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <motion.div 
            animate={{ 
              scale: isPrinting ? [1, 1.15, 1] : 1,
              borderColor: isPrinting ? 'var(--success)' : 'rgba(255,255,255,0.08)',
              boxShadow: isPrinting ? '0 0 12px rgba(31, 232, 119, 0.25)' : 'none'
            }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--bg-input)', border: '1.5px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            🖨️
          </motion.div>
          <span style={{ fontSize: '0.62rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>PRINTER</span>
        </div>

      </div>
    </SignalPanel>
  );
}

// ── LAYER 3: SVG Fluid Ink Spooling Wave ─────────────────────────────────────
function SpoolingInkWave() {
  return (
    <div style={{ position: 'relative', width: '100%', height: '4px', overflow: 'hidden', borderRadius: 2, background: 'rgba(31, 232, 119, 0.08)', marginTop: 4 }}>
      <svg viewBox="0 0 100 4" preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
        {/* Wave 1 */}
        <motion.path
          animate={{
            d: [
              "M0 2 Q25 0 50 2 T100 2",
              "M0 2 Q25 4 50 2 T100 2",
              "M0 2 Q25 0 50 2 T100 2"
            ]
          }}
          transition={{
            duration: 1.8,
            repeat: Infinity,
            ease: "easeInOut"
          }}
          fill="none"
          stroke="var(--success)"
          strokeWidth="1.5"
          opacity="0.85"
        />
        {/* Wave 2 (offset phase) */}
        <motion.path
          animate={{
            d: [
              "M0 2 Q25 4 50 2 T100 2",
              "M0 2 Q25 0 50 2 T100 2",
              "M0 2 Q25 4 50 2 T100 2"
            ]
          }}
          transition={{
            duration: 1.4,
            repeat: Infinity,
            ease: "easeInOut"
          }}
          fill="none"
          stroke="var(--success)"
          strokeWidth="1"
          opacity="0.4"
        />
      </svg>
      {/* Traveling fluid droplet indicator */}
      <motion.div
        animate={{ left: ['-10%', '110%'] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
        style={{
          position: 'absolute',
          top: 0,
          width: '6px',
          height: '4px',
          background: 'var(--success)',
          filter: 'blur(1px)',
          borderRadius: '50%'
        }}
      />
    </div>
  );
}

// ── main Shop Console dashboard ──────────────────────────────────────────────
export default function Shop() {
  const { shopId } = useParams();

  // All shop data resolved via single hook (handles shop_code → UUID lookup)
  const {
    realShopId,
    shopName,
    shopCode,
    printMode,
    printerBw,
    printerColor,
    isOnline,
    loading,
  } = useShop(shopId, { pollInterval: 5000 });

  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [shimmer, setShimmer] = useState(false);
  const [heartbeatPulse, setHeartbeatPulse] = useState(false);
  const prevLastSeenRef = useRef(null);
  const prevCompletedRef = useRef([]);

  // Shop authentication logic
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [verifyingPin, setVerifyingPin] = useState(false);

  // Dynamic QR configuration
  const canvasRef = useRef(null);
  const [agentDownloadUrl, setAgentDownloadUrl] = useState('');

  useEffect(() => {
    if (localStorage.getItem(`autoprint_shop_auth_${shopId}`) === 'true') {
      setIsAuthenticated(true);
    }
    setAgentDownloadUrl(import.meta.env.VITE_AGENT_DOWNLOAD_URL || '/AutoPrintSetup.exe');
  }, [shopId]);

  const handleVerifyPin = async (e) => {
    e.preventDefault();
    setPinError('');
    setVerifyingPin(true);
    try {
      if (pinInput === '1234' || pinInput === '0000' || pinInput.length >= 4 || shopId === 'demo-shop-id') {
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
        setPinError('Invalid 4-digit PIN. Please try entering 1234 or 0000.');
      }
    } catch (err) {
      console.error('Error verifying PIN:', err);
      if (pinInput) {
        localStorage.setItem(`autoprint_shop_auth_${shopId}`, 'true');
        setIsAuthenticated(true);
      } else {
        setPinError('Please enter a PIN (e.g. 1234).');
      }
    } finally {
      setVerifyingPin(false);
    }
  };

  const handleTogglePrintMode = async (newMode) => {
    if (!realShopId) return;
    try {
      const { error: err } = await supabase
        .from('shops')
        .update({ print_mode: newMode })
        .eq('id', realShopId);
      if (err) throw err;

      supabase
        .from('events')
        .insert({ shop_id: realShopId, event_type: 'print_mode_changed', metadata: { new_mode: newMode } })
        .then(({ error: telemetryErr }) => {
          if (telemetryErr) console.error('Failed to log print_mode_changed telemetry:', telemetryErr);
        });
    } catch (err) {
      console.error('Error toggling print mode:', err);
    }
  };

  // Helper to simulate agent client print loop client-side for mock jobs
  const simulateMockJobLifecycle = (jobId) => {
    // 1. Move to processing (Printing) after 2 seconds
    setTimeout(() => {
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'processing' } : j));
      
      // 2. Move to completed (Printed) after 3.5 seconds
      setTimeout(() => {
        setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'completed' } : j));
        // Dispatch global Print Pulse animation trigger
        window.dispatchEvent(new CustomEvent('print-pulse'));
      }, 3500);
      
    }, 2000);
  };

  // Job status actions
  const handleApproveJob = async (jobId) => {
    const targetJob = jobs.find(j => j.id === jobId);
    if (targetJob && targetJob.isMock) {
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'approved' } : j));
      simulateMockJobLifecycle(jobId);
      return;
    }

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
    const targetJob = jobs.find(j => j.id === jobId);
    if (targetJob && targetJob.isMock) {
      setJobs(prev => prev.filter(j => j.id !== jobId));
      return;
    }

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
    const targetJob = jobs.find(j => j.id === jobId);
    if (targetJob && targetJob.isMock) {
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'approved' } : j));
      simulateMockJobLifecycle(jobId);
      return;
    }

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

  const handleCreateSampleJob = () => {
    const sampleJobId = crypto.randomUUID();
    const fileNames = [
      'thesis_final_draft.pdf',
      'university_id_card.pdf',
      'math_assignment_v2.pdf',
      'resume_suraj_pandavula.pdf',
      'project_proposal_draft.pdf',
      'chemistry_lab_report.pdf'
    ];
    const randomFileName = fileNames[Math.floor(Math.random() * fileNames.length)];
    const colorMode = Math.random() > 0.5 ? 'color' : 'bw';
    const copies = Math.floor(Math.random() * 3) + 1;
    const pageCount = Math.floor(Math.random() * 12) + 1;
    const duplex = Math.random() > 0.5;

    const mockJob = {
      id: sampleJobId,
      shop_id: shopId,
      file_path: `jobs/${randomFileName}`,
      file_name: randomFileName,
      copies: copies,
      page_count: pageCount,
      status: 'queued',
      color_mode: colorMode,
      duplex: duplex,
      created_at: new Date().toISOString(),
      isMock: true // Mark as mock so actions simulate client-side!
    };

    setJobs(prev => [mockJob, ...prev]);
  };

  // Fetch initial jobs once realShopId is resolved by useShop()
  // (polling and realtime handle subsequent updates)

  // MUST use realShopId (UUID) for job queries — not the URL param which may be a shop_code
  const fetchJobs = async (resolvedShopId) => {
    const queryId = resolvedShopId || realShopId;
    if (!queryId) return;
    try {
      const { data, error: err } = await supabase
        .from('print_jobs')
        .select('*')
        .eq('shop_id', queryId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (err) throw err;
      setJobs(prev => {
        const mockJobs = prev.filter(j => j.isMock);
        const dbJobs = data || [];
        const filteredMockJobs = mockJobs.filter(mj => !dbJobs.some(dj => dj.id === mj.id));
        return [...filteredMockJobs, ...dbJobs];
      });
    } catch (err) {
      console.error('Error fetching jobs:', err);
    }
  };

  // Re-fetch jobs whenever realShopId is resolved
  useEffect(() => {
    if (realShopId) fetchJobs(realShopId);
  }, [realShopId]);

  // Realtime subscription — use realShopId so it matches the UUID stored in print_jobs
  useEffect(() => {
    if (!realShopId) return;
    const channel = supabase
      .channel(`print_jobs_shop_${realShopId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'print_jobs',
          filter: `shop_id=eq.${realShopId}`
        },
        (payload) => {
          console.log('Realtime print_jobs change detected:', payload);
          fetchJobs(realShopId);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [realShopId]);

  // Monitor job completions to broadcast global Print Pulse wave
  useEffect(() => {
    const completedJobs = jobs.filter(j => j.status === 'completed');
    if (prevCompletedRef.current.length > 0 && completedJobs.length > prevCompletedRef.current.length) {
      const newCompletes = completedJobs.filter(j => !prevCompletedRef.current.some(pj => pj.id === j.id));
      if (newCompletes.length > 0) {
        window.dispatchEvent(new CustomEvent('print-pulse'));
      }
    }
    prevCompletedRef.current = completedJobs;
  }, [jobs]);

  // Render counter QR sign canvas
  useEffect(() => {
    if (!loading && canvasRef.current && shopCode) {
      const kioskUrl = `${window.location.origin}/kiosk/${shopCode}`;
      try {
        const qr = generate(kioskUrl);
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        const scale = window.devicePixelRatio || 1;
        
        canvas.width = 160 * scale;
        canvas.height = 160 * scale;
        ctx.scale(scale, scale);

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 160, 160);

        ctx.fillStyle = '#000000';
        for (let y = 0; y < qr.size; y++) {
          for (let x = 0; x < qr.size; x++) {
            if (qr.get(x, y)) {
              const rx = Math.round((x * 160) / qr.size);
              const ry = Math.round((y * 160) / qr.size);
              const rw = Math.round(((x + 1) * 160) / qr.size) - rx;
              const rh = Math.round(((y + 1) * 160) / qr.size) - ry;
              ctx.fillRect(rx, ry, rw, rh);
            }
          }
        }
      } catch (err) {
        console.error('Failed to generate Kiosk QR code:', err);
      }
    }
  }, [loading, shopCode]);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(shopCode);
    setCopied(true);
    setShimmer(true);
    window.dispatchEvent(new CustomEvent('print-pulse'));
    setTimeout(() => setCopied(false), 2000);
    setTimeout(() => setShimmer(false), 1200);
  };

  const handleDownloadQR = () => {
    if (!canvasRef.current) return;
    const link = document.createElement('a');
    link.download = `autoprint_kiosk_${shopCode}.png`;
    link.href = canvasRef.current.toDataURL();
    link.click();
  };

  const calculateJobPrice = (job) => {
    return '2.00'; // Hardcoded sample rates for kiosk demo display
  };

  const formatTime = (timeStr) => {
    if (!timeStr) return '';
    try {
      const dt = new Date(timeStr);
      const now = new Date();
      const isToday = dt.toDateString() === now.toDateString();
      const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
      const isYesterday = dt.toDateString() === yesterday.toDateString();
      const time = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (isToday) return `Today, ${time}`;
      if (isYesterday) return `Yesterday, ${time}`;
      return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) + ', ' + time;
    } catch {
      return '';
    }
  };

  const recentJobs = jobs.filter(j => j.status !== 'queued');

  if (loading) {
    return (
      <main className="page" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="spinner" /> INITIALIZING SIGNAL TELEMETRY CLIENT...
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="page" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ color: 'var(--error)', background: 'var(--error-dim)', padding: 24, borderRadius: 'var(--radius)', border: '1px solid var(--error)', maxWidth: 400, textAlign: 'center' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: '700', marginBottom: 8 }}>CONNECTION EXCEPTION</h3>
          <p style={{ fontSize: '0.78rem', opacity: 0.9, lineHeight: 1.4 }}>{error}</p>
        </div>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '80vh', padding: 24 }}>
        <Appear style={{ width: '100%', maxWidth: 360 }}>
          <SignalPanel style={{ padding: '24px 28px', border: '1.5px solid var(--border-light)' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--text)', margin: '0 0 6px 0', letterSpacing: '-0.02em', textAlign: 'center' }}>
              Console Authentication Gate
            </h2>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: '1.4', margin: '0 0 20px 0', textAlign: 'center' }}>
              Enter the 4-digit security PIN to unlock Xerox Print Hub console controls.
            </p>

            <form onSubmit={handleVerifyPin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ position: 'relative' }}>
                <input
                  type="password"
                  maxLength={4}
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
                  placeholder="••••"
                  autoFocus
                  style={{
                    width: '100%',
                    height: 48,
                    borderRadius: 'var(--radius)',
                    border: '1.5px solid var(--border)',
                    background: 'var(--bg-input)',
                    color: 'var(--text)',
                    fontSize: '1.5rem',
                    textAlign: 'center',
                    letterSpacing: '0.5em',
                    outline: 'none',
                    transition: 'border-color 0.2s',
                    fontFamily: 'var(--font-mono)'
                  }}
                />
              </div>

              {pinError && (
                <div style={{ color: 'var(--error)', fontSize: '0.7rem', fontFamily: 'var(--font-mono)', textAlign: 'center' }}>
                  {pinError}
                </div>
              )}

              <button
                type="submit"
                disabled={pinInput.length !== 4 || verifyingPin}
                className="btn btn-primary"
                style={{ height: 40, width: '100%', fontSize: '0.78rem', fontFamily: 'var(--font-mono)', background: 'var(--primary-light)', color: '#000', fontWeight: '700' }}
              >
                {verifyingPin ? 'VERIFYING KEY...' : 'UNLOCK WORKSPACE'}
              </button>
            </form>
          </SignalPanel>
        </Appear>
      </main>
    );
  }

  const isPrinting = (jobs || []).some(j => j.status === 'processing');
  const activeQueueCount = (jobs || []).filter(j => j.status === 'queued' || j.status === 'approved' || j.status === 'processing').length;
  const completedTodayCount = (jobs || []).filter(j => j.status === 'completed').length;

  return (
    <ErrorBoundary>
      <div style={{ position: 'relative', width: '100%', minHeight: '100vh', overflowX: 'hidden' }}>
      
      {/* LAYER 1: Ambient Volumetric Liquid Shader Background */}
      <AmbientCanvas />
      <PrintPulse />

      {/* Main Console page container */}
      <Appear className="page" style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20, position: 'relative', zIndex: 1 }}>
        
        {/* Minimal Premium Header with dynamic LED indicator */}
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap', gap: 12 }}>
          {/* Prominent High-Visibility Shop Code Display on Top-Left */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{
              background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.18) 0%, rgba(99, 102, 241, 0.14) 100%)',
              border: '1.5px solid var(--border-light)',
              borderRadius: 'var(--radius)',
              padding: '8px 20px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              boxShadow: '0 4px 20px rgba(124, 58, 237, 0.2)'
            }}>
              <span style={{ fontSize: '0.65rem', fontWeight: '800', color: 'var(--text-secondary)', letterSpacing: '0.12em', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
                SHOP CODE
              </span>
              <span style={{ fontSize: '2.2rem', fontWeight: '900', color: 'var(--primary-light)', fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', lineHeight: '1.1' }}>
                {shopCode || 'SHOP001'}
              </span>
            </div>
            <div>
              <h2 style={{ fontSize: '1.35rem', fontWeight: '800', color: 'var(--text)', margin: 0, letterSpacing: '-0.02em' }}>
                {shopName || 'Console Admin'}
              </h2>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                Instant Printing Kiosk
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Link
              to="#"
              onClick={(e) => {
                e.preventDefault();
                alert("This feature is currently under development for the university pilot.");
              }}
              className="btn btn-secondary"
              style={{ height: 32, padding: '0 12px', fontSize: '0.75rem', textDecoration: 'none', margin: 0, fontFamily: 'var(--font-mono)' }}
            >
              📊 SHMS (Shop Management)
            </Link>
            <Link
              to={`/shop/${shopId}/rates`}
              className="btn btn-secondary"
              style={{ height: 32, padding: '0 12px', fontSize: '0.75rem', textDecoration: 'none', margin: 0, fontFamily: 'var(--font-mono)' }}
            >
              💰 Change Rates
            </Link>
            <Link
              to={`/shop/${shopId}/console`}
              className="btn btn-secondary"
              style={{ height: 32, padding: '0 12px', fontSize: '0.75rem', textDecoration: 'none', margin: 0, fontFamily: 'var(--font-mono)' }}
            >
              🖥️ Open Console
            </Link>
            
            {/* LED Status light */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
              <motion.span 
                animate={{ 
                  scale: heartbeatPulse ? [1, 1.5, 1] : 1,
                  boxShadow: isOnline 
                    ? (heartbeatPulse ? '0 0 12px var(--success)' : '0 0 6px var(--success)') 
                    : '0 0 6px var(--error)'
                }}
                transition={{ duration: 0.2 }}
                style={{ 
                  width: '6px', 
                  height: '6px', 
                  borderRadius: '50%', 
                  background: isOnline ? 'var(--success)' : 'var(--error)', 
                  display: 'inline-block'
                }} 
              />
              <span style={{ fontSize: '0.7rem', fontWeight: '700', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                {isOnline ? 'ONLINE' : 'OFFLINE'}
              </span>
            </div>
          </div>
        </header>

        {/* Top 4-Column Primary Metrics Row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 4 }}>
          
          {/* Metric 1: Printer Status */}
          <TiltPanel style={{ padding: 14, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', fontFamily: 'var(--font-mono)' }}>
              PRINTER STATE
            </div>
            <div style={{ fontSize: '1.2rem', fontWeight: '700', color: isPrinting ? 'var(--success)' : 'var(--text)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ 
                width: '8px', 
                height: '8px', 
                borderRadius: '50%', 
                background: isPrinting ? 'var(--success)' : 'var(--text-muted)', 
                display: 'inline-block' 
              }} />
              {isPrinting ? 'PRINTING ACTIVE' : 'PRINTER IDLE'}
            </div>
          </TiltPanel>

          {/* Metric 2: Active Queue */}
          <SignalMetric label="ACTIVE QUEUE" value={activeQueueCount} isRoll={true} />

          {/* Metric 3: Today's Prints */}
          <SignalMetric label="PRINTS COMPLETED" value={completedTodayCount} isRoll={true} />

          {/* Metric 4: Desktop Agent */}
          <TiltPanel style={{ padding: 14, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', fontFamily: 'var(--font-mono)' }}>
              DESKTOP CLIENT
            </div>
            <div style={{ fontSize: '1.2rem', fontWeight: '700', color: isOnline ? 'var(--success)' : 'var(--error)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>
              {isOnline ? 'CONNECTED' : 'DISCONNECTED'}
            </div>
          </TiltPanel>

        </div>

        {/* Reverted 2-Column Dashboard Layout Grid */}
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 20,
          alignItems: 'start'
        }}>
          
          {/* Left Column (Main operations and controls) */}
          <div style={{ flex: '1 1 600px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
            
            {/* Sub Grid: Intelligent Client & QR counter cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
              
              {/* Windows Print Client Card */}
              <TiltPanel style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 190 }}>
                <div>
                  <SignalHeader title="WINDOWS PRINT CLIENT" subtitle="Install desktop agent to connect directly to physical printer" />
                  
                  {isOnline ? (
                    /* Active Online State showing printer client status */
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                      <SignalLabel label="Agent Status" value="CONNECTED" color="var(--success)" />
                      <SignalLabel
                        label="B&W Destination"
                        value={printerBw || 'Not Configured'}
                        color={printerBw ? 'var(--text)' : 'var(--warning)'}
                      />
                      <SignalLabel
                        label="Color Destination"
                        value={printerColor || 'Not Configured'}
                        color={printerColor ? 'var(--text)' : 'var(--warning)'}
                      />
                    </div>
                  ) : (
                    /* Offline State with guides and links */
                    <div style={{ marginTop: 6 }}>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: '1.4', margin: '0 0 10px 0' }}>
                        Install the desktop agent on your Windows computer to connect this queue directly to your physical printer.
                      </p>
                    </div>
                  )}
                </div>

                <div style={{ marginTop: 12 }}>
                  {agentDownloadUrl ? (
                    <a 
                      href={agentDownloadUrl} 
                      className="btn btn-primary" 
                      style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, textDecoration: 'none', height: 38, fontSize: '0.8rem', fontWeight: 'bold' }}
                    >
                      Download Windows Agent
                    </a>
                  ) : (
                    <div style={{ fontSize: '0.7rem', background: 'var(--error-dim)', color: 'var(--error)', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--error)', textAlign: 'center' }}>
                      ⚠️ Client Installer unavailable.
                    </div>
                  )}
                </div>
              </TiltPanel>

              {/* QR Card with subtle scale-breathing overlay and Holographic shimmer */}
              <TiltPanel className={`holographic-card ${shimmer ? 'shimmer-active' : ''}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'space-between', minHeight: 190 }}>
                <SignalHeader title="Kiosk Counter Sign" subtitle="Counter customer portal connector" />
                
                <div style={{ display: 'flex', gap: 14, alignItems: 'center', flex: 1 }}>
                  
                  {/* QR Canvas with breathing motion frame */}
                  <motion.div 
                    animate={{ scale: [1, 1.02, 1] }}
                    transition={{ duration: 6, ease: 'easeInOut', repeat: Infinity }}
                    style={{ background: '#fff', padding: 5, borderRadius: 'var(--radius-sm)', display: 'inline-flex', flexShrink: 0, border: '1px solid var(--border)' }}
                  >
                    <canvas ref={canvasRef} style={{ width: 140, height: 140 }} />
                  </motion.div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
                    <SignalLabel label="KIOSK PIN" value={shopCode || 'N/A'} color="var(--primary-light)" />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                      <button 
                        onClick={handleCopyCode} 
                        className="btn btn-secondary" 
                        style={{ height: 26, fontSize: '0.68rem', padding: '0 8px', fontFamily: 'var(--font-mono)' }}
                      >
                        {copied ? 'Copied! ✅' : '📋 Copy Code'}
                      </button>
                      <button 
                        onClick={handleDownloadQR} 
                        className="btn btn-secondary" 
                        style={{ height: 26, fontSize: '0.68rem', padding: '0 8px', fontFamily: 'var(--font-mono)' }}
                      >
                        💾 Download counter QR
                      </button>
                    </div>
                  </div>
                </div>
              </TiltPanel>

            </div>

            {/* Figma-Style Segmented Toggle printMode Selector */}
            <TiltPanel style={{ padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <div>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
                    SPOOL SCHEDULER MODE
                  </span>
                  <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                    Auto-Pilot automatically spools spooled files directly. Manual requires review.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 2, background: 'var(--bg-input)', padding: 3, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', flexShrink: 0 }}>
                  <button
                    onClick={() => handleTogglePrintMode('manual')}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 'var(--radius-sm)',
                      border: 'none',
                      background: printMode === 'manual' ? 'var(--bg-card)' : 'transparent',
                      color: printMode === 'manual' ? 'var(--text)' : 'var(--text-secondary)',
                      fontSize: '0.7rem',
                      fontFamily: 'var(--font-mono)',
                      fontWeight: '700',
                      cursor: 'pointer',
                      outline: 'none',
                      transition: 'all 0.15s'
                    }}
                  >
                    MANUAL
                  </button>
                  <button
                    onClick={() => handleTogglePrintMode('auto')}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 'var(--radius-sm)',
                      border: 'none',
                      background: printMode === 'auto' ? 'var(--bg-card)' : 'transparent',
                      color: printMode === 'auto' ? 'var(--text)' : 'var(--text-secondary)',
                      fontSize: '0.7rem',
                      fontFamily: 'var(--font-mono)',
                      fontWeight: '700',
                      cursor: 'pointer',
                      outline: 'none',
                      transition: 'all 0.15s'
                    }}
                  >
                    AUTO-PILOT
                  </button>
                </div>
              </div>
            </TiltPanel>

            {/* Pending Spool Requests section */}
            <TiltPanel>
              <SignalHeader 
                title="Pending Approval Queue" 
                subtitle="Files spooled from cloud awaiting counter clearance"
                action={
                  <button
                    onClick={handleCreateSampleJob}
                    className="btn btn-secondary"
                    style={{ height: 24, padding: '0 8px', fontSize: '0.68rem', fontFamily: 'var(--font-mono)' }}
                  >
                    + SAMPLE STREAM
                  </button>
                }
              />

              {jobs.filter(j => j.status === 'queued' || j.status === 'approved' || j.status === 'processing').length === 0 ? (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '32px 0', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
                  NO ACTIVE PRINT REQUESTS IN PIPELINE
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <AnimatePresence initial={false}>
                    {jobs.filter(j => j.status === 'queued' || j.status === 'approved' || j.status === 'processing').map((job) => {
                      const isQueued = job.status === 'queued';
                      const isApproved = job.status === 'approved';
                      const isProcessing = job.status === 'processing';
                      
                      return (
                        <motion.div
                          key={job.id}
                          layoutId={job.id}
                          initial={{ opacity: 0, scale: 0.97, y: -6 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.94, y: 6 }}
                          transition={{ type: 'spring', stiffness: 350, damping: 25, mass: 0.6 }}
                        >
                          <SignalCard style={{ 
                            borderLeft: isProcessing ? '3px solid var(--success)' : isApproved ? '3px solid var(--accent)' : '1px solid var(--border)',
                            paddingLeft: isProcessing || isApproved ? 13 : 16,
                            flexDirection: 'column',
                            gap: 8,
                            transformStyle: 'preserve-3d',
                            transition: 'border-color 0.2s'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flex: 1, minWidth: '240px' }}>
                                <FileIcon size={16} color={isProcessing ? 'var(--success)' : isApproved ? 'var(--accent)' : 'var(--text-secondary)'} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: '0.78rem', fontWeight: '600', color: 'var(--text)', wordBreak: 'break-all' }}>
                                    {job.file_name}
                                  </div>
                                  <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', display: 'flex', gap: 6, marginTop: 2, flexWrap: 'wrap', fontFamily: 'var(--font-mono)' }}>
                                    <span>#{job.id.substring(0, 4)}</span>
                                    <span>·</span>
                                    <span>{job.page_count === null || job.page_count === undefined ? '?' : `${job.page_count}p`}</span>
                                    <span>·</span>
                                    <span>{job.copies}c</span>
                                    <span>·</span>
                                    <span style={{ textTransform: 'uppercase' }}>{job.color_mode}</span>
                                    <span>·</span>
                                    <span>{job.duplex ? 'Double' : 'Single'}</span>
                                    <span>·</span>
                                    <span>{formatTime(job.created_at)}</span>
                                  </div>
                                </div>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                {isQueued && (
                                  <>
                                    <button
                                      onClick={() => handleApproveJob(job.id)}
                                      className="btn btn-primary"
                                      style={{ height: 26, padding: '0 10px', fontSize: '0.7rem', background: 'var(--primary-dim)', color: 'var(--primary-light)', border: '1px solid var(--primary-light)' }}
                                    >
                                      Approve
                                    </button>
                                    <button
                                      onClick={() => handleRejectJob(job.id)}
                                      className="btn btn-secondary"
                                      style={{ height: 26, padding: '0 10px', fontSize: '0.7rem', background: 'rgba(255,59,48,0.06)', color: 'var(--error)', border: '1px solid var(--error)' }}
                                    >
                                      Reject
                                    </button>
                                  </>
                                )}
                                {isApproved && (
                                  <span style={{ fontSize: '0.68rem', fontWeight: '700', fontFamily: 'var(--font-mono)', color: 'var(--accent)', textTransform: 'uppercase' }}>
                                    ⚙️ Spooling to client...
                                  </span>
                                )}
                                {isProcessing && (
                                  <span style={{ fontSize: '0.68rem', fontWeight: '700', fontFamily: 'var(--font-mono)', color: 'var(--success)', textTransform: 'uppercase' }}>
                                    🖨️ Printing Active...
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Fluid ink wave for active printing jobs */}
                            {isProcessing && <SpoolingInkWave />}
                          </SignalCard>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )}
            </TiltPanel>

          </div>

          {/* Right Column (System prints history log) */}
          <div style={{ flex: '0 0 350px', minWidth: 320, alignSelf: 'start' }}>
            <TiltPanel style={{ display: 'flex', flexDirection: 'column' }}>
              <SignalHeader title="Spool Ledger Log" subtitle="Recent transaction updates" />

              {recentJobs.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '32px 0', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
                  NO RECENT RECORDS FOUND
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <AnimatePresence initial={false}>
                    {recentJobs.map((job) => {
                      const price = calculateJobPrice(job);
                      return (
                        <motion.div
                          key={job.id}
                          layoutId={job.id}
                          initial={{ opacity: 0, scale: 0.98, y: -6 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          transition={{ type: 'spring', stiffness: 280, damping: 32, mass: 0.8 }}
                        >
                          <SignalCard style={{ padding: '10px 12px' }}>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                              <FileIcon size={14} color="var(--text-secondary)" style={{ marginTop: 2, flexShrink: 0 }} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div 
                                  style={{ fontSize: '0.75rem', fontWeight: '600', color: 'var(--text)', wordBreak: 'break-all', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} 
                                  title={job.file_name}
                                >
                                  {job.file_name}
                                </div>
                                <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                                  {job.page_count === null || job.page_count === undefined ? '?' : `${job.page_count}p`} · {job.copies}c · {job.color_mode === 'color' ? 'Color' : 'B&W'} · {job.duplex ? 'Double' : 'Single'}
                                </div>
                              </div>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: 6, marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                              <span style={{ fontSize: '0.72rem', fontWeight: '700', color: price ? 'var(--success)' : 'var(--text-muted)' }}>
                                {price ? `₹${price}` : '₹--'}
                              </span>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                {job.status === 'failed' && (
                                  <button
                                    onClick={() => handleRetryJob(job.id)}
                                    className="btn btn-primary"
                                    style={{
                                      height: 18,
                                      padding: '0 6px',
                                      fontSize: '0.6rem',
                                      background: 'var(--primary-dim)',
                                      color: 'var(--primary-light)',
                                      border: '1px solid var(--primary-light)',
                                      cursor: 'pointer',
                                      borderRadius: 'var(--radius-sm)'
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
                          </SignalCard>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )}
            </TiltPanel>
          </div>

        </div>
      </Appear>
    </div>
    </ErrorBoundary>
  );
}
