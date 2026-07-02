import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useDemo } from './DemoContext';
import { getPdfDetails } from '../../services/pdfCounter';

/* ── helpers ── */
function makeObjectURL(raw) {
  try { return raw ? URL.createObjectURL(raw) : null; } catch { return null; }
}

function formatFileSize(file) {
  if (file?.raw?.size) {
    const bytes = file.raw.size;
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
  if (file?.id === 'resume') return '245 KB';
  return '1.2 MB';
}

/* ── Dynamic PDF Mobile Preview with Pagination ── */
function PdfMobilePreview({ file }) {
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const canvasRef = useRef(null);
  const pdfDocRef = useRef(null);
  const renderTaskRef = useRef(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setCurrentPage(1);

    const loadPdf = async () => {
      try {
        if (!file?.raw) {
          throw new Error("No raw file data");
        }
        
        if (!window.pdfjsLib) {
          await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
            script.onload = () => {
              window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
              resolve();
            };
            script.onerror = () => reject(new Error('Failed to load PDF library.'));
            document.head.appendChild(script);
          });
        }

        const arrayBuffer = await file.raw.arrayBuffer();
        const typedarray = new Uint8Array(arrayBuffer);
        const loadingTask = window.pdfjsLib.getDocument({ data: typedarray });
        const pdf = await loadingTask.promise;
        
        if (active) {
          pdfDocRef.current = pdf;
          renderPage(pdf, 1);
        }
      } catch (err) {
        console.error("PdfMobilePreview load error:", err);
        if (active) {
          setError(err.message || "Failed to render PDF");
          setLoading(false);
        }
      }
    };

    loadPdf();

    return () => {
      active = false;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
    };
  }, [file?.raw]);

  const renderPage = async (pdfDoc, pageNum) => {
    try {
      const pdf = pdfDoc || pdfDocRef.current;
      if (!pdf) return;

      setLoading(true);

      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }

      const page = await pdf.getPage(pageNum);
      const canvas = canvasRef.current;
      if (!canvas) return;

      const context = canvas.getContext('2d');
      const baseViewport = page.getViewport({ scale: 1.0 });
      const scale = 200 / baseViewport.height;
      const viewport = page.getViewport({ scale });

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      const renderContext = {
        canvasContext: context,
        viewport: viewport
      };

      const renderTask = page.render(renderContext);
      renderTaskRef.current = renderTask;
      
      await renderTask.promise;
      setLoading(false);
    } catch (err) {
      if (err.name !== 'RenderingCancelledException') {
        console.error("Page render error:", err);
        setLoading(false);
      }
    }
  };

  const handlePrev = () => {
    if (currentPage > 1) {
      const nextPage = currentPage - 1;
      setCurrentPage(nextPage);
      renderPage(pdfDocRef.current, nextPage);
    }
  };

  const handleNext = () => {
    const pdf = pdfDocRef.current;
    if (pdf && currentPage < pdf.numPages) {
      const nextPage = currentPage + 1;
      setCurrentPage(nextPage);
      renderPage(pdf, nextPage);
    }
  };

  if (error) {
    return (
      <div className="cp-pdf-doc-mock">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="cp-pdf-icon"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span className="cp-pdf-filename">{file.name}</span>
        <span className="cp-pdf-badge" style={{ background: 'rgba(255, 255, 255, 0.08)', color: 'var(--text-secondary)' }}>{formatFileSize(file)}</span>
        <span className="cp-pdf-badge" style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>PDF Document</span>
      </div>
    );
  }

  const totalPages = pdfDocRef.current ? pdfDocRef.current.numPages : (file.pageCount || 1);

  return (
    <div className="cp-pdf-mobile-preview-wrapper" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
      <div className="cp-pdf-mobile-preview-canvas-container" style={{ position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '160px' }}>
        <canvas 
          ref={canvasRef} 
          style={{ 
            boxShadow: '0 4px 15px rgba(0,0,0,0.25)', 
            borderRadius: '6px', 
            border: '1px solid rgba(255,255,255,0.1)',
            maxWidth: '100%',
            maxHeight: '190px',
            opacity: loading ? 0.6 : 1,
            transition: 'opacity 0.2s ease',
            display: 'block'
          }} 
        />
        {loading && (
          <div style={{ position: 'absolute', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="cp-btn-spinner" style={{ borderTopColor: 'var(--primary-light)', width: '24px', height: '24px' }}></div>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="cp-pdf-pagination-controls" style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '12px', 
          marginTop: '8px', 
          background: 'rgba(255, 255, 255, 0.06)', 
          padding: '3px 10px', 
          borderRadius: '20px',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
          zIndex: 5
        }}>
          <button 
            onClick={handlePrev} 
            disabled={currentPage === 1}
            style={{ 
              background: 'none', 
              border: 'none', 
              color: currentPage === 1 ? 'var(--text-muted)' : 'var(--primary-light)', 
              cursor: currentPage === 1 ? 'not-allowed' : 'pointer', 
              fontSize: '1.1rem',
              fontWeight: 'bold',
              padding: '2px 8px',
              display: 'flex',
              alignItems: 'center',
              userSelect: 'none'
            }}
          >
            &lt;
          </button>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', userSelect: 'none', fontWeight: 600 }}>
            {currentPage} / {totalPages}
          </span>
          <button 
            onClick={handleNext} 
            disabled={currentPage === totalPages}
            style={{ 
              background: 'none', 
              border: 'none', 
              color: currentPage === totalPages ? 'var(--text-muted)' : 'var(--primary-light)', 
              cursor: currentPage === totalPages ? 'not-allowed' : 'pointer', 
              fontSize: '1.1rem',
              fontWeight: 'bold',
              padding: '2px 8px',
              display: 'flex',
              alignItems: 'center',
              userSelect: 'none'
            }}
          >
            &gt;
          </button>
        </div>
      )}
    </div>
  );
}

