import { Router } from 'express';
import { getJob, setRazorpayOrderId, updateJobPayment, updateJobStatus } from '../database.js';
import { createOrder, verifyPayment, getPublicKey } from '../services/payment.js';

const router = Router();

// ──────────────────────────────────────────────
// GET /api/payments/config — Razorpay public key
// ──────────────────────────────────────────────
router.get('/config', (req, res) => {
  res.json({ keyId: getPublicKey() });
});

// ──────────────────────────────────────────────
// POST /api/payments/create-order — Create Razorpay order
// ──────────────────────────────────────────────
router.post('/create-order', async (req, res) => {
  try {
    const { jobId } = req.body;
    if (!jobId) return res.status(400).json({ error: 'jobId is required' });

    const job = getJob(jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'created') {
      return res.status(400).json({ error: `Job is already ${job.status}` });
    }

    const order = await createOrder(job.total_price, jobId);

    // Save the Razorpay order ID to the job
    setRazorpayOrderId(jobId, order.id);

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency || 'INR',
      keyId: getPublicKey(),
      jobId,
      demo: order.demo || false,
    });
  } catch (error) {
    console.error('[PAYMENT] Create order error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ──────────────────────────────────────────────
// POST /api/payments/verify — Verify payment & enqueue
// ──────────────────────────────────────────────
router.post('/verify', (req, res) => {
  try {
    const { jobId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!jobId) return res.status(400).json({ error: 'jobId is required' });

    const job = getJob(jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    // Verify signature
    const isValid = verifyPayment(
      razorpay_order_id || 'demo',
      razorpay_payment_id || 'demo',
      razorpay_signature || 'demo'
    );

    if (!isValid) {
      updateJobStatus(jobId, 'failed', 'Payment verification failed');
      return res.status(400).json({ error: 'Payment verification failed' });
    }

    // Update job with payment info and set status to "paid"
    const updatedJob = updateJobPayment(
      jobId,
      razorpay_order_id || 'demo_order',
      razorpay_payment_id || `demo_pay_${Date.now()}`,
      razorpay_signature || 'demo_sig'
    );

    console.log(`[PAYMENT] ✅ Payment verified for job ${jobId} — queued for printing`);

    res.json({
      verified: true,
      job: updatedJob,
    });
  } catch (error) {
    console.error('[PAYMENT] Verify error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
