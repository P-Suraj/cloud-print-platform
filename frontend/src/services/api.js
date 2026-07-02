const API_BASE = '/api';

async function request(url, options = {}) {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export async function uploadPdf(file, options = {}) {
  const formData = new FormData();
  formData.append('file', file);
  if (options.copies) formData.append('copies', options.copies);
  if (options.isDuplex !== undefined) formData.append('isDuplex', options.isDuplex);
  if (options.colorMode) formData.append('colorMode', options.colorMode);
  if (options.userName) formData.append('userName', options.userName);

  const res = await fetch(`${API_BASE}/jobs`, { method: 'POST', body: formData });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data;
}

export async function getJob(jobId) {
  return request(`/jobs/${jobId}`);
}

export async function updateJobOptions(jobId, options) {
  return request(`/jobs/${jobId}`, {
    method: 'PATCH',
    body: JSON.stringify(options),
  });
}

export async function getJobs(limit = 20) {
  return request(`/jobs?limit=${limit}`);
}

export async function createPaymentOrder(jobId) {
  return request('/payments/create-order', {
    method: 'POST',
    body: JSON.stringify({ jobId }),
  });
}

export async function verifyPayment(data) {
  return request('/payments/verify', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getQueueStats() {
  return request('/jobs/queue/stats');
}

export async function getPrinterStatus() {
  return request('/jobs/printer/status');
}

export async function getPricingConfig() {
  return request('/jobs/pricing/config');
}