/* ── File Preview ── */
function FilePreview({ file }) {
  const url = useMemo(() => makeObjectURL(file?.raw), [file?.raw]);
  if (!file) return null;

  if (file.isProcessing) {
    return (
      <div className="cp-preview">
        <div className="cp-preview-placeholder" style={{ gap: '12px' }}>
          <div className="cp-btn-spinner" style={{ borderTopColor: 'var(--primary-light)', width: '28px', height: '28px', margin: '0 auto 8px auto' }}></div>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Processing PDF preview...</span>
        </div>
      </div>
    );
  }

  const isPDF = file.raw?.type === 'application/pdf' || file.name?.toLowerCase().endsWith('.pdf');

  if (isPDF) {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile) {
      return (
        <div className="cp-preview cp-preview--pdf" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <PdfMobilePreview file={file} />
        </div>
      );
    }
    return (
      <div className="cp-pdf-preview-container">
        <div className="cp-pdf-preview-sheet">
          <object
            data={url + '#toolbar=0&navpanes=0&scrollbar=0&view=FitH&page=1'}
            type="application/pdf"
            className="cp-pdf-preview-object"
          >
            <PdfMobilePreview file={file} />
          </object>
        </div>
      </div>
    );
  }

  if (file.thumbnail) return <div className="cp-preview"><img src={file.thumbnail} alt="preview" style={{ boxShadow: '0 2px 10px rgba(0,0,0,0.15)' }} /></div>;
  if (file.type === 'image') return <div className="cp-preview"><img src={url} alt="preview" /></div>;

  return (
    <div className="cp-preview">
      <div className="cp-preview-placeholder">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6, marginBottom: '8px' }}><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
        {file.name}
      </div>
    </div>
  );
}

