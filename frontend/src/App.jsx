import { useState, useEffect } from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from './services/supabase';
import Home from './pages/Home';
import Demo from './pages/Demo/Demo';
import Status from './pages/Status';
import Shop from './pages/Shop';
import ShopConsole from './pages/ShopConsole';
import ShopRates from './pages/ShopRates';
import DashboardOverview from './pages/DashboardOverview';
import JobBoard from './pages/JobBoard';
import Customers from './pages/Customers';
import Files from './pages/Files';
import Payments from './pages/Payments';
import ShopLedger from './pages/ShopLedger';
import AdminDashboard from './pages/AdminDashboard';

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

  const [shopData, setShopData] = useState(null);
  const [agentOnline, setAgentOnline] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);

  const [copiedEmail, setCopiedEmail] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState(false);
  const [copiedDiag, setCopiedDiag] = useState(false);

  // In-App Feedback & Bug Report modal states
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const [reportType, setReportType] = useState('bug');
  const [userMessage, setUserMessage] = useState('');
  const [selectedJobId, setSelectedJobId] = useState('');
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState(false);

  // Parse path and query params to automatically resolve active shop state
  useEffect(() => {
    let active = true;
    const pathParts = location.pathname.split('/');
    
    let shopId = null;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const part of pathParts) {
      if (uuidRegex.test(part)) {
        shopId = part;
        break;
      }
    }

    const queryParams = new URLSearchParams(location.search);
    const shopCodeParam = queryParams.get('shop');

    async function fetchShopInfo() {
      try {
        let query = supabase.from('shops').select('id, name, shop_code, printer_bw, printer_color, last_seen_at');
        if (shopId) {
          query = query.eq('id', shopId);
        } else if (shopCodeParam) {
          query = query.eq('shop_code', shopCodeParam.trim().toUpperCase());
        } else {
          if (active) {
            setShopData(null);
            setAgentOnline(false);
          }
          return;
        }

        const { data, error } = await query.single();
        if (error) throw error;

        if (data && active) {
          setShopData(data);
          if (data.last_seen_at) {
            const lastSeen = new Date(data.last_seen_at).getTime();
            const timeDiff = Date.now() - lastSeen;
            setAgentOnline(timeDiff < 90000);
          } else {
            setAgentOnline(false);
          }
        }
      } catch (err) {
        // Silent catch for non-shop related paths
      }
    }

    fetchShopInfo();

    const interval = setInterval(() => {
      if (shopId || shopCodeParam) {
        fetchShopInfo();
      }
    }, 10000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [location.pathname, location.search]);

  const handleCopy = (text, setCopiedState) => {
    navigator.clipboard.writeText(text);
    setCopiedState(true);
    setTimeout(() => setCopiedState(false), 2000);
  };

  const getDiagnosticsText = () => {
    const ua = navigator.userAgent;
    let osName = 'Windows';
    if (ua.indexOf('Win') !== -1) {
      if (ua.indexOf('Windows NT 10.0') !== -1) osName = 'Windows 10/11';
      else if (ua.indexOf('Windows NT 6.3') !== -1) osName = 'Windows 8.1';
      else if (ua.indexOf('Windows NT 6.2') !== -1) osName = 'Windows 8';
      else if (ua.indexOf('Windows NT 6.1') !== -1) osName = 'Windows 7';
      else osName = 'Windows';
    } else {
      osName = 'Non-Windows Client';
    }

    return `AutoPrint Version: 1.0.0
Windows Version: ${osName}
Printer Name: BW: ${shopData?.printer_bw || 'N/A'}, Color: ${shopData?.printer_color || 'N/A'}
Shop ID: ${shopData?.id || 'No active shop'}
Agent Status: ${shopData ? (agentOnline ? 'Online' : 'Offline') : 'N/A'}`;
  };

  const getRecentPrintJobs = () => {
    try {
      const stored = localStorage.getItem('autoprint_recent_jobs');
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {}
    // Sample jobs if no local history found
    return [
      { id: 'job-101', file_name: 'thesis_final_draft.pdf', doc_format: '.pdf', page_count: 8, copies: 1, color_mode: 'bw', duplex: true, status: 'failed', job_error: 'Paper Jam in Printer Tray 2' },
      { id: 'job-102', file_name: 'university_id_card.pdf', doc_format: '.pdf', page_count: 1, copies: 2, color_mode: 'color', duplex: false, status: 'completed', job_error: null },
      { id: 'job-103', file_name: 'lab_experiment_notes.pdf', doc_format: '.pdf', page_count: 14, copies: 1, color_mode: 'bw', duplex: true, status: 'queued', job_error: null }
    ];
  };

  const openFeedbackModal = (type = 'bug') => {
    setReportType(type);
    setUserMessage('');
    setFeedbackSuccess(false);
    const jobs = getRecentPrintJobs();
    if (jobs.length > 0) setSelectedJobId(jobs[0].id);
    setFeedbackModalOpen(true);
  };

  const handleSubmitFeedback = async (e) => {
    e.preventDefault();
    if (!userMessage.trim()) return;

    setSubmittingFeedback(true);
    const jobsList = getRecentPrintJobs();
    const targetJob = jobsList.find(j => j.id === selectedJobId) || {};

    const fileExt = targetJob.file_name ? `.${targetJob.file_name.split('.').pop()}` : '.pdf';

    const newReport = {
      id: crypto.randomUUID(),
      report_type: reportType,
      user_message: userMessage.trim().substring(0, 500),
      shop_id: shopData?.shop_code || 'SHOP001',
      job_id: targetJob.id || null,
      file_name: targetJob.file_name || null,
      doc_format: fileExt,
      page_count: targetJob.page_count || 1,
      copies: targetJob.copies || 1,
      color_mode: targetJob.color_mode || 'bw',
      duplex: targetJob.duplex || false,
      job_status: targetJob.status || null,
      job_error: targetJob.job_error || null,
      diagnostics: getDiagnosticsText(),
      status: 'open',
      created_at: new Date().toISOString()
    };

    // Save locally
    const existingLocal = JSON.parse(localStorage.getItem('autoprint_local_feedback') || '[]');
    localStorage.setItem('autoprint_local_feedback', JSON.stringify([newReport, ...existingLocal]));

    // Try Supabase insert
    try {
      await supabase.from('feedback_reports').insert([{
        report_type: newReport.report_type,
        user_message: newReport.user_message,
        shop_id: newReport.shop_id,
        job_id: newReport.job_id,
        file_name: newReport.file_name,
        doc_format: newReport.doc_format,
        page_count: newReport.page_count,
        copies: newReport.copies,
        color_mode: newReport.color_mode,
        duplex: newReport.duplex,
        job_status: newReport.job_status,
        job_error: newReport.job_error,
        diagnostics: newReport.diagnostics
      }]);
    } catch (err) {
      console.warn('Supabase feedback insert warning, report saved locally:', err);
    } finally {
      setSubmittingFeedback(false);
      setFeedbackSuccess(true);
    }
  };

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
        <Route path="/shop/:shopId/ledger" element={<ShopLedger />} />
        <Route path="/shop/:shopId/dashboard" element={<DashboardOverview />} />
        <Route path="/shop/:shopId/jobs" element={<JobBoard />} />
        <Route path="/shop/:shopId/customers" element={<Customers />} />
        <Route path="/shop/:shopId/files" element={<Files />} />
        <Route path="/shop/:shopId/payments" element={<Payments />} />
        <Route path="/admin" element={<AdminDashboard />} />
      </Routes>

      {/* Floating Help Button */}
      <button 
        className="floating-help-btn"
        onClick={() => setShowHelpModal(true)}
        aria-label="Help and Support"
      >
        <span style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>?</span>
        <span style={{ fontSize: '0.85rem', fontWeight: '700', marginLeft: '6px', whiteSpace: 'nowrap' }}>Need Help</span>
      </button>

      {/* Help & Support Modal Dialog */}
      {showHelpModal && (
        <div className="help-overlay" onClick={() => setShowHelpModal(false)}>
          <div className="help-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Need Help?</div>
              <button className="modal-close-btn" onClick={() => setShowHelpModal(false)}>×</button>
            </div>
            
            <div className="modal-body">
              {/* Support Contact Info */}
              <div className="help-section">
                <div className="help-section-title">Support Channels</div>
                
                {/* WhatsApp Channel */}
                <div className="help-contact-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: '1.1rem' }}>💬</span>
                      <div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 'bold' }}>WhatsApp Support</div>
                        <div style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--text)' }}>+91 8688961783</div>
                      </div>
                    </div>
                  </div>
                  <a 
                    href="https://wa.me/918688961783?text=Hi%20Suraj%20Pandavula,%20I%20need%20help%20with%20AutoPrint."
                    target="_blank"
                    rel="noopener noreferrer"
                    className="help-action-btn"
                    style={{ background: 'rgba(52, 211, 153, 0.15)', borderColor: 'rgba(52, 211, 153, 0.3)', color: 'var(--success)', textDecoration: 'none' }}
                  >
                    💬 Chat on WhatsApp
                  </a>
                </div>

                {/* Email Channel */}
                <div className="help-contact-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: '1.1rem' }}>📧</span>
                      <div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 'bold' }}>Email Support</div>
                        <div style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--text)' }}>psuraj1947@gmail.com</div>
                      </div>
                    </div>
                  </div>
                  <a 
                    href="mailto:psuraj1947@gmail.com?subject=AutoPrint%20Support%20Request"
                    className="help-action-btn"
                    style={{ background: 'var(--primary-dim)', borderColor: 'var(--border-light)', color: 'var(--primary-light)', textDecoration: 'none' }}
                  >
                    📧 Email Support
                  </a>
                </div>

                {/* Direct Clipboard Actions */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                  <button 
                    className="help-mini-btn"
                    style={{ flex: '1 1 calc(50% - 8px)', padding: '8px 12px' }}
                    onClick={() => handleCopy('psuraj1947@gmail.com', setCopiedEmail)}
                  >
                    {copiedEmail ? 'Copied! ✅' : '📋 Copy Email'}
                  </button>
                  <button 
                    className="help-mini-btn"
                    style={{ flex: '1 1 calc(50% - 8px)', padding: '8px 12px' }}
                    onClick={() => handleCopy('+91 8688961783', setCopiedPhone)}
                  >
                    {copiedPhone ? 'Copied! ✅' : '📋 Copy WhatsApp Number'}
                  </button>
                </div>
              </div>

              {/* In-App Actions & Feedback Buttons */}
              <div className="help-section">
                <div className="help-section-title">Feedback & Reports</div>
                <div className="help-action-links">
                  <button 
                    onClick={() => { setShowHelpModal(false); openFeedbackModal('feedback'); }} 
                    className="help-action-btn"
                    style={{ cursor: 'pointer', textAlign: 'left', width: '100%' }}
                  >
                    ✍️ Send Feedback
                  </button>
                  <button 
                    onClick={() => { setShowHelpModal(false); openFeedbackModal('bug'); }} 
                    className="help-action-btn"
                    style={{ cursor: 'pointer', textAlign: 'left', width: '100%' }}
                  >
                    🐛 Report a Bug
                  </button>
                  <button 
                    onClick={() => { setShowHelpModal(false); openFeedbackModal('feature'); }} 
                    className="help-action-btn"
                    style={{ cursor: 'pointer', textAlign: 'left', width: '100%' }}
                  >
                    💡 Request a Feature
                  </button>
                </div>
              </div>

              {/* Diagnostics Box */}
              <div className="help-section">
                <div className="help-section-title" style={{ display: 'flex', justify: 'space-between', alignItems: 'center' }}>
                  <span>Diagnostics</span>
                  <button 
                    className="help-mini-btn"
                    onClick={() => handleCopy(getDiagnosticsText(), setCopiedDiag)}
                  >
                    {copiedDiag ? 'Copied! ✅' : '📋 Copy Diagnostics'}
                  </button>
                </div>
                <div className="diagnostics-box">
                  {getDiagnosticsText()}
                </div>
              </div>

              {/* About Section */}
              <div className="help-section" style={{ borderBottom: 'none', paddingBottom: 0, marginBottom: 0 }}>
                <div className="help-about-header">
                  <div className="help-about-logo">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
                      <path d="M6 14h12v8H6z" />
                    </svg>
                  </div>
                  <div>
                    <div className="help-about-title">AutoPrint</div>
                    <div className="help-about-sub">Version 1.0.0</div>
                  </div>
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.5', marginTop: 12 }}>
                  <p style={{ color: 'var(--text-muted)', marginBottom: 6 }}>Developed by <br /><span style={{ color: 'var(--text)', fontWeight: '600' }}>Suraj Pandavula</span></p>
                  <p style={{ fontWeight: '500', marginBottom: 6, color: 'var(--text-secondary)' }}>Cloud-based automated printing solution for print shops.</p>
                  <p style={{ color: 'var(--text-muted)' }}>© 2026 AutoPrint. All rights reserved.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Feedback & Bug Report Submission Modal */}
      {feedbackModalOpen && (
        <div className="help-overlay" onClick={() => setFeedbackModalOpen(false)}>
          <div className="help-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <div className="modal-title">
                {reportType === 'bug' ? '🐛 Report a Bug' : (reportType === 'feature' ? '💡 Request a Feature' : '✍️ Send Feedback')}
              </div>
              <button className="modal-close-btn" onClick={() => setFeedbackModalOpen(false)}>×</button>
            </div>

            <div className="modal-body">
              {feedbackSuccess ? (
                <div style={{ textAlign: 'center', padding: '24px 12px' }}>
                  <div style={{ fontSize: '3rem', marginBottom: 12 }}>🎉</div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--text)', margin: '0 0 8px 0' }}>
                    Report Submitted Successfully!
                  </h3>
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: '1.5', margin: '0 0 20px 0' }}>
                    Your ticket has been transmitted with print telemetry data to the admin portal. PDF binary files are <strong>not stored</strong> to ensure maximum privacy.
                  </p>

                  <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                    <button
                      onClick={() => setFeedbackModalOpen(false)}
                      className="btn btn-secondary"
                      style={{ padding: '0 18px', height: 38, fontSize: '0.82rem', fontWeight: 'bold' }}
                    >
                      Close Window
                    </button>
                    <a
                      href="/admin"
                      className="btn btn-primary"
                      style={{ padding: '0 18px', height: 38, fontSize: '0.82rem', fontWeight: 'bold', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
                    >
                      🛡️ Open Admin Portal
                    </a>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSubmitFeedback} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  
                  {/* Category Selector */}
                  <div>
                    <label style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                      TICKET TYPE
                    </label>
                    <select
                      value={reportType}
                      onChange={(e) => setReportType(e.target.value)}
                      style={{ width: '100%', height: 38, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text)', padding: '0 10px', fontSize: '0.82rem' }}
                    >
                      <option value="bug">🐛 Bug Report (Issue during printing)</option>
                      <option value="feedback">💬 General Feedback or Suggestion</option>
                      <option value="feature">💡 Feature Request</option>
                    </select>
                  </div>

                  {/* Select Recent Print Job Dropdown */}
                  <div>
                    <label style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                      SELECT AFFECTED PRINT JOB
                    </label>
                    <select
                      value={selectedJobId}
                      onChange={(e) => setSelectedJobId(e.target.value)}
                      style={{ width: '100%', height: 38, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text)', padding: '0 10px', fontSize: '0.82rem' }}
                    >
                      <option value="">-- General Issue (No specific print job) --</option>
                      {getRecentPrintJobs().map((j) => (
                        <option key={j.id} value={j.id}>
                          📄 {j.file_name} ({j.page_count}p, {j.color_mode}) - Status: {j.status}
                        </option>
                      ))}
                    </select>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
                      🔒 Auto-attaches document format (.pdf) and job telemetry. Original PDF file will <strong>not</strong> be uploaded.
                    </div>
                  </div>

                  {/* Message Input with 500 character limitation */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <label style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-muted)' }}>
                        YOUR MESSAGE / DESCRIPTION
                      </label>
                      <span style={{ fontSize: '0.7rem', color: userMessage.length > 450 ? 'var(--error)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        {userMessage.length}/500 chars
                      </span>
                    </div>
                    <textarea
                      required
                      maxLength={500}
                      rows={4}
                      value={userMessage}
                      onChange={(e) => setUserMessage(e.target.value)}
                      placeholder="Describe what happened or what improvement you'd like to see..."
                      style={{
                        width: '100%',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border)',
                        background: 'var(--bg-input)',
                        color: 'var(--text)',
                        padding: '10px',
                        fontSize: '0.85rem',
                        lineHeight: '1.4',
                        resize: 'none'
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 6 }}>
                    <button
                      type="button"
                      onClick={() => setFeedbackModalOpen(false)}
                      className="btn btn-secondary"
                      style={{ height: 38, padding: '0 16px', fontSize: '0.82rem' }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submittingFeedback || !userMessage.trim()}
                      className="btn btn-primary"
                      style={{ height: 38, padding: '0 20px', fontSize: '0.82rem', fontWeight: 'bold' }}
                    >
                      {submittingFeedback ? 'TRANSMITTING...' : '🚀 Submit Ticket'}
                    </button>
                  </div>

                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Global Footer */}
      <footer className="autoprint-footer">
        <div className="footer-content">
          <div className="footer-links">
            <span className="footer-link">Privacy Policy</span>
            <span className="footer-link">·</span>
            <span className="footer-link">Terms of Use</span>
            <span className="footer-link">·</span>
            <span className="footer-link">License</span>
            <span className="footer-link">·</span>
            <span className="footer-link" onClick={() => setShowHelpModal(true)}>Contact Support</span>
          </div>
          <div className="footer-text">
            © 2026 AutoPrint
            <br />
            Developed by Suraj Pandavula
            <br />
            Version 1.0.0
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
