import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { ArrowLeftIcon, PrinterIcon, CheckCircleIcon, HomeIcon, InfoIcon } from '../components/Icons';

const STEPS = [
  { key: 'queued', label: 'File Queued', active: 'Waiting for shopkeeper approval...' },
  { key: 'approved', label: 'Approved', active: 'Waiting for agent to print...' },
  { key: 'processing', label: 'Printing', active: 'Printing document...' },
  { key: 'completed', label: 'Ready for Pickup', active: 'Completed' },
];
const ORDER = ['queued', 'approved', 'processing', 'completed'];

export default function Status() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState(jobId);
  const [loading, setLoading] = useState(true);

  const params = new URLSearchParams(window.location.search);
  const jobsQuery = params.get('jobs');
  const jobIds = jobsQuery ? jobsQuery.split(',') : [jobId];

  // Poll jobs status from Supabase every 2 seconds
  useEffect(() => {
    let intervalId;

    async function fetchJobs() {
      try {
        const { data, error } = await supabase
          .from('print_jobs')
          .select('*')
          .in('id', jobIds);

        if (!error && data) {
          const sortedJobs = [...data].sort((a, b) => jobIds.indexOf(a.id) - jobIds.indexOf(b.id));
          setJobs(sortedJobs);

          if (!selectedJobId && sortedJobs.length > 0) {
            setSelectedJobId(sortedJobs[0].id);
          }

          // Stop polling once all jobs are in a terminal state
          if (sortedJobs.length > 0 && sortedJobs.every(j => ['completed', 'failed', 'rejected'].includes(j.status))) {
            clearInterval(intervalId);
          }
        }
      } catch (err) {
        console.error('Error fetching job status:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchJobs();
    intervalId = setInterval(fetchJobs, 2000);

    return () => clearInterval(intervalId);
  }, [jobId]);

  if (loading) {
    return (
      <main className="page">
        <div className="spinner lg" />
        <p className="load-text">Loading print job status...</p>
      </main>
    );
  }

  // Active job is the one the user selected to inspect details for
  const activeJob = jobs.find(j => j.id === selectedJobId) || jobs[0];

  if (!activeJob) {
    return (
      <main className="page" style={{ justifyContent: 'center', alignItems: 'center', padding: 20 }}>
        <div className="status-icon-circle" style={{ borderColor: 'var(--error)', background: 'var(--error-dim)' }}>
          <span style={{ fontSize: '2rem', color: 'var(--error)' }}>✗</span>
        </div>
        <p style={{ color: 'var(--error)', fontWeight: '600', marginTop: 16 }}>
          Job not found.
        </p>
        <button className="btn btn-secondary" style={{ marginTop: 24 }} onClick={() => navigate('/')}>
          <HomeIcon size={16} /> Back to Home
        </button>
      </main>
    );
  }

  const idx = ORDER.indexOf(activeJob.status);
  const isComplete = activeJob.status === 'completed';
  const isFailed = activeJob.status === 'failed';
  const isRejected = activeJob.status === 'rejected';

  // Overall batch state
  const completedJobsCount = jobs.filter(j => j.status === 'completed').length;
  const failedJobsCount = jobs.filter(j => j.status === 'failed').length;
  const rejectedJobsCount = jobs.filter(j => j.status === 'rejected').length;
  const totalJobsCount = jobs.length;

  return (
    <main className="page">
      {/* Top Bar */}
      <div className="page-topbar" style={{ marginBottom: 20 }}>
        <button className="back-btn" onClick={() => navigate(-1)}>
          <ArrowLeftIcon size={16} /> Back
        </button>
      </div>

      {/* Hero */}
      <div className="status-hero" style={{ padding: '24px 0', textAlign: 'center' }}>
        {totalJobsCount > 1 ? (
          <>
            <div className="status-icon-circle">
              <PrinterIcon size={28} color="var(--primary-light)" />
            </div>
            <h1 style={{ fontSize: '1.4rem', marginTop: 12 }}>
              Batch Progress: {completedJobsCount}/{totalJobsCount} Complete
            </h1>
            {failedJobsCount > 0 && (
              <p style={{ fontSize: '0.82rem', color: 'var(--error)', marginTop: 4 }}>
                ⚠️ {failedJobsCount} file{failedJobsCount > 1 ? 's' : ''} failed to print.
              </p>
            )}
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 4 }}>
              Click on any file below to see its details and printer status.
            </p>
          </>
        ) : isComplete ? (
          <>
            <div className="success-check"><CheckCircleIcon size={36} color="var(--primary-light)" /></div>
            <h1 className="completed-text" style={{ fontSize: '1.5rem', marginTop: 12 }}>Print Complete!</h1>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Pick up your printout from the printer tray.</p>
          </>
        ) : isFailed ? (
          <>
            <div className="status-icon-circle" style={{ borderColor: 'var(--error)', background: 'var(--error-dim)' }}>
              <span style={{ fontSize: '2rem', color: 'var(--error)' }}>✗</span>
            </div>
            <h1 style={{ color: 'var(--error)', background: 'none', WebkitTextFillColor: 'var(--error)', fontSize: '1.5rem', marginTop: 12 }}>
              Print Failed
            </h1>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', padding: '0 12px' }}>
              {activeJob.error || 'A spooler error occurred. Please ask the shopkeeper to check the printer.'}
            </p>
          </>
        ) : isRejected ? (
          <>
            <div className="status-icon-circle" style={{ borderColor: 'var(--error)', background: 'var(--error-dim)' }}>
              <span style={{ fontSize: '2rem', color: 'var(--error)' }}>✗</span>
            </div>
            <h1 style={{ color: 'var(--error)', background: 'none', WebkitTextFillColor: 'var(--error)', fontSize: '1.5rem', marginTop: 12 }}>
              Print Rejected
            </h1>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', padding: '0 12px' }}>
              The shopkeeper rejected this print request. Please check with them.
            </p>
          </>
        ) : (
          <>
            <div className="status-icon-circle"><PrinterIcon size={28} color="var(--primary-light)" /></div>
            <h1 style={{ fontSize: '1.5rem', marginTop: 12 }}>
              {activeJob.status === 'queued' ? 'In Queue...' : activeJob.status === 'approved' ? 'Approved' : 'Printing...'}
            </h1>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', wordBreak: 'break-all', padding: '0 24px' }}>
              {activeJob.file_name}
            </p>
          </>
        )}
      </div>

      {/* Batch Files List */}
      {totalJobsCount > 1 && (
        <div className="details-card" style={{ marginBottom: 20, padding: '12px 14px' }}>
          <h3 style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Files in this print batch
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {jobs.map((j, index) => {
              const isSel = j.id === activeJob.id;
              return (
                <div
                  key={j.id}
                  onClick={() => setSelectedJobId(j.id)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: isSel ? 'var(--primary-dim)' : 'rgba(255,255,255,0.02)',
                    border: isSel ? '1px solid var(--primary-light)' : '1px solid var(--border)',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    boxSizing: 'border-box',
                    width: '100%'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>📄</span>
                    <span style={{ fontSize: '0.82rem', fontWeight: '600', color: isSel ? 'var(--text)' : 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {index + 1}. {j.file_name}
                    </span>
                  </div>
                  <span className={`badge badge-${j.status}`} style={{ fontSize: '0.65rem', padding: '3px 8px', textTransform: 'capitalize', flexShrink: 0, marginLeft: 8 }}>
                    {statusLabels[j.status] || j.status}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Timeline */}
      {!isRejected && (
        <div className="timeline-card" style={{ marginBottom: 20 }}>
          {totalJobsCount > 1 && (
            <div style={{ fontSize: '0.78rem', fontWeight: '700', color: 'var(--text-muted)', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 8, marginBottom: 12 }}>
              Status for: <span style={{ color: 'var(--text)' }}>{activeJob.file_name}</span>
            </div>
          )}
          <div className="timeline">
            {STEPS.map((step, i) => {
              let state = 'pending';
              if (isFailed && i >= idx) {
                state = i === idx ? 'active' : 'pending';
              } else if (i < idx || isComplete) {
                state = 'done';
              } else if (i === idx) {
                state = 'active';
              }

              return (
                <div key={step.key} className={`timeline-step ${state}`}>
                  <div className="timeline-dot">
                    {state === 'done' ? '✓' : state === 'active' ? (isComplete ? '✓' : '●') : ''}
                  </div>
                  <div className="timeline-info">
                    <h4 style={{ margin: 0, fontSize: '0.95rem' }}>{step.label}</h4>
                    {state === 'active' && !isComplete && (
                      <p style={{ color: 'var(--primary-light)', margin: '2px 0 0 0', fontSize: '0.8rem' }}>
                        {step.active}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Job Details */}
      <div className="details-card" style={{ marginBottom: 24 }}>
        <div className="details-title" style={{ fontSize: '0.9rem', display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12 }}>
          <InfoIcon size={16} color="var(--text-muted)" />
          {totalJobsCount > 1 ? 'Selected File Info' : 'Job Information'}
        </div>
        <div className="details-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="detail-item" style={{ display: 'flex', flexDirection: 'column', gridColumn: 'span 2' }}>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>File Name</label>
            <span style={{ fontSize: '0.85rem', fontWeight: '500', wordBreak: 'break-all' }}>{activeJob.file_name}</span>
          </div>
          <div className="detail-item" style={{ display: 'flex', flexDirection: 'column' }}>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Pages</label>
            <span style={{ fontSize: '0.85rem', fontWeight: '500' }}>{activeJob.page_count === null || activeJob.page_count === undefined ? 'Unknown' : activeJob.page_count}</span>
          </div>
          <div className="detail-item" style={{ display: 'flex', flexDirection: 'column' }}>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Copies</label>
            <span style={{ fontSize: '0.85rem', fontWeight: '500' }}>{activeJob.copies}</span>
          </div>
          <div className="detail-item" style={{ display: 'flex', flexDirection: 'column' }}>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Color Mode</label>
            <span style={{ fontSize: '0.85rem', fontWeight: '500', textTransform: 'uppercase' }}>{activeJob.color_mode}</span>
          </div>
          <div className="detail-item" style={{ display: 'flex', flexDirection: 'column' }}>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Duplex Mode</label>
            <span style={{ fontSize: '0.85rem', fontWeight: '500' }}>{activeJob.duplex ? 'Double Sided' : 'Single Sided'}</span>
          </div>
        </div>
      </div>

      {/* Back Button */}
      <div style={{ textAlign: 'center' }}>
        <button className="btn btn-secondary" style={{ width: '100%', height: 44 }} onClick={() => navigate('/')}>
          <HomeIcon size={16} /> Back to Home
        </button>
      </div>
    </main>
  );
}
