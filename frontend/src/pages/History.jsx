import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getJobs } from '../services/api';
import { FileIcon } from '../components/Icons';

const statusLabels = { created: 'Unpaid', paid: 'Queued', printing: 'Printing', completed: 'Done', failed: 'Failed' };
const fmt = (p) => `₹${(p / 100).toFixed(2)}`;

function fmtDate(d) {
  const dt = new Date(d + 'Z');
  const now = new Date();
  const isToday = dt.toDateString() === now.toDateString();
  const time = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `Today, ${time}`;
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export default function History() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getJobs(50).then(d => setJobs(d.jobs || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <main className="page"><div className="spinner" /><p className="load-text">Loading history...</p></main>;

  return (
    <main className="page">
      <h1 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: 20 }}>Print History</h1>

      {jobs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📭</div>
          <h3>No prints yet</h3>
          <p>Upload a PDF to get started!</p>
        </div>
      ) : (
        jobs.map(job => (
          <div
            key={job.id}
            className="history-card"
            onClick={() => navigate(job.status === 'created' ? `/print/${job.id}` : `/status/${job.id}`)}
          >
            <div className="history-icon"><FileIcon size={20} /></div>
            <div className="history-info">
              <div className="history-name">{job.file_name}</div>
              <div className="history-meta">
                {job.page_count} pg • {job.copies} cop{job.copies > 1 ? 'ies' : 'y'}
                {job.color_mode === 'color' ? ' (Color)' : ''}
                {' • '}{fmtDate(job.created_at)}
              </div>
            </div>
            <div className="history-right">
              <div className="history-price">{fmt(job.total_price)}</div>
              <span className={`badge badge-${job.status}`}>{statusLabels[job.status]}</span>
            </div>
          </div>
        ))
      )}
    </main>
  );
}
