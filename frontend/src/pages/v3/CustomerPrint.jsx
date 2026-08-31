import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowRight, Bookmark, BookmarkCheck, Check, CheckCircle2, FileText, Info,
  LoaderCircle, LockKeyhole, Minus, Plus, ShieldCheck, Sparkles, Trash2, UploadCloud,
} from 'lucide-react';
import { v3Api } from '../../services/v3Api';
import { loadPdfDocument } from '../../services/pdfCounter';
import { calculateBatchEstimate } from '../../lib/v3Pricing';
import {
  isShopSaved, isValidShopCode, normalizeShopCode, readSavedShops,
  removeSavedShop, saveShop,
} from '../../lib/savedShops';
import ShopEntry from './ShopEntry';
import CustomerVerification from './CustomerVerification';
import './customerPrint.css';

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ENTRY_CHANNELS = new Set(['qr', 'shop_code', 'saved_shop']);
const defaultOptions = () => ({
  copies: 1, color_mode: 'bw', duplex: false, page_range: null,
  orientation: 'auto', fit_mode: 'fit', paper_size: 'A4',
});

function money(value) { return `₹${Number(value || 0).toFixed(2)}`; }

function FullPdfPreview({ file }) {
  const canvasRef = useRef(null); const [pdf, setPdf] = useState(null); const [pageNumber, setPageNumber] = useState(1); const [state, setState] = useState({ loading: true, error: '' });
  useEffect(() => { let active = true; setPdf(null); setPageNumber(1); setState({ loading: true, error: '' }); loadPdfDocument(file).then(document => { if (active) setPdf(document); }).catch(() => { if (active) setState({ loading: false, error: 'This PDF could not be previewed in the browser.' }); }); return () => { active = false; }; }, [file]);
  useEffect(() => { let active = true; if (!pdf || !canvasRef.current) return undefined; const render = async () => { try { setState({ loading: true, error: '' }); const page = await pdf.getPage(pageNumber); const canvas = canvasRef.current; if (!canvas || !active) return; const base = page.getViewport({ scale: 1 }); const width = Math.min(720, Math.max(280, canvas.parentElement?.clientWidth - 24 || 520)); const density = Math.min(window.devicePixelRatio || 1, 2); const viewport = page.getViewport({ scale: (width / base.width) * density }); canvas.width = viewport.width; canvas.height = viewport.height; canvas.style.width = `${Math.round(viewport.width / density)}px`; canvas.style.height = `${Math.round(viewport.height / density)}px`; await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise; if (active) setState({ loading: false, error: '' }); } catch { if (active) setState({ loading: false, error: `Page ${pageNumber} could not be rendered.` }); } }; render(); return () => { active = false; }; }, [pdf, pageNumber]);
  const totalPages = pdf?.numPages || 0;
  return <div className="v3-document-preview"><div className="v3-document-preview-heading"><strong>Full document preview</strong><small>{totalPages ? `Page ${pageNumber} of ${totalPages}` : 'Loading document…'}</small></div><div className="v3-pdf-canvas-wrap">{state.loading && <div className="v3-preview-loading"><LoaderCircle className="v3-spinner" size={20} /> Rendering page…</div>}{state.error && <small className="v3-preview-error">{state.error}</small>}<canvas ref={canvasRef} className="v3-pdf-canvas" style={{ display: state.loading || state.error ? 'none' : 'block' }} /></div>{totalPages > 1 && <div className="v3-preview-controls"><button type="button" className="v3-text-button" disabled={pageNumber === 1} onClick={() => setPageNumber(value => value - 1)}>Previous</button><span>Page {pageNumber} / {totalPages}</span><button type="button" className="v3-text-button" disabled={pageNumber === totalPages} onClick={() => setPageNumber(value => value + 1)}>Next</button></div>}</div>;
}

