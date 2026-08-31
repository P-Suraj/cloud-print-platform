/**
 * AutoPrint v3 API Client Transport (Browser)
 * Communicates exclusively with FastAPI backend sending X-AutoPrint-Contract-Version: 3
 */

// Production requests go through this frontend's Vercel rewrite. That keeps
// the HttpOnly shop/customer session first-party instead of relying on a
// cross-site API cookie that mobile browsers can block.
const VITE_ENV = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};
const API_BASE = VITE_ENV.PROD
  ? ''
  : (VITE_ENV.VITE_API_BASE_URL || '').replace(/\/$/, '');


async function fetchV3(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-AutoPrint-Contract-Version': '3',
    ...(options.headers || {})
  };

  let response;
  try {
    response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
      credentials: options.credentials || 'include'
    });
  } catch {
    throw new Error('The AutoPrint service is temporarily unavailable. Please ask the counter staff to start the print service, then try again.');
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || data.detail || `HTTP Error ${response.status}`);
  }

  return data;
}

export const v3Api = {
  healthLive: () => fetchV3('/health/live', { method: 'GET' }),
  findNearbyShops: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return fetchV3(`/api/v3/discovery/shops/nearby?${query}`, { method: 'GET' });
  },
  searchDiscoverableShops: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return fetchV3(`/api/v3/discovery/shops/search?${query}`, { method: 'GET' });
  },
  getPublicShop: (shopCode) => fetchV3(`/api/v3/shops/${encodeURIComponent(shopCode)}`, { method: 'GET' }),
  getPublicShopRates: (shopCode) => fetchV3(`/api/v3/shops/${encodeURIComponent(shopCode)}/rates`, { method: 'GET' }),
  createOrder: (shopCode, submissionChannel = 'qr', fulfillmentMode = 'counter', customerCsrf = '', customerJobName = '') => fetchV3(`/api/v3/shops/${encodeURIComponent(shopCode)}/orders`, {
    method: 'POST',
    headers: customerCsrf ? { 'X-AutoPrint-Customer-CSRF': customerCsrf } : {},
    body: JSON.stringify({ submission_channel: submissionChannel, fulfillment_mode: fulfillmentMode, customer_job_name: customerJobName || null }),
  }),
  requestCustomerCode: (email) => fetchV3('/api/v3/customer-auth/request-code', { method: 'POST', body: JSON.stringify({ email }) }),
  verifyCustomerCode: (email, code) => fetchV3('/api/v3/customer-auth/verify-code', { method: 'POST', body: JSON.stringify({ email, code }) }),
  createGuestCustomerSession: () => fetchV3('/api/v3/customer-auth/guest-session', { method: 'POST' }),
  getCustomerSession: () => fetchV3('/api/v3/customer-auth/session', { method: 'GET' }),
  refreshCustomerCsrf: () => fetchV3('/api/v3/customer-auth/csrf', { method: 'POST' }),
  getUploadIntent: (orderId, capabilityToken, fileMeta) => fetchV3(`/api/v3/orders/${orderId}/upload-intent`, {
    method: 'POST',
    headers: { 'X-AutoPrint-Capability': capabilityToken },
    body: JSON.stringify(fileMeta)
  }),
  finalizeUpload: (orderId, capabilityToken, payload) => fetchV3(`/api/v3/orders/${orderId}/finalize-upload`, {
    method: 'POST',
    headers: { 'X-AutoPrint-Capability': capabilityToken },
    body: JSON.stringify(payload)
  }),
  createQuote: (orderId, capabilityToken, options) => fetchV3(`/api/v3/orders/${orderId}/quotes`, {
    method: 'POST',
    headers: { 'X-AutoPrint-Capability': capabilityToken },
    body: JSON.stringify({ options })
  }),
  createBatchQuote: (orderId, capabilityToken, items) => fetchV3(`/api/v3/orders/${orderId}/quotes`, {
    method: 'POST',
    headers: { 'X-AutoPrint-Capability': capabilityToken },
    body: JSON.stringify({ items })
  }),
  acceptQuote: (quoteId, capabilityToken, idempotencyKey) => fetchV3(`/api/v3/quotes/${quoteId}/accept`, {
    method: 'POST',
    headers: {
      'X-AutoPrint-Capability': capabilityToken,
      'Idempotency-Key': idempotencyKey,
    }
  }),
  getOrderStatus: (orderId, capabilityToken) => fetchV3(`/api/v3/orders/${orderId}/status`, {
    method: 'GET',
    headers: { 'X-AutoPrint-Capability': capabilityToken }
  }),
  getOrderDetails: (orderId, capabilityToken) => fetchV3(`/api/v3/orders/${orderId}`, {
    method: 'GET',
    headers: { 'X-AutoPrint-Capability': capabilityToken }
  }),
  checkInOrder: (orderId, capabilityToken, customerCsrf) => fetchV3(`/api/v3/orders/${orderId}/check-in`, {
    method: 'POST',
    headers: { 'X-AutoPrint-Capability': capabilityToken, 'X-AutoPrint-Customer-CSRF': customerCsrf },
  }),
  cancelOrder: (orderId, capabilityToken, idempotencyKey, customerCsrf = '') => fetchV3(`/api/v3/orders/${orderId}/cancel`, {
    method: 'POST',
    headers: { 'X-AutoPrint-Capability': capabilityToken, 'Idempotency-Key': idempotencyKey, ...(customerCsrf ? { 'X-AutoPrint-Customer-CSRF': customerCsrf } : {}) },
  }),
  getShopJob: (jobId) => fetchV3(`/api/v3/shop/jobs/${jobId}`, { method: 'GET' }),
  updateShopPrintOptions: (jobId, csrfToken, payload) => fetchV3(`/api/v3/shop/jobs/${jobId}/print-options`, {
    method: 'PUT', headers: { 'X-AutoPrint-CSRF': csrfToken }, body: JSON.stringify(payload),
  }),
  resolveShopJob: (jobId, csrfToken, payload) => fetchV3(`/api/v3/shop/jobs/${jobId}/resolve`, {
    method: 'POST',
    headers: { 'X-AutoPrint-CSRF': csrfToken },
    body: JSON.stringify(payload),
  }),
  getPickupStatus: (orderId, capabilityToken) => fetchV3(`/api/v3/orders/${orderId}/pickup`, {
    method: 'GET',
    headers: { 'X-AutoPrint-Capability': capabilityToken }
  }),
  getPickupCode: (orderId, capabilityToken) => fetchV3(`/api/v3/orders/${orderId}/pickup-code`, {
    method: 'GET',
    headers: { 'X-AutoPrint-Capability': capabilityToken }
  }),
  listShopPickups: (status = '', limit = 50) => {
    const q = status ? `?status=${encodeURIComponent(status)}&limit=${limit}` : `?limit=${limit}`;
    return fetchV3(`/api/v3/shop/pickups${q}`, { method: 'GET' });
  },
  getShopPickupDetail: (pickupId) => fetchV3(`/api/v3/shop/pickups/${pickupId}`, { method: 'GET' }),
  collectPickupWithCode: (pickupId, csrfToken, payload) => fetchV3(`/api/v3/shop/pickups/${pickupId}/collect`, {
    method: 'POST',
    headers: { 'X-AutoPrint-CSRF': csrfToken },
    body: JSON.stringify(payload)
  }),
  manualCollectPickup: (pickupId, csrfToken, idempotencyKey, payload) => fetchV3(`/api/v3/shop/pickups/${pickupId}/manual-collect`, {
    method: 'POST',
    headers: { 'X-AutoPrint-CSRF': csrfToken, 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(payload)
  }),
  recordPickupNoShow: (pickupId, csrfToken, payload) => fetchV3(`/api/v3/shop/pickups/${pickupId}/no-show`, {
    method: 'POST',
    headers: { 'X-AutoPrint-CSRF': csrfToken },
    body: JSON.stringify(payload)
  }),
  restoreCustomerTrust: (customerId, csrfToken, payload) => fetchV3(`/api/v3/shop/trust/${customerId}/restore`, {
    method: 'POST',
    headers: { 'X-AutoPrint-CSRF': csrfToken },
    body: JSON.stringify(payload)
  }),
  getShopPickupPolicy: () => fetchV3('/api/v3/shop/pickup-policy', { method: 'GET' }),
  updateShopPickupPolicy: (csrfToken, payload) => fetchV3('/api/v3/shop/pickup-policy', {
    method: 'PUT',
    headers: { 'X-AutoPrint-CSRF': csrfToken },
    body: JSON.stringify(payload)
  }),
  getShopQueueSettings: () => fetchV3('/api/v3/shop/queue-settings', { method: 'GET' }),
  updateShopPrinterLane: (csrfToken, payload) => fetchV3('/api/v3/shop/printer-lanes', {
    method: 'PUT',
    headers: { 'X-AutoPrint-CSRF': csrfToken },
    body: JSON.stringify(payload),
  }),
  updateShopWalkinBacklog: (csrfToken, payload) => fetchV3('/api/v3/shop/walkin-backlog', {
    method: 'PUT',
    headers: { 'X-AutoPrint-CSRF': csrfToken },
    body: JSON.stringify(payload),
  }),
};
