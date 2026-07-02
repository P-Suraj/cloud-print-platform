import Razorpay from 'razorpay';
import crypto from 'crypto';
import config from '../config.js';

let razorpayInstance = null;

function getRazorpay() {
  if (!razorpayInstance) {
    const keyId = config.razorpay.keyId || '';
    const keySecret = config.razorpay.keySecret || '';
    // Detect placeholder/invalid keys
    if (!keyId || !keySecret || keyId.includes('xxx') || keySecret.includes('your_') || keySecret.length < 10) {
      console.warn('[PAYMENT] Razorpay keys not configured — using demo mode');
      return null;
    }
    razorpayInstance = new Razorpay({
      key_id: config.razorpay.keyId,
      key_secret: config.razorpay.keySecret,
    });
  }
  return razorpayInstance;
}

/**
 * Create a Razorpay order.
 * @param {number} amount - Amount in paise (e.g., 2000 = ₹20.00)
 * @param {string} jobId - Print job ID for reference
 * @returns {Promise<object>} Razorpay order object
 */
export async function createOrder(amount, jobId) {
  const rzp = getRazorpay();

  // Demo mode — return a fake order when Razorpay isn't configured
  if (!rzp) {
    console.log(`[PAYMENT] Demo mode — creating fake order for ₹${(amount / 100).toFixed(2)}`);
    return {
      id: `order_demo_${Date.now()}`,
      amount,
      currency: 'INR',
      receipt: jobId,
      status: 'created',
      demo: true,
    };
  }

  const order = await rzp.orders.create({
    amount,
    currency: 'INR',
    receipt: jobId,
    notes: { jobId },
  });

  return order;
}

/**
 * Verify Razorpay payment signature.
 * @param {string} orderId
 * @param {string} paymentId
 * @param {string} signature
 * @returns {boolean}
 */
export function verifyPayment(orderId, paymentId, signature) {
  // Demo mode — always verify
  const secret = config.razorpay.keySecret || '';
  if (!secret || secret.includes('your_') || secret.length < 10 || orderId.startsWith('order_demo_')) {
    console.log('[PAYMENT] Demo mode — auto-verifying payment');
    return true;
  }

  const body = orderId + '|' + paymentId;
  const expectedSignature = crypto
    .createHmac('sha256', config.razorpay.keySecret)
    .update(body)
    .digest('hex');

  return expectedSignature === signature;
}

/**
 * Get Razorpay public key for frontend checkout.
 */
export function getPublicKey() {
  return config.razorpay.keyId || 'rzp_demo_not_configured';
}