/* ── Aadhaar Preview (A4 paper mock) ── */
function AadhaarPreview({ front, back }) {
  return (
    <div className="cp-preview cp-preview--aadhaar">
      <div className="cp-aadhaar-paper">
        <div className="cp-aadhaar-slot" style={front ? { backgroundImage: `url(${front})` } : {}}>
          {!front && (
            <div className="cp-aadhaar-wireframe">
              <div className="cp-aadhaar-wf-top">
                <div className="cp-aadhaar-wf-avatar"></div>
                <div className="cp-aadhaar-wf-lines">
                  <div className="cp-aadhaar-wf-line"></div>
                  <div className="cp-aadhaar-wf-line short"></div>
                </div>
              </div>
              <div className="cp-aadhaar-wf-bottom"></div>
            </div>
          )}
        </div>
        <div className="cp-aadhaar-slot" style={back ? { backgroundImage: `url(${back})` } : {}}>
          {!back && (
            <div className="cp-aadhaar-wireframe">
              <div className="cp-aadhaar-wf-top">
                <div className="cp-aadhaar-wf-lines" style={{ marginLeft: 0 }}>
                  <div className="cp-aadhaar-wf-line"></div>
                  <div className="cp-aadhaar-wf-line short"></div>
                  <div className="cp-aadhaar-wf-line"></div>
                </div>
              </div>
              <div className="cp-aadhaar-wf-bottom"></div>
            </div>
          )}
        </div>
      </div>
      <p className="cp-aadhaar-caption">Auto-stitched onto A4</p>
    </div>
  );
}

/* ── Photo Grid Preview (real images) ── */
function PhotoGridPreview({ images, gridSize }) {
  const slots = Array.from({ length: gridSize });
  return (
    <div className={`cp-grid-preview grid-${gridSize}`}>
      {slots.map((_, i) => {
        const src = images[i % images.length];
        return (
          <div key={i} className="cp-grid-cell">
            {src ? <div className="cp-grid-img" style={{ backgroundImage: `url(${src})` }} /> : <div className="cp-grid-cell-empty" />}
          </div>
        );
      })}
    </div>
  );
}

/* ── Reusable setting rows ── */
function ToggleRow({ label, options, value, onChange }) {
  return (
    <div className="cp-row">
      <span className="cp-label">{label}</span>
      <div className="cp-toggle">
        {options.map(o => (
          <button key={String(o.v)} className={value === o.v ? 'active' : ''} onClick={() => onChange(o.v)}>{o.l}</button>
        ))}
      </div>
    </div>
  );
}

