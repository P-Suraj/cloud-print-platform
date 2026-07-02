import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getJob, updateJobOptions, createPaymentOrder, verifyPayment } from '../services/api';
import { ArrowLeftIcon, PrinterIcon, FileIcon } from '../components/Icons';

const fmt = (p) => `₹${(p / 100).toFixed(2)}`;
const fmtSize = (b) => b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`;

export default function Print() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState(null);
  const [copies, setCopies] = useState(1);
  const [isDuplex, setIsDuplex] = useState(false);
  const [colorMode, setColorMode] = useState('bw');
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');

  const PBW = 200; const PCLR = 500; const DISC = 10;

  function calc() {
    if (!job) return { total: 0, sub: 0, disc: 0, pages: 0, pp: 0 };
    const pp = colorMode === 'color' ? PCLR : PBW;
    const pages = job.page_count * copies;
    const sub = pages * pp;
    const disc = isDuplex ? Math.floor(sub * DISC / 100) : 0;
    return { total: sub - disc, sub, disc, pages, pp };
  }

  useEffect(() => {
    getJob(jobId).then(d => {
      setJob(d.job);
      setCopies(d.job.copies || 1);
      setIsDuplex(d.job.is_duplex === 1);
      setColorMode(d.job.color_mode || 'bw');
      if (d.job.status !== 'created') navigate(`/status/${jobId}`);
    }).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [jobId]);

  async function handlePay() {
    setPaying(true); setError('');
    try {
      await updateJobOptions(jobId, { copies, isDuplex, colorMode });
      const order = await createPaymentOrder(jobId);

      if (order.demo || order.keyId === 'rzp_demo_not_configured') {
        await verifyPayment({ jobId, razorpay_order_id: order.orderId, razorpay_payment_id: `demo_${Date.now()}`, razorpay_signature: 'demo' });
        navigate(`/status/${jobId}`); return;
      }

      const opts = {
        key: order.keyId, amount: order.amount, currency: order.currency,
        name: 'AutoPrint', description: `Print ${job.file_name}`, order_id: order.orderId,
        handler: async (res) => {
          try {
            await verifyPayment({ jobId, razorpay_order_id: res.razorpay_order_id, razorpay_payment_id: res.razorpay_payment_id, razorpay_signature: res.razorpay_signature });
            navigate(`/status/${jobId}`);
          } catch (e) { setError(e.message); setPaying(false); }
        },
        theme: { color: '#7c5cfc' },
      };

      if (window.Razorpay) {
        const rzp = new window.Razorpay(opts);
        rzp.open();
        rzp.on('payment.failed', () => { setError('Payment failed'); setPaying(false); });
      } else {
        await verifyPayment({ jobId, razorpay_order_id: order.orderId, razorpay_payment_id: `fb_${Date.now()}`, razorpay_signature: 'fb' });
        navigate(`/status/${jobId}`);
      }
    } catch (e) { setError(e.message); setPaying(false); }
  }

  if (loading) return <main className="page"><div className="spinner" /><p className="load-text">Loading...</p></main>;
  if (!job) return <main className="page"><p style={{ color: 'var(--error)' }}>Job not found</p></main>;

  const price = calc();

  return (
    <main className="page">
      {/* Top Bar */}
      <div className="page-topbar">
        <button className="back-btn" onClick={() => navigate('/')}><ArrowLeftIcon size={18} /></button>
        <h1>Configure Print</h1>
        <div style={{ width: 24 }} />
      </div>

      {/* File Info */}
      <div className="file-info">
        <div className="file-info-icon"><span className="file-info-icon-label">PDF</span></div>
        <div className="file-info-details">
          <h3>{job.file_name}</h3>
          <p>{job.page_count} pages · {fmtSize(job.file_size)}</p>
        </div>
      </div>

      {/* Print Options */}
      <div className="options-card">
        <div className="option-row">
          <div className="option-label"><h4>Copies</h4></div>
          <div className="stepper">
            <button className="stepper-btn" onClick={() => setCopies(Math.max(1, copies - 1))} disabled={copies <= 1}>−</button>
            <span className="stepper-value">{copies}</span>
            <button className="stepper-btn" onClick={() => setCopies(Math.min(50, copies + 1))}>+</button>
          </div>
        </div>
        <div className="option-row">
          <div className="option-label"><h4>Double-sided</h4><p>Print on both sides</p></div>
          <div className={`toggle ${isDuplex ? 'active' : ''}`} onClick={() => setIsDuplex(!isDuplex)} />
        </div>
        <div className="option-row">
          <div className="option-label"><h4>Color printing</h4><p>Additional charges apply</p></div>
          <div className={`toggle ${colorMode === 'color' ? 'active' : ''}`} onClick={() => setColorMode(colorMode === 'color' ? 'bw' : 'color')} />
        </div>
      </div>

      {/* Summary */}
      <div className="summary-card">
        <div className="summary-title">Summary</div>
        <div className="summary-row">
          <span>Base Print ({job.page_count} pages × {copies} copies)</span>
          <span className="summary-amount">{fmt(price.sub + price.disc)}</span>
        </div>
        {price.disc > 0 && (
          <div className="summary-row discount">
            <span>Student Discount (10%)</span>
            <span className="summary-amount">-{fmt(price.disc)}</span>
          </div>
        )}
        <div className="summary-row total">
          <span>Total</span>
          <span className="summary-amount">{fmt(price.total)}</span>
        </div>
      </div>

      {error && <p style={{ color: 'var(--error)', fontSize: '0.82rem', textAlign: 'center', marginBottom: 12 }}>{error}</p>}

      {/* Pay Button */}
      <button className="btn btn-gradient" onClick={handlePay} disabled={paying}>
        <PrinterIcon size={18} color="white" />
        {paying ? 'Processing...' : `Pay ${fmt(price.total)} & Print`}
      </button>
    </main>
  );
}
