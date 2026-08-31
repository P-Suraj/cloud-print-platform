import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Ban, FileText, LoaderCircle, MapPinCheck, TriangleAlert } from 'lucide-react';
import { v3Api } from '../../services/v3Api';
import PickupCard from './PickupCard';
import './customerStatus.css';

const STEP_COPY = {
  file_queued: 'Your files are in the shop queue.',
  approved: 'The shop has accepted your print order.',
  printing: 'Your documents are being printed.',
  ready_for_pickup: 'Your prints are ready to collect.',
};

export default function CustomerStatus() {
  const { orderId } = useParams();
  const capabilityToken = sessionStorage.getItem(`v3_cap_${orderId}`);
  const [statusData, setStatusData] = useState(null);
  const [pickupData, setPickupData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');

  const fetchStatus = async () => {
    const result = await v3Api.getOrderStatus(orderId, capabilityToken);
    setStatusData(result);
    if (result.fulfillment_mode === 'remote' && (result.status === 'completed' || result.pickup_id)) {
      try { setPickupData(await v3Api.getPickupStatus(orderId, capabilityToken)); } catch { /* non-fatal */ }
    }
    return result;
  };

  useEffect(() => {
    if (!capabilityToken) { setError('This order link is no longer available on this device.'); setLoading(false); return undefined; }
    let active = true;
    const refresh = async () => { try { await fetchStatus(); if (active) setError(''); } catch (err) { if (active) setError(err.message || 'We could not refresh this order.'); } finally { if (active) setLoading(false); } };
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => { active = false; clearInterval(interval); };
  }, [orderId, capabilityToken]);

  const getCustomerCsrf = async () => {
    const existing = sessionStorage.getItem('v3_customer_csrf');
    if (existing) return existing;
    const result = await v3Api.refreshCustomerCsrf();
    sessionStorage.setItem('v3_customer_csrf', result.csrf_token);
    return result.csrf_token;
  };

  const handleCancel = async () => {
    if (!window.confirm('Cancel this print request? This works only before printing starts.')) return;
    setActionLoading(true); setActionError('');
    try {
      const keyName = `v3_cancel_idem_${orderId}`;
      let key = sessionStorage.getItem(keyName);
      if (!key) { key = crypto.randomUUID(); sessionStorage.setItem(keyName, key); }
      const csrf = statusData?.fulfillment_mode === 'remote' ? await getCustomerCsrf() : '';
      await v3Api.cancelOrder(orderId, capabilityToken, key, csrf); await fetchStatus();
    } catch (err) { setActionError(err.message || 'Cancellation could not be completed.'); }
    finally { setActionLoading(false); }
  };

  const handleCheckIn = async () => {
    setActionLoading(true); setActionError('');
    try { await v3Api.checkInOrder(orderId, capabilityToken, await getCustomerCsrf()); await fetchStatus(); }
    catch (err) { setActionError(err.message || 'Check-in could not be completed.'); }
    finally { setActionLoading(false); }
  };

  if (loading) return <main className="v3-status-page v3-status-message"><LoaderCircle className="v3-spinner" size={22} /><h1>Checking your print order</h1><p>This will only take a moment.</p></main>;
  if (error && !statusData) return <main className="v3-status-page v3-status-message"><TriangleAlert size={22} /><h1>We can’t show this order</h1><p>{error}</p><Link className="v3-status-link" to="/print">Start a new print order</Link></main>;

  const lifecycle = statusData.customer_lifecycle;
  const current = lifecycle?.current || 'file_queued';
  const currentLabel = lifecycle?.steps?.find(step => step.key === current)?.label || 'File Queued';
  const documents = statusData.documents || [];
  const title = statusData.customer_job_name || (documents.length === 1 ? documents[0].name : 'Your prints');
  const isRemote = statusData.fulfillment_mode === 'remote';

  return <main className="v3-status-page">
    <header className="v3-status-header">
      <p className="v3-status-shop">{statusData.shop_name || 'AutoPrint shop'}</p>
      <h1>{title}</h1>
      <div className={`v3-current-status ${statusData.customer_exception ? 'exception' : ''}`}>
        <span>{statusData.customer_exception || currentLabel}</span>
        <p>{statusData.customer_exception ? statusData.customer_wording : STEP_COPY[current]}</p>
      </div>
    </header>

    <div className="v3-status-content">
      {!statusData.customer_exception && <section className="v3-status-section" aria-labelledby="progress-title">
        <h2 id="progress-title">Order progress</h2>
        <ol className="v3-lifecycle">{lifecycle.steps.map(step => <li key={step.key} className={step.state}><span className="v3-step-marker" aria-hidden="true">{step.state === 'completed' ? '✓' : step.state === 'active' ? '●' : ''}</span><div><strong>{step.label}</strong><small>{STEP_COPY[step.key]}</small></div></li>)}</ol>
      </section>}

      {documents.length > 0 && <section className="v3-status-section" aria-labelledby="documents-title">
        <h2 id="documents-title">Documents · {documents.length}</h2>
        <ul className="v3-document-list">{documents.map((document, index) => <li key={`${document.name}-${index}`}><FileText size={17} /><div><strong>{document.name}</strong><small>{[document.page_count ? `${document.page_count} pages` : null, `${document.copies} ${document.copies === 1 ? 'copy' : 'copies'}`, document.color_mode === 'color' ? 'Colour' : 'B&W', document.duplex ? 'Double-sided' : 'Single-sided'].filter(Boolean).join(' · ')}</small></div></li>)}</ul>
      </section>}
    </div>

    {!isRemote && statusData.status === 'completed' && <p className="v3-ready-note">Collect your prints from the counter.</p>}
    {isRemote && statusData.status === 'completed' && pickupData?.status && <PickupCard orderId={orderId} capabilityToken={capabilityToken} pickupData={pickupData} onRefresh={fetchStatus} />}
    {isRemote && statusData.print_eligibility === 'check_in_required' && !statusData.customer_checked_in && statusData.status === 'waiting_for_shop' && <div className="v3-status-action"><p>Your unpaid remote order waits until you arrive.</p><button onClick={handleCheckIn} disabled={actionLoading}><MapPinCheck size={17} /> I’m at the shop</button></div>}
    {statusData.cancellation_allowed && <div className="v3-status-action danger"><p>You can cancel until a printer claims this order.</p><button onClick={handleCancel} disabled={actionLoading}><Ban size={17} /> {actionLoading ? 'Cancelling…' : 'Cancel print request'}</button></div>}
    {actionError && <p className="v3-status-action-error" role="alert">{actionError}</p>}
    {error && <p className="v3-status-refresh-warning">Updates are temporarily delayed. Retrying automatically.</p>}
    <p className="v3-auto-update"><span /> Updates automatically</p>
  </main>;
}