function Counter({ label, value, onChange }) {
  return (
    <div className="cp-row">
      <span className="cp-label">{label}</span>
      <div className="cp-counter">
        <button onClick={() => onChange(Math.max(1, value - 1))}>−</button>
        <span>{value}</span>
        <button onClick={() => onChange(value + 1)}>+</button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   UPLOAD SCREEN
══════════════════════════════════════ */
function UploadScreen() {
  const { DEMO_FILES, selectDemoFile, setUploadedFile, tryAadhaarMode } = useDemo();

  const handleFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isPDF = file.type === 'application/pdf' || file.name?.toLowerCase().endsWith('.pdf');
    if (isPDF) {
      setUploadedFile({ name: file.name, type: 'document', pageCount: 1, raw: file, thumbnail: null, isProcessing: true });
      try {
        const { pageCount, thumbnail } = await getPdfDetails(file);
        setUploadedFile({ name: file.name, type: 'document', pageCount, raw: file, thumbnail, isProcessing: false });
      } catch (err) {
        console.error("PDF details extraction failed:", err);
        setUploadedFile({ name: file.name, type: 'document', pageCount: 1, raw: file, thumbnail: null, isProcessing: false });
      }
    } else {
      const type = file.type.startsWith('image/') ? 'image' : 'document';
      const thumbnail = type === 'image' ? URL.createObjectURL(file) : null;
      setUploadedFile({ name: file.name, type, pageCount: 1, raw: file, thumbnail, isProcessing: false });
    }
  }, [setUploadedFile]);

  return (
    <div className="cp-upload-screen">
      <div className="cp-upload-hero">
        <h2>Send a print job.</h2>
        <p>Upload or pick a demo file to get started.</p>
      </div>

      <label className="cp-upload-btn">
        <input type="file" accept="application/pdf,image/*,.doc,.docx" onChange={handleFile} />
        ＋ Choose File
      </label>

      <div className="cp-divider"><span>or try a demo</span></div>

      <div className="cp-demo-files">
        {Object.values(DEMO_FILES).map(f => (
          <button key={f.id} className="cp-demo-file" onClick={() => selectDemoFile(f.id)}>
            <span style={{ display: 'flex', alignItems: 'center' }}>
              {f.type === 'image' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--primary-light)' }}><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--primary-light)' }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              )}
            </span>
            <div>
              <div className="cp-demo-name">{f.name}</div>
              <div className="cp-demo-meta">{f.type === 'image' ? 'Image · Photo grid enabled' : `${f.pageCount} pages · PDF`}</div>
            </div>
          </button>
        ))}
        <button className="cp-demo-file" onClick={tryAadhaarMode}>
          <span style={{ display: 'flex', alignItems: 'center' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--primary-light)' }}><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M15 13h2"/><path d="M15 9h2"/><path d="M15 17h2"/><path d="M5 18a4 4 0 0 1 8 0"/></svg>
          </span>
          <div>
            <div className="cp-demo-name">Aadhaar / ID Card</div>
            <div className="cp-demo-meta">ID stitching · auto A4 layout</div>
          </div>
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   PHOTO GRID SCREEN
══════════════════════════════════════ */
function PhotoGridScreen() {
  const { state, isSubmitting, updateOption, submitJob } = useDemo();
  const inputRef = useRef();

  const images = state.gridImages || [];

  const handleImages = useCallback((e) => {
    const files = Array.from(e.target.files || []);
    const urls = files.map(f => URL.createObjectURL(f));
    const next = [...images, ...urls];
    updateOption('gridImages', next);
  }, [images, updateOption]);

  const removeImage = useCallback((idx) => {
    const next = images.filter((_, i) => i !== idx);
    updateOption('gridImages', next);
  }, [images, updateOption]);

  return (
    <div className="cp-config-screen">
      {/* Preview */}
      <div className="cp-config-preview" style={{ padding: '12px', background: '#f0f0f0' }}>
        {images.length > 0
          ? <PhotoGridPreview images={images} gridSize={state.gridSize} />
          : (
            <div className="cp-preview-placeholder" style={{ opacity: 0.6 }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '8px' }}><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              Add photos to preview
            </div>
          )
        }
      </div>

      {/* Settings */}
      <div className="cp-settings-scroll">
        <div className="cp-file-bar">
          <button className="cp-back" onClick={() => updateOption('file', null)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          </button>
          <span className="cp-filename">Photo Grid</span>
        </div>

        {/* Images manager */}
        <div className="cp-photo-images-section">
          <div className="cp-row">
            <span className="cp-label">Images ({images.length})</span>
            <button className="cp-add-image-btn" onClick={() => inputRef.current?.click()}>+ Add</button>
            <input ref={inputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleImages} />
          </div>
          {images.length > 0 && (
            <div className="cp-image-thumbs">
              {images.map((src, i) => (
                <div key={i} className="cp-image-thumb">
                  <img src={src} alt={`img-${i}`} />
                  <button className="cp-thumb-remove" onClick={() => removeImage(i)}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="cp-row">
          <span className="cp-label">Per Page</span>
          <div className="cp-toggle">
            {[2, 4, 6, 9, 16].map(n => (
              <button key={n} className={state.gridSize === n ? 'active' : ''} onClick={() => updateOption('gridSize', n)}>{n}</button>
            ))}
          </div>
        </div>

        <ToggleRow label="Color" options={[{ v: 'bw', l: 'B&W' }, { v: 'color', l: 'Color' }]} value={state.colorMode} onChange={v => updateOption('colorMode', v)} />
        <Counter label="Copies" value={state.copies} onChange={v => updateOption('copies', v)} />
      </div>

      <div className="cp-footer">
        <div className="cp-price"><span>Est. Total</span><strong>₹{state.calculatedPrice}</strong></div>
        <button className="cp-submit" onClick={submitJob} disabled={images.length === 0 || isSubmitting}>
          {isSubmitting ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <span className="cp-btn-spinner"></span>Submitting...
            </span>
          ) : 'Submit Print Job'}
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   CONFIG SCREEN (doc / single image)
══════════════════════════════════════ */
function ConfigScreen() {
  const { state, isSubmitting, updateOption, submitJob } = useDemo();
  const [showAdv, setShowAdv] = useState(false);
  const isPhoto = state.file?.type === 'image';

  // If photo and user switches to grid mode → show grid screen
  if (isPhoto && state.layoutMode === 'photo_grid') {
    return <PhotoGridScreen />;
  }

  return (
    <div className="cp-config-screen">
      <div className="cp-config-preview">
        <FilePreview file={state.file} />
      </div>

      <div className="cp-settings-scroll">
        <div className="cp-file-bar">
          <button className="cp-back" onClick={() => updateOption('file', null)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          </button>
          <span className="cp-filename">{state.file?.name}</span>
        </div>

        {isPhoto && (
          <ToggleRow
            label="Layout"
            options={[{ v: 'document', l: 'Full Page' }, { v: 'photo_grid', l: 'Photo Grid' }]}
            value={state.layoutMode}
            onChange={v => {
              updateOption('layoutMode', v);
              if (v === 'photo_grid' && (!state.gridImages || state.gridImages.length === 0)) {
                const src = state.file?.thumbnail || makeObjectURL(state.file?.raw);
                if (src) updateOption('gridImages', [src]);
              }
            }}
          />
        )}

        <ToggleRow label="Color" options={[{ v: 'bw', l: 'B&W' }, { v: 'color', l: 'Color' }]} value={state.colorMode} onChange={v => updateOption('colorMode', v)} />
        <ToggleRow label="Sides" options={[{ v: false, l: 'Single' }, { v: true, l: 'Double' }]} value={state.duplex} onChange={v => updateOption('duplex', v)} />
        <Counter label="Copies" value={state.copies} onChange={v => updateOption('copies', v)} />

        <button className="cp-advanced-toggle" onClick={() => setShowAdv(s => !s)} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ transition: 'transform 0.2s', transform: showAdv ? 'rotate(0deg)' : 'rotate(-90deg)', color: 'var(--text-muted)' }}><polyline points="6 9 12 15 18 9"/></svg>
          Advanced Settings
        </button>

        {showAdv && (
          <div className="cp-advanced-panel">
            <div className="cp-row">
              <span className="cp-label">Paper</span>
              <select value={state.paperSize} onChange={e => updateOption('paperSize', e.target.value)}>
                <option>A4</option>
                <option>A3</option>
                <option>Letter</option>
                <option>A5</option>
              </select>
            </div>
            <div className="cp-row">
              <span className="cp-label">Orientation</span>
              <div className="cp-toggle">
                <button className={state.orientation === 'auto' ? 'active' : ''} onClick={() => updateOption('orientation', 'auto')}>Auto</button>
                <button className={state.orientation === 'portrait' ? 'active' : ''} onClick={() => updateOption('orientation', 'portrait')}>Portrait</button>
                <button className={state.orientation === 'landscape' ? 'active' : ''} onClick={() => updateOption('orientation', 'landscape')}>Landscape</button>
              </div>
            </div>
            <div className="cp-row">
              <span className="cp-label">Page Range</span>
              <input type="text" placeholder="e.g. 1-3, 5" value={state.pageRange} onChange={e => updateOption('pageRange', e.target.value)} />
            </div>
            <div className="cp-row">
              <span className="cp-label">Fit</span>
              <div className="cp-toggle">
                <button className={state.fitMode === 'fit' ? 'active' : ''} onClick={() => updateOption('fitMode', 'fit')}>Fit</button>
                <button className={state.fitMode === 'fill' ? 'active' : ''} onClick={() => updateOption('fitMode', 'fill')}>Fill</button>
                <button className={state.fitMode === 'actual' ? 'active' : ''} onClick={() => updateOption('fitMode', 'actual')}>Actual</button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="cp-footer">
        <div className="cp-price"><span>Est. Total</span><strong>₹{state.calculatedPrice}</strong></div>
        <button className="cp-submit" onClick={submitJob} disabled={isSubmitting}>
          {isSubmitting ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <span className="cp-btn-spinner"></span>Submitting...
            </span>
          ) : 'Submit Print Job'}
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   AADHAAR SCREEN
══════════════════════════════════════ */
function AadhaarScreen() {
  const { state, isSubmitting, updateOption, submitJob, resetDemo } = useDemo();
  const frontRef = useRef();
  const backRef = useRef();

  const handleImg = side => e => {
    const f = e.target.files?.[0];
    if (f) updateOption(side, URL.createObjectURL(f));
  };

  return (
    <div className="cp-config-screen">
      <div className="cp-config-preview">
        <AadhaarPreview front={state.aadhaarFront} back={state.aadhaarBack} />
      </div>

      <div className="cp-settings-scroll">
        <div className="cp-file-bar">
          <button className="cp-back" onClick={resetDemo}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          </button>
          <span className="cp-filename">Aadhaar / ID Card</span>
        </div>

        <div className="cp-aadhaar-grid">
          <button className={`cp-aadhaar-slot-btn ${state.aadhaarFront ? 'done' : ''}`} onClick={() => frontRef.current?.click()}>
            <input ref={frontRef} type="file" accept="image/*" onChange={handleImg('aadhaarFront')} style={{ display: 'none' }} />
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {state.aadhaarFront ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  Front Added
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                  Front Side
                </>
              )}
            </span>
          </button>
          <button className={`cp-aadhaar-slot-btn ${state.aadhaarBack ? 'done' : ''}`} onClick={() => backRef.current?.click()}>
            <input ref={backRef} type="file" accept="image/*" onChange={handleImg('aadhaarBack')} style={{ display: 'none' }} />
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {state.aadhaarBack ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  Back Added
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                  Back Side
                </>
              )}
            </span>
          </button>
        </div>

        <ToggleRow label="Color" options={[{ v: 'bw', l: 'B&W' }, { v: 'color', l: 'Color' }]} value={state.colorMode} onChange={v => updateOption('colorMode', v)} />
        <Counter label="Copies" value={state.copies} onChange={v => updateOption('copies', v)} />
      </div>

      <div className="cp-footer">
        <div className="cp-price"><span>Est. Total</span><strong>₹{state.calculatedPrice}</strong></div>
        <button className="cp-submit" onClick={submitJob} disabled={isSubmitting}>
          {isSubmitting ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <span className="cp-btn-spinner"></span>Submitting...
            </span>
          ) : 'Submit Print Job'}
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   SUCCESS SCREEN
══════════════════════════════════════ */
function SuccessScreen() {
  const { state, tryAadhaarMode } = useDemo();
  return (
    <div className="cp-success-screen">
      <div className="cp-success-icon">✓</div>
      <h2>Job Submitted!</h2>
      <p>Watch it arrive on the Shopkeeper Console →</p>
      <div className="cp-job-ref">Job #{state.jobId}</div>
      {state.phase === 'completed' && !state.isAadhaarMode && (
        <button className="cp-try-aadhaar" onClick={tryAadhaarMode}>🪪 Try Aadhaar / ID Card mode</button>
      )}
    </div>
  );
}

/* ══════════════════════════════════════
   ROOT
══════════════════════════════════════ */
export default function DemoCustomerPanel() {
  const { state } = useDemo();
  const isPost = ['submitted', 'approving', 'completed'].includes(state.phase);

  return (
    <div className="cp-root">
      <div className="cp-header">
        <span className="cp-brand">🖨 AutoPrint</span>
        <span className="cp-shop">Demo Shop · KRL004</span>
      </div>
      <div className="cp-body">
        {isPost ? <SuccessScreen />
          : state.isAadhaarMode ? <AadhaarScreen />
          : state.file ? <ConfigScreen />
          : <UploadScreen />}
      </div>
    </div>
  );
}
