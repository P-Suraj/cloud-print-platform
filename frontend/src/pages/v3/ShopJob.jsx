import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import './shopConsole.css';
import { v3Api } from '../../services/v3Api';

export default function ShopJob() {
  const { jobId } = useParams();
  const navigate = useNavigate();

  const [jobDetail, setJobDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resolveOutcome, setResolveOutcome] = useState('completed');
  const [resolveReason, setResolveReason] = useState('');

  const csrfToken = sessionStorage.getItem('v3_csrf');

  useEffect(() => {
    const fetchDetail = async () => {
      try {
        const data = await v3Api.getShopJob(jobId);
        setJobDetail(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchDetail();
  }, [jobId]);

  const handleResolveUncertain = async (e) => {
    e.preventDefault();
    if (!resolveReason.trim()) {
      alert('Please enter a resolution reason');
      return;
    }

    try {
      await v3Api.resolveShopJob(jobId, csrfToken || '', {
        outcome_status: resolveOutcome,
        reason: resolveReason,
      });
      alert('Uncertain outcome resolved successfully!');
      navigate('/v3/console/queue');
    } catch (err) {
      alert(`Resolution error: ${err.message}`);
    }
  };

  if (loading) return <div className="v3-shop-container"><p>Loading job details...</p></div>;
  if (error) return <div className="v3-shop-container"><div style={{ padding: 12, background: '#fee2e2', color: '#991b1b' }}>{error}</div></div>;

  const job = jobDetail?.job;

  return (
    <div className="v3-shop-container">
      <button className="v3-btn-action" onClick={() => navigate('/v3/console/queue')} style={{ marginBottom: 16 }}>← Back to Queue</button>
      <h2>Job Detail: {jobId}</h2>

      {job && (
        <div style={{ background: '#fff', padding: 20, borderRadius: 12, border: '1px solid #e5e7eb', marginBottom: 20 }}>
          <p><strong>Status:</strong> {job.status}</p>
          <p><strong>Approved At:</strong> {job.approved_at || 'Not approved'}</p>
          <p><strong>Completion Source:</strong> {job.completion_source || 'N/A'}</p>

          {jobDetail?.preview_url && (
            <div style={{ marginTop: 16 }}>
              <h4>Authorized PDF Preview Grant</h4>
              <iframe src={jobDetail.preview_url} title="PDF Preview" style={{ width: '100%', height: 400, border: '1px solid #d1d5db', borderRadius: 8 }} />
            </div>
          )}
        </div>
      )}

      {job?.status === 'needs_attention' && (
        <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', padding: 20, borderRadius: 12 }}>
          <h3 style={{ color: '#92400e', marginTop: 0 }}>⚠️ Manual Outcome Verification Required</h3>
          <p>This job encountered spooler ambiguity or an agent restart mid-print. Please physically verify paper output at the printer before resolving.</p>

          <form onSubmit={handleResolveUncertain}>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Physical Output Verified As:</label>
              <select value={resolveOutcome} onChange={e => setResolveOutcome(e.target.value)} style={{ padding: 8, width: '100%' }}>
                <option value="completed">Confirmed Printed (Paper output verified at tray)</option>
                <option value="failed">Confirmed Not Printed (Paper failed / jam / tray empty)</option>
              </select>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Resolution Reason Code / Notes:</label>
              <input type="text" value={resolveReason} onChange={e => setResolveReason(e.target.value)} required placeholder="e.g. Verified 5 pages printed cleanly" style={{ padding: 8, width: '100%' }} />
            </div>

            <button type="submit" className="v3-btn-action v3-btn-resolve">Submit Resolution</button>
          </form>
        </div>
      )}
    </div>
  );
}