export default function CustomerPrint() {
  const { shopCode: routeShopCode } = useParams(); const [searchParams] = useSearchParams(); const navigate = useNavigate();
  const queryShopCode = searchParams.get('shop'); const requestedShopCode = normalizeShopCode(routeShopCode || queryShopCode);
  const entryChannel = ENTRY_CHANNELS.has(searchParams.get('entry')) ? searchParams.get('entry') : 'qr'; const fulfillmentMode = entryChannel === 'qr' ? 'counter' : 'remote';
  const [shop, setShop] = useState(null); const [rateCard, setRateCard] = useState(null); const [savedShops, setSavedShops] = useState(() => readSavedShops());
  const [entryError, setEntryError] = useState(''); const [entryLoading, setEntryLoading] = useState(false); const [documents, setDocuments] = useState([]); const [activeDocumentId, setActiveDocumentId] = useState(null);
  const [jobName, setJobName] = useState(''); const [showAdvanced, setShowAdvanced] = useState(false); const [loading, setLoading] = useState(false); const [fileLoading, setFileLoading] = useState(false); const [uploadProgress, setUploadProgress] = useState(''); const [error, setError] = useState('');
  const [quote, setQuote] = useState(null); const [orderInfo, setOrderInfo] = useState(null); const [serviceState, setServiceState] = useState('checking'); const [customerSession, setCustomerSession] = useState(null); const [customerAuthChecked, setCustomerAuthChecked] = useState(false);

  useEffect(() => { if (!routeShopCode && queryShopCode && isValidShopCode(queryShopCode)) navigate(`/print/${normalizeShopCode(queryShopCode)}?entry=qr`, { replace: true }); }, [navigate, queryShopCode, routeShopCode]);
  useEffect(() => { let active = true; setQuote(null); setOrderInfo(null); setError(''); setRateCard(null); if (!requestedShopCode) { setShop(null); setServiceState('checking'); return () => { active = false; }; } setServiceState('checking'); Promise.all([v3Api.getPublicShop(requestedShopCode), v3Api.getPublicShopRates(requestedShopCode)]).then(([shopResult, rates]) => { if (!active) return; setShop(shopResult); setRateCard(rates); setEntryError(''); setServiceState(shopResult.accepting_orders ? 'online' : 'offline'); }).catch(err => { if (!active) return; setShop(null); setEntryError(err.message || 'We could not find that AutoPrint shop.'); setServiceState('offline'); }); return () => { active = false; }; }, [requestedShopCode]);
  useEffect(() => { let active = true; if (fulfillmentMode !== 'remote' || shop?.demo_mode) { setCustomerAuthChecked(true); return () => { active = false; }; } setCustomerAuthChecked(false); v3Api.getCustomerSession().then(async result => { if (!sessionStorage.getItem('v3_customer_csrf')) { const csrf = await v3Api.refreshCustomerCsrf(); sessionStorage.setItem('v3_customer_csrf', csrf.csrf_token); } if (active) setCustomerSession(result.customer); }).catch(async () => { try { const guest = await v3Api.createGuestCustomerSession(); sessionStorage.setItem('v3_customer_csrf', guest.csrf_token); if (active) setCustomerSession(guest.customer); } catch { if (active) setCustomerSession(null); } }).finally(() => { if (active) setCustomerAuthChecked(true); }); return () => { active = false; }; }, [fulfillmentMode, shop?.shop_code, shop?.demo_mode]);

  const handleSelectShop = async (code, channel) => { const normalized = normalizeShopCode(code); setEntryLoading(true); setEntryError(''); try { await v3Api.getPublicShop(normalized); navigate(`/print/${normalized}?entry=${channel}`); } catch (err) { setEntryError(err.message || 'We could not find that AutoPrint shop.'); } finally { setEntryLoading(false); } };
  const handleToggleSaved = () => { if (!shop) return; setSavedShops(isShopSaved(shop.shop_code) ? removeSavedShop(shop.shop_code) : saveShop({ shopCode: shop.shop_code, name: shop.name })); };
  const invalidateQuote = () => { setQuote(null); setOrderInfo(null); };

  const handleFiles = async event => {
    const selected = Array.from(event.target.files || []); event.target.value = ''; if (!selected.length) return;
    const invalid = selected.find(file => !(file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) || file.size > MAX_FILE_BYTES);
    if (invalid) { setError(invalid.size > MAX_FILE_BYTES ? `${invalid.name} is larger than 25 MB.` : `${invalid.name} is not a PDF.`); return; }
    setFileLoading(true); setError(''); invalidateQuote();
    try {
      const additions = await Promise.all(selected.map(async file => { const pdf = await loadPdfDocument(file); return { id: crypto.randomUUID(), file, pageCount: pdf.numPages, options: defaultOptions() }; }));
      setDocuments(current => [...current, ...additions]); setActiveDocumentId(current => current || additions[0].id);
    } catch { setError('One of these PDFs could not be read. Remove it and try again.'); }
    finally { setFileLoading(false); }
  };
  const removeDocument = id => { invalidateQuote(); setDocuments(current => current.filter(document => document.id !== id)); setActiveDocumentId(current => current === id ? documents.find(document => document.id !== id)?.id || null : current); };
  const updateOptions = changes => { invalidateQuote(); setDocuments(current => current.map(document => document.id === activeDocumentId ? { ...document, options: { ...document.options, ...changes } } : document)); };
  const activeDocument = documents.find(document => document.id === activeDocumentId) || documents[0] || null;
  const estimate = useMemo(() => { if (!rateCard || !documents.length) return { lines: [], total: 0, error: '' }; try { return { ...calculateBatchEstimate(documents, rateCard.rules), error: '' }; } catch (err) { return { lines: [], total: 0, error: err.message }; } }, [documents, rateCard]);
  const linePrice = id => estimate.lines.find(line => line.id === id)?.total;

  const handleCreateOrderAndQuote = async () => {
    if (!documents.length || !shop || estimate.error) { setError(estimate.error || 'Choose at least one PDF before continuing.'); return; }
    setLoading(true); setError(''); setUploadProgress('Opening one secure print order…');
    try {
      const order = await v3Api.createOrder(shop.shop_code, entryChannel, fulfillmentMode, fulfillmentMode === 'remote' ? sessionStorage.getItem('v3_customer_csrf') || '' : '', jobName.trim());
      sessionStorage.setItem(`v3_cap_${order.order_id}`, order.capability_token); const quoteItems = [];
      for (let index = 0; index < documents.length; index += 1) {
        const document = documents[index]; setUploadProgress(`Uploading document ${index + 1} of ${documents.length}: ${document.file.name}`);
        const intent = await v3Api.getUploadIntent(order.order_id, order.capability_token, { original_file_name: document.file.name, declared_media_type: 'application/pdf', byte_size: document.file.size });
        const uploaded = await fetch(intent.signed_upload_url, { method: 'PUT', headers: { 'Content-Type': 'application/pdf', 'x-upsert': 'false' }, body: document.file });
        if (!uploaded.ok) throw new Error(`${document.file.name} could not be uploaded. Please try again.`);
        setUploadProgress(`Validating document ${index + 1} of ${documents.length}…`);
        await v3Api.finalizeUpload(order.order_id, order.capability_token, { source_document_id: intent.source_document_id });
        quoteItems.push({ source_document_id: intent.source_document_id, options: document.options });
      }
      setUploadProgress('Confirming the authoritative batch price…');
      const lockedQuote = await v3Api.createBatchQuote(order.order_id, order.capability_token, quoteItems);
      setOrderInfo({ orderId: order.order_id, capabilityToken: order.capability_token }); setQuote(lockedQuote);
    } catch (err) { setError(err.message || 'We could not prepare this print order. Please try again.'); }
    finally { setUploadProgress(''); setLoading(false); }
  };
  const handleAcceptQuote = async () => { if (!quote || !orderInfo) return; setLoading(true); setError(''); try { const key = `v3_accept_idem_${quote.quote_id}`; let idempotencyKey = sessionStorage.getItem(key); if (!idempotencyKey) { idempotencyKey = crypto.randomUUID(); sessionStorage.setItem(key, idempotencyKey); } await v3Api.acceptQuote(quote.quote_id, orderInfo.capabilityToken, idempotencyKey); navigate(`/order/${orderInfo.orderId}`); } catch (err) { setError(err.message || 'The order could not be submitted. Retry safely.'); } finally { setLoading(false); } };

  const shopSaved = useMemo(() => shop ? isShopSaved(shop.shop_code) : false, [shop, savedShops]);
  if (!requestedShopCode || (!shop && serviceState === 'offline')) return <ShopEntry savedShops={savedShops} error={entryError} loading={entryLoading} onSelectShop={handleSelectShop} onRemoveSaved={code => setSavedShops(removeSavedShop(code))} />;
  if (!shop) return <div className="v3-customer-container v3-shop-loading"><LoaderCircle className="v3-spinner" /><h1>Connecting to your shop</h1><p>Checking {requestedShopCode}…</p></div>;
  if (fulfillmentMode === 'remote' && !shop.demo_mode && !customerAuthChecked) return <div className="v3-customer-container v3-shop-loading"><LoaderCircle className="v3-spinner" /><h1>Checking your customer session</h1></div>;
  if (fulfillmentMode === 'remote' && !shop.demo_mode && !customerSession) return <CustomerVerification shopName={shop.name} onVerified={setCustomerSession} />;

  const o = activeDocument?.options || defaultOptions();
  return <div className="v3-customer-container">
    <section className="v3-intro"><div><span className="v3-eyebrow"><Sparkles size={14} /> Ready in a few taps</span><h1>Print your PDFs.<br /><em>Skip the queue.</em></h1><p>Add every document, give each its own settings, and send them as one order.</p><div className="v3-shop-actions"><button type="button" onClick={handleToggleSaved}>{shopSaved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}{shopSaved ? 'Shop saved' : 'Save shop'}</button><button type="button" onClick={() => navigate('/print')}>Change shop</button></div></div><div className={`v3-shop-chip ${serviceState}`}><span className="v3-live-dot" /><span>Sending to <strong>{shop.name}</strong><small>{shop.shop_code} · remote order intake</small></span></div></section>
    <div className="v3-flow-grid"><section className="v3-workspace">
      <div className="v3-step-card"><div className="v3-step-heading"><span className={`v3-step-number ${documents.length ? 'complete' : ''}`}>{documents.length ? <Check size={17} /> : '1'}</span><div><h2>Choose your documents</h2><p>Multiple PDFs · Maximum 25 MB each</p></div></div>
        <label className="v3-upload-zone" htmlFor="v3-pdf-input"><input id="v3-pdf-input" type="file" multiple accept="application/pdf,.pdf" onChange={handleFiles} disabled={loading || Boolean(quote)} /><span className="v3-upload-icon"><UploadCloud size={29} /></span><span className="v3-upload-copy"><strong>{documents.length ? 'Add more PDFs' : 'Choose one or more PDFs'}</strong><small>Each document keeps independent print settings</small></span><span className="v3-browse-button">{fileLoading ? 'Reading…' : 'Browse PDFs'}</span></label>
        {documents.length > 0 && <div className="v3-document-list">{documents.map((document, index) => <div key={document.id} className={`v3-document-row ${activeDocument?.id === document.id ? 'active' : ''}`}><button type="button" onClick={() => setActiveDocumentId(document.id)}><FileText size={18} /><span><strong>{document.file.name}</strong><small>{document.pageCount} pages · {document.options.copies} {document.options.copies === 1 ? 'copy' : 'copies'} · {document.options.color_mode === 'color' ? 'Colour' : 'B&W'}</small></span><b>{linePrice(document.id) == null ? '—' : money(linePrice(document.id))}</b></button><button type="button" aria-label={`Remove ${document.file.name}`} disabled={loading || Boolean(quote)} onClick={() => removeDocument(document.id)}><Trash2 size={17} /></button><i>{index + 1}</i></div>)}</div>}
        {activeDocument && <FullPdfPreview key={activeDocument.id} file={activeDocument.file} />}
      </div>
      {activeDocument && <div className="v3-step-card"><div className="v3-step-heading"><span className="v3-step-number">2</span><div><h2>Settings for {activeDocument.file.name}</h2><p>Select another document above to configure it independently</p></div></div><div className="v3-settings-grid"><div className="v3-field"><span className="v3-field-label">Copies</span><div className="v3-counter"><button type="button" disabled={Boolean(quote)} onClick={() => updateOptions({ copies: Math.max(1, o.copies - 1) })}><Minus size={17} /></button><input aria-label="Number of copies" type="number" min="1" max="100" disabled={Boolean(quote)} value={o.copies} onChange={event => updateOptions({ copies: Math.min(100, Math.max(1, Number(event.target.value) || 1)) })} /><button type="button" disabled={Boolean(quote)} onClick={() => updateOptions({ copies: Math.min(100, o.copies + 1) })}><Plus size={17} /></button></div></div><fieldset className="v3-field v3-color-field" disabled={Boolean(quote)}><legend className="v3-field-label">Ink</legend><div className="v3-segmented"><button type="button" className={o.color_mode === 'bw' ? 'active' : ''} onClick={() => updateOptions({ color_mode: 'bw' })}><span className="v3-ink-dot bw" />B&amp;W</button><button type="button" className={o.color_mode === 'color' ? 'active' : ''} onClick={() => updateOptions({ color_mode: 'color' })}><span className="v3-ink-dot color" />Colour</button></div></fieldset></div>
        <label className="v3-toggle-row"><span><strong>Print on both sides</strong><small>Uses less paper when supported</small></span><input type="checkbox" disabled={Boolean(quote)} checked={o.duplex} onChange={event => updateOptions({ duplex: event.target.checked })} /><span className="v3-toggle" /></label>
        <button className="v3-text-button" type="button" onClick={() => setShowAdvanced(value => !value)}>{showAdvanced ? 'Hide advanced settings' : 'Advanced print settings'}</button>{showAdvanced && <div className="v3-settings-grid v3-advanced-grid"><label className="v3-field"><span className="v3-field-label">Pages</span><input disabled={Boolean(quote)} value={o.page_range || ''} onChange={event => updateOptions({ page_range: event.target.value || null })} placeholder="All pages, or 1-5, 8" /></label><label className="v3-field"><span className="v3-field-label">Paper size</span><select disabled={Boolean(quote)} value={o.paper_size} onChange={event => updateOptions({ paper_size: event.target.value })}><option>A4</option><option>A3</option><option value="legal">Legal</option></select></label><label className="v3-field"><span className="v3-field-label">Orientation</span><select disabled={Boolean(quote)} value={o.orientation} onChange={event => updateOptions({ orientation: event.target.value })}><option value="auto">Auto-detect</option><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label><label className="v3-field"><span className="v3-field-label">Scaling</span><select disabled={Boolean(quote)} value={o.fit_mode} onChange={event => updateOptions({ fit_mode: event.target.value })}><option value="fit">Fit to printable area</option><option value="shrink">Shrink oversized pages</option><option value="noscale">Actual size</option></select></label></div>}
        <label className="v3-field v3-job-name-field"><span className="v3-field-label">Batch name <small>Optional</small></span><input disabled={Boolean(quote)} value={jobName} maxLength="80" onChange={event => setJobName(event.target.value)} placeholder="e.g. Semester notes" /><small>This labels the whole order; filenames remain visible separately.</small></label></div>}
      {error && <div className="v3-message error"><Info size={19} /><span><strong>We couldn’t continue</strong>{error}</span></div>}{uploadProgress && <div className="v3-message progress"><LoaderCircle className="v3-spinner" size={19} /><span><strong>Working on it</strong>{uploadProgress}</span></div>}
    </section>
    <aside className="v3-summary-card"><div className="v3-summary-top"><span className="v3-summary-kicker">Your print order</span><h2>{quote ? 'Price locked' : 'Live total'}</h2><p>{quote ? 'The backend verified every artifact and line price.' : 'Updates instantly from this shop’s current rate card.'}</p></div><div className="v3-batch-summary"><div><span>Shop</span><strong>{shop.name}</strong></div>{documents.map(document => <div key={document.id}><span title={document.file.name}>{document.file.name}</span><strong>{linePrice(document.id) == null ? '—' : money(linePrice(document.id))}</strong></div>)}</div>{estimate.error && <div className="v3-inline-price-error">{estimate.error}</div>}<div className="v3-total"><span>{documents.length} {documents.length === 1 ? 'document' : 'documents'}</span><strong>{quote ? money(quote.total_amount) : estimate.error ? '—' : money(estimate.total)}</strong></div>{quote ? <><button className="v3-primary-button" onClick={handleAcceptQuote} disabled={loading}>{loading ? <><LoaderCircle className="v3-spinner" size={18} /> Submitting…</> : <>Confirm &amp; send all <ArrowRight size={18} /></>}</button><button className="v3-text-button" type="button" disabled={loading} onClick={() => { setQuote(null); setOrderInfo(null); }}>Change documents or settings</button></> : <button className="v3-primary-button" onClick={handleCreateOrderAndQuote} disabled={loading || fileLoading || !documents.length || Boolean(estimate.error) || serviceState !== 'online' || shop.demo_mode}>{loading ? <><LoaderCircle className="v3-spinner" size={18} /> Uploading batch…</> : <>Review &amp; send {documents.length || ''} {documents.length === 1 ? 'document' : 'documents'} <ArrowRight size={18} /></>}</button>}<div className="v3-assurances"><span><ShieldCheck size={17} /> One verified artifact per PDF</span><span><LockKeyhole size={17} /> Private uploads</span><span><CheckCircle2 size={17} /> Final price verified by server</span></div></aside>
    </div>
  </div>;
}
