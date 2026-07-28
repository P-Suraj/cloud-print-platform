import { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { getPdfPageCount } from '../services/pdfCounter';
import { UploadIcon, FileIcon } from '../components/Icons';

// Reads page count from a .docx file without any library.
// .docx is a ZIP — we extract docProps/app.xml which Word writes with <Pages> count.
async function getDocxPageCount(file) {
  try {
    const { BlobReader, ZipReader, TextWriter } = await import('https://cdn.jsdelivr.net/npm/@zip.js/zip.js@2.7.52/+esm');
    const reader = new ZipReader(new BlobReader(file));
    const entries = await reader.getEntries();
    const appXml = entries.find(e => e.filename === 'docProps/app.xml');
    if (appXml) {
      const text = await appXml.getData(new TextWriter());
      const match = text.match(/<Pages>(\d+)<\/Pages>/);
      if (match) {
        await reader.close();
        return parseInt(match[1], 10);
      }
    }
    // Fallback: estimate from paragraph count in document.xml (~40 paragraphs/page)
    const docXml = entries.find(e => e.filename === 'word/document.xml');
    if (docXml) {
      const text = await docXml.getData(new TextWriter());
      const paraCount = (text.match(/<w:p[ >]/g) || []).length;
      await reader.close();
      return Math.max(1, Math.ceil(paraCount / 40));
    }
    await reader.close();
  } catch (err) {
    console.warn('docx page count failed:', err);
  }
  return null;
}


function loadPdfDocument(file) {
  return new Promise((resolve, reject) => {
    if (!window.pdfjsLib) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
      script.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
        parseAndResolvePdf(file, resolve, reject);
      };
      script.onerror = () => reject(new Error('Failed to load PDF processing library.'));
      document.head.appendChild(script);
    } else {
      parseAndResolvePdf(file, resolve, reject);
    }
  });
}

function parseAndResolvePdf(file, resolve, reject) {
  const reader = new FileReader();
  reader.onload = async function (e) {
    try {
      const typedarray = new Uint8Array(e.target.result);
      const loadingTask = window.pdfjsLib.getDocument({ data: typedarray });
      loadingTask.promise.then(
        (pdf) => resolve(pdf),
        (err) => reject(err)
      );
    } catch (err) {
      reject(err);
    }
  };
  reader.onerror = () => reject(new Error('Failed to read file.'));
  reader.readAsArrayBuffer(file);
}

function PdfPageCanvas({ pdfDoc, pageNumber, style }) {
  const canvasRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    if (!pdfDoc) return;

    async function renderPage() {
      try {
        setLoading(true);
        setError(false);
        const page = await pdfDoc.getPage(pageNumber);
        if (!active) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d');
        
        // Target a width of 300px for the preview
        const desiredWidth = 300;
        const viewport = page.getViewport({ scale: 1.0 });
        const scale = desiredWidth / viewport.width;
        const scaledViewport = page.getViewport({ scale });

        canvas.width = scaledViewport.width;
        canvas.height = scaledViewport.height;

        const renderContext = {
          canvasContext: context,
          viewport: scaledViewport,
        };
        
        await page.render(renderContext).promise;
        if (active) {
          setLoading(false);
        }
      } catch (err) {
        console.error('Error rendering page:', err);
        if (active) {
          setError(true);
          setLoading(false);
        }
      }
    }

    renderPage();

    return () => {
      active = false;
    };
  }, [pdfDoc, pageNumber]);

  if (error) {
    return (
      <div style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fee2e2', color: '#dc2626', fontSize: '0.75rem', padding: 8, textAlign: 'center', width: '100%', height: '100%' }}>
        ⚠️ Error rendering page {pageNumber}
      </div>
    );
  }

  return (
    <div style={{ ...style, position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#ffffff', overflow: 'hidden' }}>
      {loading && (
        <div className="spinner" style={{ position: 'absolute', width: 20, height: 20 }} />
      )}
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', objectFit: 'contain', display: loading ? 'none' : 'block' }} />
    </div>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const frontFileRef = useRef(null);
  const backFileRef = useRef(null);
  
  // URL Shop ID routing
  const [shopId, setShopId] = useState(null);
  const [shopName, setShopName] = useState('');
  const [shopCode, setShopCode] = useState('');
  const [isPrinterOnline, setIsPrinterOnline] = useState(false);
  const [loadingShop, setLoadingShop] = useState(true);

  // Manual shop selection input
  const [shopInput, setShopInput] = useState('');

  // Job config state
  const [files, setFiles] = useState([]);
  const [copies, setCopies] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [printMode, setPrintMode] = useState('manual');
  const [colorMode, setColorMode] = useState('bw');
  const [duplex, setDuplex] = useState(false);
  const [pageRange, setPageRange] = useState('');
  const [orientation, setOrientation] = useState('auto');
  const [fitMode, setFitMode] = useState('fit');
  const [paperSize, setPaperSize] = useState('A4');
  const [pagesPerSheet, setPagesPerSheet] = useState(1);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [layoutMode, setLayoutMode] = useState('document');
  const [frontFile, setFrontFile] = useState(null);
  const [backFile, setBackFile] = useState(null);
  const [bwSlabs, setBwSlabs] = useState([]);
  const [colorSlabs, setColorSlabs] = useState([]);

  // Preview System State Hooks
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pdfIsLandscape, setPdfIsLandscape] = useState(false);
  const [previewSheetIndex, setPreviewSheetIndex] = useState(0);
  const [fileUrls, setFileUrls] = useState([]);
  const [frontUrl, setFrontUrl] = useState(null);
  const [backUrl, setBackUrl] = useState(null);
  const [activePreviewIndex, setActivePreviewIndex] = useState(0);
  const [individualPageCounts, setIndividualPageCounts] = useState([]);

  // Cleanup object URLs and load PDFs on files or activePreviewIndex changes
  useEffect(() => {
    const urls = files.map(f => URL.createObjectURL(f));
    setFileUrls(urls);
    setPreviewSheetIndex(0); // reset sheet indicator
    
    const activeFile = files[activePreviewIndex];
    if (activeFile && activeFile.type === 'application/pdf') {
      loadPdfDocument(activeFile)
        .then(pdf => {
          setPdfDoc(pdf);
          pdf.getPage(1).then(page => {
            const viewport = page.getViewport({ scale: 1.0 });
            setPdfIsLandscape(viewport.width > viewport.height);
          }).catch((e) => console.warn("Failed to get page layout:", e));
        })
        .catch(err => {
          console.error("Error loading PDF for preview:", err);
          setPdfDoc(null);
        });
    } else {
      setPdfDoc(null);
      setPdfIsLandscape(false);
    }

    return () => {
      urls.forEach(u => URL.revokeObjectURL(u));
    };
  }, [files, activePreviewIndex]);

  // Aadhaar Front Object URL effect
  useEffect(() => {
    if (frontFile) {
      const url = URL.createObjectURL(frontFile);
      setFrontUrl(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setFrontUrl(null);
    }
  }, [frontFile]);

  // Aadhaar Back Object URL effect
  useEffect(() => {
    if (backFile) {
      const url = URL.createObjectURL(backFile);
      setBackUrl(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setBackUrl(null);
    }
  }, [backFile]);

  // UI States
  const [processingPdf, setProcessingPdf] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);

  const SHOP_CODE_REGEX = /^[A-Z]{3}\d{3}$/;

  // Extract shop param from path (/kiosk/:shopCode) or query param (?shop=...) and verify on mount
  useEffect(() => {
    let extractedShop = null;

    // 1. Try URL path (e.g. /kiosk/TST001)
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    const kioskIndex = pathParts.indexOf('kiosk');
    if (kioskIndex !== -1 && pathParts[kioskIndex + 1]) {
      extractedShop = pathParts[kioskIndex + 1];
    }

    // 2. Try query param ?shop=...
    if (!extractedShop) {
      const params = new URLSearchParams(window.location.search);
      extractedShop = params.get('shop');
    }
    
    if (!extractedShop) {
      setLoadingShop(false);
      return;
    }

    const cleanShop = extractedShop.trim().toUpperCase();
    setShopInput(cleanShop);

    async function loadShop() {
      try {
        // Try fetching without is_active filter so test shops work too
        const { data } = await supabase
          .from('shops')
          .select('id, name, shop_code, print_mode, bw_slabs, color_slabs')
          .eq('shop_code', cleanShop)
          .single();

        if (data) {
          setShopId(data.id); // CRITICAL: always use the real UUID as shopId for job submission
          setShopName(data.name);
          setShopCode(data.shop_code || cleanShop);
          setPrintMode(data.print_mode || 'manual');
          setBwSlabs(data.bw_slabs || []);
          setColorSlabs(data.color_slabs || []);
        } else {
          // Shop truly not in DB — warn user but still set shop_code as fallback
          setShopId(cleanShop);
          setShopCode(cleanShop);
          setShopName(`Print Hub (${cleanShop})`);
          setPrintMode('manual');
          setError(`Shop "${cleanShop}" not found. Contact the shopkeeper.`);
        }
      } catch (e) {
        setShopId(cleanShop);
        setShopCode(cleanShop);
        setShopName(`Print Hub (${cleanShop})`);
        setPrintMode('manual');
      } finally {
        setLoadingShop(false);
      }
    }

    loadShop();
  }, []);

  // Poll printer heartbeat status every 5 seconds if shop is loaded
  useEffect(() => {
    if (!shopId) return;

    async function checkPrinterStatus() {
      try {
        const { data, error } = await supabase
          .from('shops')
          .select('last_seen_at')
          .eq('id', shopId)
          .single();

        if (!error && data) {
          if (data.last_seen_at) {
            const lastSeen = new Date(data.last_seen_at).getTime();
            const timeDiff = Date.now() - lastSeen;
            setIsPrinterOnline(timeDiff < 60000); // 60 seconds threshold
          } else {
            setIsPrinterOnline(false);
          }
        }
      } catch (e) {
        console.error('Error polling printer status:', e);
      }
    }

    checkPrinterStatus();
    const interval = setInterval(checkPrinterStatus, 5000);

    return () => clearInterval(interval);
  }, [shopId]);

  // Handler for manual shop code submit
  function handleConnectShop(e) {
    e.preventDefault();
    const cleanId = shopInput.trim().toUpperCase();
    if (!cleanId) return;

    if (!SHOP_CODE_REGEX.test(cleanId)) {
      setError('Invalid format. Shop code must be exactly 3 uppercase letters and 3 digits (e.g. KRL004).');
      return;
    }
    
    // Reload the page with the shop parameter set
    window.location.href = `/?shop=${cleanId}`;
  }

  // File selection: Supports PDF, Word documents, and Images
  async function handleFileSelect(e) {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length === 0) return;

    const MAX_FILE_SIZE_BYTES = 30 * 1024 * 1024; // 30 MB

    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword'
    ];
    
    // Validate all files
    const invalidFiles = selectedFiles.filter(f => {
      const isPdf = f.type === 'application/pdf';
      const isWord = f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || f.type === 'application/msword' || f.name.endsWith('.docx') || f.name.endsWith('.doc');
      const isImage = f.type.startsWith('image/');
      return !isPdf && !isWord && !isImage;
    });

    if (invalidFiles.length > 0) {
      setError('Some files are unsupported. Supported formats: PDF, Word (DOCX/DOC), and Images.');
      setFiles([]);
      return;
    }

    // Validate file sizes
    const oversizedFiles = selectedFiles.filter(f => f.size > MAX_FILE_SIZE_BYTES);
    if (oversizedFiles.length > 0) {
      const names = oversizedFiles.map(f => f.name).join(', ');
      setError(`File too large (max 30 MB): ${names}`);
      setFiles([]);
      return;
    }

    setError('');
    setFiles([]);
    setProcessingPdf(true);

    try {
      let totalPages = 0;
      let unresolved = false;
      const counts = [];

      for (const f of selectedFiles) {
        const isPdf = f.type === 'application/pdf';
        const isImage = f.type.startsWith('image/');
        if (isPdf) {
          try {
            const pages = await getPdfPageCount(f);
            totalPages += pages;
            counts.push(pages);
          } catch (err) {
            console.warn('PDF page count failed for:', f.name, err);
            unresolved = true;
            counts.push(null);
          }
        } else if (isImage) {
          totalPages += 1;
          counts.push(1);
        } else {
          // Word docs (.docx/.doc) — read page count from the ZIP XML
          const isDocx = f.name.toLowerCase().endsWith('.docx') || f.name.toLowerCase().endsWith('.doc');
          if (isDocx) {
            try {
              const pages = await getDocxPageCount(f);
              if (pages) {
                totalPages += pages;
                counts.push(pages);
              } else {
                unresolved = true;
                counts.push(null);
              }
            } catch {
              unresolved = true;
              counts.push(null);
            }
          } else {
            unresolved = true;
            counts.push(null);
          }
        }
      }

      setPageCount(unresolved ? null : totalPages);
      setIndividualPageCounts(counts);
      setFiles(selectedFiles);
      setActivePreviewIndex(0);
    } catch (err) {
      console.error(err);
    } finally {
      setProcessingPdf(false);
    }
  }

  // Deletes an individual file from selection
  function handleRemoveFile(index, e) {
    if (e) e.stopPropagation();
    const newFiles = files.filter((_, i) => i !== index);
    const newCounts = individualPageCounts.filter((_, i) => i !== index);
    
    let totalPages = 0;
    let unresolved = false;
    newFiles.forEach((f, i) => {
      const count = newCounts[i];
      if (count === null || count === undefined) {
        unresolved = true;
      } else {
        totalPages += count;
      }
    });

    setPageCount(unresolved ? null : totalPages);
    setIndividualPageCounts(newCounts);
    setFiles(newFiles);
    
    // Adjust activePreviewIndex if it's now out of bounds
    if (activePreviewIndex >= newFiles.length) {
      setActivePreviewIndex(Math.max(0, newFiles.length - 1));
    }
  }

  // Job submission: Upload PDF and insert queue row
  async function handleSubmit(e) {
    e.preventDefault();
    if (uploading) return; // Prevent double-submit: two rapid taps would create duplicate jobs
    if (!shopId) return;
    if (layoutMode === 'document' && files.length === 0) return;
    if (layoutMode === 'id_card' && (!frontFile || !backFile)) {
      setError('Aadhaar mode requires both front and back side images.');
      return;
    }
    if (layoutMode === 'photo_grid' && files.length === 0) {
      setError('Photo grid mode requires at least one image file.');
      return;
    }

    // Large job warning check (only if page count is resolved and > 100)
    if (pageCount && pageCount > 100) {
      const confirmed = window.confirm(`These documents contain a total of ${pageCount} pages. Please confirm before submitting.`);
      if (!confirmed) {
        return;
      }
    }

    setError('');
    setUploading(true);

    try {
      if (layoutMode === 'document') {
        const submittedJobIds = [];
        
        for (const currentFile of files) {
          const jobId = crypto.randomUUID();
          const ext = currentFile.name.substring(currentFile.name.lastIndexOf('.')) || '.pdf';
          const storagePath = `jobs/${jobId}${ext}`;

          // 1. Upload file binary to Supabase Storage
          const { error: uploadErr } = await supabase.storage
            .from('print-jobs')
            .upload(storagePath, currentFile, {
              contentType: currentFile.type,
              upsert: true
            });

          if (uploadErr) {
            throw new Error(`Failed to upload file '${currentFile.name}' to queue. Please try again.`);
          }

          // Resolve page count of individual PDF
          let filePageCount = null;
          if (currentFile.type === 'application/pdf') {
            try {
              filePageCount = await getPdfPageCount(currentFile);
            } catch (err) {
              console.warn(err);
            }
          }

          // 2. Insert row to print_jobs
          const { error: dbErr } = await supabase
            .from('print_jobs')
            .insert({
              id: jobId,
              shop_id: shopId,
              file_path: storagePath,
              file_name: currentFile.name,
              copies: copies,
              page_count: filePageCount || Math.round((pageCount || 1) / files.length) || 1,
              status: printMode === 'auto' ? 'approved' : 'queued',
              color_mode: colorMode,
              duplex: duplex,
              page_range: pageRange || null,
              orientation: orientation,
              fit_mode: fitMode,
              layout_mode: 'document',
              paper_size: paperSize,
              pages_per_sheet: pagesPerSheet
            });

          if (dbErr) {
            // Cleanup storage file on db failure
            await supabase.storage.from('print-jobs').remove([storagePath]);
            throw new Error(`Failed to create queue job for '${currentFile.name}'. Please try again.`);
          }

          submittedJobIds.push(jobId);

          // Log job_created telemetry event
          supabase
            .from('events')
            .insert({
              shop_id: shopId,
              event_type: 'job_created',
              metadata: {
                job_id: jobId,
                copies: copies,
                color_mode: colorMode,
                duplex: duplex,
                file_name: currentFile.name,
                layout_mode: 'document',
                paper_size: paperSize,
                pages_per_sheet: pagesPerSheet
              }
            });
        }

        // Navigate to polling page with query string listing all files
        const firstId = submittedJobIds[0];
        navigate(`/status/${firstId}?jobs=${submittedJobIds.join(',')}`);
        return;
      } else if (layoutMode === 'photo_grid') {
        // Photo Grid mode: Upload all selected images
        const jobId = crypto.randomUUID();
        const firstImg = files[0];
        const ext = firstImg.name.substring(firstImg.name.lastIndexOf('.')) || '.jpg';
        const primaryStoragePath = `jobs/${jobId}_img_0${ext}`;
        
        const uploadedPaths = [];
        
        for (let idx = 0; idx < files.length; idx++) {
          const currentFile = files[idx];
          const curExt = currentFile.name.substring(currentFile.name.lastIndexOf('.')) || '.jpg';
          const storagePath = `jobs/${jobId}_img_${idx}${curExt}`;
          
          const { error: uploadErr } = await supabase.storage
            .from('print-jobs')
            .upload(storagePath, currentFile, {
              contentType: currentFile.type,
              upsert: true
            });
            
          if (uploadErr) {
            // Cleanup whatever was uploaded on error
            if (uploadedPaths.length > 0) {
              await supabase.storage.from('print-jobs').remove(uploadedPaths);
            }
            throw new Error(`Failed to upload grid image ${idx + 1}. Please try again.`);
          }
          uploadedPaths.push(storagePath);
        }
        
        // Insert queue row
        const { error: dbErr } = await supabase
          .from('print_jobs')
          .insert({
            id: jobId,
            shop_id: shopId,
            file_path: primaryStoragePath,
            file_name: `PhotoGrid_${jobId.substring(0, 4)}.pdf`,
            copies: copies,
            page_count: Math.ceil(files.length / pagesPerSheet), // Total sheets required for the photo grid
            status: printMode === 'auto' ? 'approved' : 'queued',
            color_mode: colorMode,
            duplex: duplex,
            page_range: null,
            orientation: 'portrait',
            fit_mode: 'fit',
            layout_mode: 'photo_grid',
            paper_size: paperSize,
            pages_per_sheet: pagesPerSheet
          });
          
        if (dbErr) {
          await supabase.storage.from('print-jobs').remove(uploadedPaths);
          throw new Error('Failed to create print job queue row. Please try again.');
        }
        
        // Telemetry
        supabase
          .from('events')
          .insert({
            shop_id: shopId,
            event_type: 'job_created',
            metadata: {
              job_id: jobId,
              copies: copies,
              color_mode: colorMode,
              duplex: duplex,
              file_name: `PhotoGrid_${jobId.substring(0, 4)}.pdf`,
              layout_mode: 'photo_grid',
              paper_size: paperSize,
              pages_per_sheet: pagesPerSheet
            }
          });
          
        navigate(`/status/${jobId}`);
        return;
      } else {
        // Aadhaar Stitch mode: Upload front & back files
        const jobId = crypto.randomUUID();
        const frontExt = frontFile.name.substring(frontFile.name.lastIndexOf('.')) || '.jpg';
        const backExt = backFile.name.substring(backFile.name.lastIndexOf('.')) || '.jpg';
        
        const frontPath = `jobs/${jobId}_front${frontExt}`;
        const backPath = `jobs/${jobId}_back${backExt}`;

        // Upload Front File
        const { error: frontErr } = await supabase.storage
          .from('print-jobs')
          .upload(frontPath, frontFile, {
            contentType: frontFile.type,
            upsert: true
          });

        if (frontErr) {
          throw new Error('Failed to upload Front image.');
        }

        // Upload Back File
        const { error: backErr } = await supabase.storage
          .from('print-jobs')
          .upload(backPath, backFile, {
            contentType: backFile.type,
            upsert: true
          });

        if (backErr) {
          // Cleanup front image
          await supabase.storage.from('print-jobs').remove([frontPath]);
          throw new Error('Failed to upload Back image.');
        }

        // 2. Insert row to print_jobs
        const { error: dbErr } = await supabase
          .from('print_jobs')
          .insert({
            id: jobId,
            shop_id: shopId,
            file_path: frontPath,
            file_name: `Aadhaar_${frontFile.name.substring(0, 15)}_Stitched.pdf`,
            copies: copies,
            page_count: 1, // Aadhaar stitching always outputs a single page A4
            status: printMode === 'auto' ? 'approved' : 'queued',
            color_mode: colorMode,
            duplex: duplex,
            page_range: null,
            orientation: 'portrait',
            fit_mode: 'fit',
            layout_mode: 'id_card'
          });

        if (dbErr) {
          // Cleanup storage files on db failure
          await supabase.storage.from('print-jobs').remove([frontPath, backPath]);
          throw new Error('Failed to create queue job. Please try again.');
        }

        // Log job_created telemetry event
        supabase
          .from('events')
          .insert({
            shop_id: shopId,
            event_type: 'job_created',
            metadata: {
              job_id: jobId,
              copies: copies,
              color_mode: colorMode,
              duplex: duplex,
              file_name: `Aadhaar_Stitched_${jobId}.pdf`,
              layout_mode: 'id_card'
            }
          })
          .then(({ error: telemetryErr }) => {
            if (telemetryErr) {
              console.error('Failed to log job_created telemetry:', telemetryErr);
            }
          });

        // Navigate to polling page
        navigate(`/status/${jobId}`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  if (loadingShop) {
    return (
      <main className="page">
        <div className="spinner lg" />
        <p className="load-text">Loading shop profile...</p>
      </main>
    );
  }

  // Fallback: If no shop code is entered, show a beautiful connection screen
  if (!shopId && !error) {
    return (
      <main className="page" style={{ justifyContent: 'center', padding: 24 }}>
        <div className="details-card" style={{ padding: 24, width: '100%', maxWidth: 400 }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: '700', color: 'var(--text)', marginBottom: 6 }}>
            Welcome to AutoPrint
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 20 }}>
            Enter the shop code to connect to a kiosk printer.
          </p>

          <form onSubmit={handleConnectShop}>
            <input
              type="text"
              placeholder="e.g. KRL004"
              value={shopInput}
              onChange={(e) => setShopInput(e.target.value)}
              style={{
                width: '100%',
                height: 42,
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'rgba(255,255,255,0.02)',
                color: 'var(--text)',
                padding: '0 12px',
                fontSize: '0.9rem',
                marginBottom: 16,
                boxSizing: 'border-box'
              }}
            />
            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', height: 42, fontWeight: 'bold' }}
            >
              Connect to Printer
            </button>
          </form>
        </div>
      </main>
    );
  }

  if (error && !shopId) {
    return (
      <main className="page" style={{ justifyContent: 'center', alignItems: 'center', padding: 20 }}>
        <div className="status-icon-circle" style={{ borderColor: 'var(--error)', background: 'var(--error-dim)' }}>
          <span style={{ fontSize: '2rem', color: 'var(--error)' }}>✗</span>
        </div>
        <p style={{ color: 'var(--error)', fontWeight: '600', marginTop: 16, textAlign: 'center' }}>
          {error}
        </p>
        <button className="btn btn-secondary" style={{ marginTop: 20 }} onClick={() => window.location.href = '/'}>
          Try Again
        </button>
      </main>
    );
  }

  const getEstimatedPriceDetails = () => {
    // 1. Calculate total printed pages/sheets
    let totalPages = 1;
    if (layoutMode === 'document') {
      totalPages = (pageCount || 1) * copies;
    } else if (layoutMode === 'id_card') {
      totalPages = 1 * copies;
    } else if (layoutMode === 'photo_grid') {
      totalPages = Math.ceil(files.length / (pagesPerSheet || 4)) * copies;
    }

    // 2. Resolve active slabs array
    const slabs = colorMode === 'color' ? colorSlabs : bwSlabs;
    
    // 3. Find matching slab
    let matchedRate = colorMode === 'color' ? (duplex ? 9.0 : 10.0) : (duplex ? 1.8 : 2.0); // standard default fallbacks
    if (slabs && slabs.length > 0) {
      const match = slabs.find(s => {
        const minVal = s.min ?? 1;
        const maxVal = s.max;
        return totalPages >= minVal && (maxVal === null || maxVal === undefined || totalPages <= maxVal);
      });
      if (match) {
        matchedRate = (duplex && match.duplex_rate !== undefined) ? match.duplex_rate : match.rate;
      } else {
        const lastSlab = slabs[slabs.length - 1];
        matchedRate = (duplex && lastSlab.duplex_rate !== undefined) ? lastSlab.duplex_rate : lastSlab.rate;
      }
    }

    const estimatedTotal = totalPages * matchedRate;
    return {
      totalPages,
      rate: matchedRate,
      total: estimatedTotal.toFixed(2)
    };
  };

  // Helper to render the layout preview map
  const renderLayoutPreview = () => {
    const getPaperAspectRatio = (size, isLandscape) => {
      const isLegal = size.toLowerCase() === 'legal';
      if (isLandscape) {
        return isLegal ? 1.647 : 1.414;
      } else {
        return isLegal ? 0.607 : 0.707;
      }
    };

    const isLandscape = layoutMode === 'document' && (
      orientation === 'landscape' || (orientation === 'auto' && pdfIsLandscape)
    );

    const ratio = getPaperAspectRatio(paperSize, isLandscape);

    const getGridDimensions = (n, isLandscape) => {
      if (n === 2) {
        return isLandscape ? { cols: 2, rows: 1 } : { cols: 1, rows: 2 };
      }
      if (n === 4) {
        return { cols: 2, rows: 2 };
      }
      if (n === 6) {
        return isLandscape ? { cols: 3, rows: 2 } : { cols: 2, rows: 3 };
      }
      if (n === 9) {
        return { cols: 3, rows: 3 };
      }
      if (n === 16) {
        return { cols: 4, rows: 4 };
      }
      return { cols: 1, rows: 1 };
    };

    const { cols, rows } = layoutMode === 'id_card'
      ? { cols: 1, rows: 2 }
      : getGridDimensions(pagesPerSheet, isLandscape);

    const containerStyle = {
      width: '100%',
      maxWidth: isLandscape ? '320px' : '240px',
      aspectRatio: `${ratio}`,
      background: '#ffffff',
      borderRadius: 6,
      boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
      border: '1px solid var(--border)',
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gridTemplateRows: `repeat(${rows}, 1fr)`,
      gap: '8px',
      padding: '12px',
      boxSizing: 'border-box',
      position: 'relative',
      margin: '0 auto',
      transition: 'all 0.3s ease'
    };

    const cardContainerStyle = {
      border: '1px dashed #cbd5e1',
      borderRadius: 6,
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#f8fafc',
      overflow: 'hidden',
      position: 'relative',
      padding: 4,
      boxSizing: 'border-box'
    };

    // Helper for rendering preview titles
    const getPreviewTitle = () => {
      if (layoutMode === 'id_card') return 'Aadhaar / ID Card Layout';
      if (layoutMode === 'photo_grid') return 'Photo Grid Layout';
      return 'Document Layout';
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, margin: '16px 0', width: '100%' }}>
        <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-muted)' }}>
          {getPreviewTitle()} ({paperSize} Sheet - {isLandscape ? 'Landscape' : 'Portrait'})
        </span>

        {/* Horizontal scrollable tab row for document selection */}
        {(layoutMode === 'document' || layoutMode === 'photo_grid') && files.length > 1 && (
          <div style={{
            display: 'flex',
            gap: '8px',
            width: '100%',
            overflowX: 'auto',
            padding: '4px 0 12px 0',
            borderBottom: '1px solid var(--border)',
            marginBottom: '8px',
            scrollbarWidth: 'thin'
          }} className="smooth-scroll">
            {files.map((file, idx) => {
              const isActive = idx === activePreviewIndex;
              const isPdf = file.type === 'application/pdf';
              const isWord = file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || file.type === 'application/msword' || file.name.endsWith('.docx') || file.name.endsWith('.doc');
              const isImg = file.type.startsWith('image/');
              
              let fileIcon = '📄';
              if (isImg) fileIcon = '🖼️';
              if (isWord) fileIcon = '📝';

              const pCount = individualPageCounts[idx];
              let pCountStr = '';
              if (pCount !== null && pCount !== undefined) {
                pCountStr = `${pCount}p`;
              } else if (isWord) {
                pCountStr = 'Word';
              } else {
                pCountStr = '?';
              }

              return (
                <div
                  key={idx}
                  onClick={() => setActivePreviewIndex(idx)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    borderRadius: '20px',
                    background: isActive ? 'var(--primary-dim)' : 'var(--bg-card)',
                    border: isActive ? '1px solid var(--primary-light)' : '1px solid var(--border)',
                    color: isActive ? 'var(--text)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: '0.78rem',
                    fontWeight: isActive ? 'bold' : '500',
                    transition: 'all 0.2s ease',
                    whiteSpace: 'nowrap',
                    userSelect: 'none'
                  }}
                  title={file.name}
                >
                  <span>{fileIcon}</span>
                  <span style={{
                    maxWidth: '100px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {file.name}
                  </span>
                  <span style={{
                    fontSize: '0.68rem',
                    color: isActive ? 'var(--primary-light)' : 'var(--text-muted)',
                    background: 'rgba(255,255,255,0.03)',
                    padding: '2px 6px',
                    borderRadius: '10px'
                  }}>
                    {pCountStr}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => handleRemoveFile(idx, e)}
                    style={{
                      border: 'none',
                      background: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      fontSize: '0.9rem',
                      fontWeight: 'bold',
                      padding: '0 2px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '50%',
                      width: '14px',
                      height: '14px',
                      marginLeft: '2px',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {layoutMode === 'id_card' && (
          <div style={containerStyle}>
            <div style={cardContainerStyle}>
              {frontUrl ? (
                <img src={frontUrl} alt="Aadhaar Front" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              ) : (
                <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: '600', textAlign: 'center' }}>
                  💳 Aadhaar Front Side
                  <span style={{ display: 'block', fontSize: '0.65rem', color: '#cbd5e1', fontWeight: 'normal', marginTop: 4 }}>
                    (Image not selected)
                  </span>
                </div>
              )}
            </div>
            <div style={cardContainerStyle}>
              {backUrl ? (
                <img src={backUrl} alt="Aadhaar Back" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              ) : (
                <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: '600', textAlign: 'center' }}>
                  💳 Aadhaar Back Side
                  <span style={{ display: 'block', fontSize: '0.65rem', color: '#cbd5e1', fontWeight: 'normal', marginTop: 4 }}>
                    (Image not selected)
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {layoutMode === 'photo_grid' && (() => {
          const totalSheets = Math.ceil(files.length / pagesPerSheet) || 1;

          return (
            <div style={{
              width: '100%',
              maxHeight: '380px',
              overflowY: 'auto',
              padding: '10px 4px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              alignItems: 'center',
              background: 'rgba(0, 0, 0, 0.2)',
              borderRadius: '8px',
              border: '1px solid var(--border)'
            }} className="smooth-scroll">
              {Array.from({ length: totalSheets }).map((_, sheetIdx) => {
                const startIndex = sheetIdx * pagesPerSheet;

                return (
                  <div key={sheetIdx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: '100%' }}>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', fontWeight: 'bold' }}>
                      Sheet {sheetIdx + 1} of {totalSheets}
                    </span>
                    <div style={containerStyle}>
                      {Array.from({ length: pagesPerSheet }).map((_, idx) => {
                        const imgIdx = startIndex + idx;
                        const hasImage = imgIdx < fileUrls.length;

                        return (
                          <div key={idx} style={{
                            border: '1px solid #e2e8f0',
                            background: '#f8fafc',
                            borderRadius: 4,
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            overflow: 'hidden',
                            position: 'relative'
                          }}>
                            {hasImage ? (
                              <img
                                src={fileUrls[imgIdx]}
                                alt={`Grid ${imgIdx}`}
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              />
                            ) : (
                              <span style={{ fontSize: '0.65rem', color: '#cbd5e1', fontWeight: 'bold' }}>
                                Slot {imgIdx + 1}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {layoutMode === 'document' && (() => {
          if (files.length === 0) {
            return (
              <div style={containerStyle}>
                <div style={{
                  border: '1px dashed var(--border)',
                  borderRadius: 4,
                  height: '100%',
                  width: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.8rem',
                  color: 'var(--text-muted)',
                  padding: 12,
                  textAlign: 'center',
                  boxSizing: 'border-box'
                }}>
                  📄 No documents selected.<br />
                  Select files to view layout.
                </div>
              </div>
            );
          }

          const activeFile = files[activePreviewIndex] || files[0];
          const isPdf = activeFile.type === 'application/pdf';
          const isImage = activeFile.type.startsWith('image/');

          if (isPdf) {
            if (!pdfDoc) {
              return (
                <div style={containerStyle}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', width: '100%', gap: 8 }}>
                    <div className="spinner" style={{ width: 24, height: 24 }} />
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Parsing document pages...</span>
                  </div>
                </div>
              );
            }

            const totalPages = pdfDoc.numPages;
            const totalSheets = Math.ceil(totalPages / pagesPerSheet);

            return (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, width: '100%' }}>
                <div style={{
                  width: '100%',
                  maxHeight: '380px',
                  overflowY: 'auto',
                  padding: '10px 4px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                  alignItems: 'center',
                  background: 'rgba(0, 0, 0, 0.2)',
                  borderRadius: '8px',
                  border: '1px solid var(--border)'
                }} className="smooth-scroll">
                  {Array.from({ length: totalSheets }).map((_, sheetIdx) => {
                    const startIndex = sheetIdx * pagesPerSheet + 1;

                    return (
                      <div key={sheetIdx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: '100%' }}>
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', fontWeight: 'bold' }}>
                          Sheet {sheetIdx + 1} of {totalSheets}
                        </span>
                        <div style={containerStyle}>
                          {Array.from({ length: pagesPerSheet }).map((_, idx) => {
                            const pageNum = startIndex + idx;
                            const hasPage = pageNum <= totalPages;

                            return (
                              <div key={idx} style={{
                                border: '1px solid #e2e8f0',
                                background: '#f8fafc',
                                borderRadius: 4,
                                height: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                overflow: 'hidden',
                                position: 'relative'
                              }}>
                                {hasPage ? (
                                  <PdfPageCanvas pdfDoc={pdfDoc} pageNumber={pageNum} />
                                ) : (
                                  <span style={{ fontSize: '0.65rem', color: '#cbd5e1', fontWeight: 'bold' }}>
                                    Blank Slot
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          } else if (isImage) {
            return (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, width: '100%' }}>
                <div style={containerStyle}>
                  {Array.from({ length: pagesPerSheet }).map((_, idx) => (
                    <div key={idx} style={{
                      border: '1px solid #e2e8f0',
                      background: '#f8fafc',
                      borderRadius: 4,
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                      position: 'relative'
                    }}>
                      {idx === 0 && fileUrls[activePreviewIndex] ? (
                        <img
                          src={fileUrls[activePreviewIndex]}
                          alt="Uploaded Image preview"
                          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                        />
                      ) : (
                        <span style={{ fontSize: '0.65rem', color: '#cbd5e1', fontWeight: 'bold' }}>
                          Blank Slot
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          } else {
            return (
              <div style={containerStyle}>
                <div style={{
                  border: '1px dashed var(--border)',
                  borderRadius: 4,
                  height: '100%',
                  width: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.85rem',
                  color: 'var(--text-muted)',
                  padding: 16,
                  textAlign: 'center',
                  boxSizing: 'border-box'
                }}>
                  <FileIcon size={36} color="var(--text-muted)" style={{ marginBottom: 12 }} />
                  <div style={{ fontWeight: 'bold', color: 'var(--text)', marginBottom: 4 }}>
                    {activeFile.name}
                  </div>
                  <div style={{ fontSize: '0.75rem' }}>
                    Word documents cannot be previewed directly in the browser.<br />
                    It will print correctly as formatted.
                  </div>
                </div>
              </div>
            );
          }
        })()}
      </div>
    );
  };

  return (
    <main className="page">
      <header style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: '700', color: 'var(--text)', margin: 0 }}>
            Printing Station {shopCode ? `— ${shopCode}` : ''}
          </h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
            Configure and upload your document.
          </p>
        </div>

        {/* Live Printer Connection Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 12, background: 'var(--bg-card)', border: '1px solid var(--border)', marginTop: 2 }}>
          <span style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: isPrinterOnline ? 'var(--primary-light)' : 'var(--error)'
          }} />
          <span style={{ fontSize: '0.75rem', fontWeight: '600', color: isPrinterOnline ? 'var(--text)' : 'var(--error)' }}>
            Printer: {isPrinterOnline ? 'Ready' : 'Offline'}
          </span>
        </div>
      </header>

      {/* Printer Offline Warning Banner */}
      {!isPrinterOnline && (
        <div style={{
          background: 'rgba(255, 59, 48, 0.08)',
          border: '1px solid var(--error)',
          borderRadius: 8,
          padding: 12,
          marginBottom: 20,
          fontSize: '0.82rem',
          color: 'var(--error)'
        }}>
          ⚠️ <strong>Printer is currently offline.</strong> You can still submit your document to the queue, but it will only print when the shopkeeper activates the agent.
        </div>
      )}

      {/* Preset Mode Tabs */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <button
          type="button"
          onClick={() => { setLayoutMode('document'); setError(''); setFiles([]); setFrontFile(null); setBackFile(null); setPagesPerSheet(1); setPreviewSheetIndex(0); }}
          style={{
            flex: 1,
            padding: '10px 14px',
            borderRadius: 8,
            border: layoutMode === 'document' ? '2px solid var(--primary-light, #06B6D4)' : '1px solid var(--border)',
            background: layoutMode === 'document' ? 'var(--primary-dim)' : 'var(--bg-raised, #1c1c1e)',
            color: 'var(--text)',
            fontWeight: '600',
            fontSize: '0.85rem',
            cursor: 'pointer',
            textAlign: 'center'
          }}
        >
          📄 Standard Document
        </button>
        <button
          type="button"
          onClick={() => { setLayoutMode('id_card'); setError(''); setFiles([]); setFrontFile(null); setBackFile(null); setPagesPerSheet(1); setPreviewSheetIndex(0); }}
          style={{
            flex: 1,
            padding: '10px 14px',
            borderRadius: 8,
            border: layoutMode === 'id_card' ? '2px solid var(--primary-light, #06B6D4)' : '1px solid var(--border)',
            background: layoutMode === 'id_card' ? 'var(--primary-dim)' : 'var(--bg-raised, #1c1c1e)',
            color: 'var(--text)',
            fontWeight: '600',
            fontSize: '0.85rem',
            cursor: 'pointer',
            textAlign: 'center'
          }}
        >
          🪪 Aadhaar / ID Card
        </button>
        <button
          type="button"
          onClick={() => { setLayoutMode('photo_grid'); setError(''); setFiles([]); setFrontFile(null); setBackFile(null); setPagesPerSheet(4); setPreviewSheetIndex(0); }}
          style={{
            flex: 1,
            padding: '10px 14px',
            borderRadius: 8,
            border: layoutMode === 'photo_grid' ? '2px solid var(--primary-light, #06B6D4)' : '1px solid var(--border)',
            background: layoutMode === 'photo_grid' ? 'var(--primary-dim)' : 'var(--bg-raised, #1c1c1e)',
            color: 'var(--text)',
            fontWeight: '600',
            fontSize: '0.85rem',
            cursor: 'pointer',
            textAlign: 'center'
          }}
        >
          🖼️ Photo Grid
        </button>
      </div>

      {/* Upload Zone */}
      {layoutMode === 'document' && (
        <div
          className={`upload-zone ${files.length > 0 ? 'has-file' : ''}`}
          onClick={() => fileRef.current?.click()}
        >
          <input
            type="file"
            ref={fileRef}
            multiple
            accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,image/*"
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />
          {processingPdf ? (
            <>
              <div className="spinner" />
              <p className="load-text">Analyzing document pages...</p>
            </>
          ) : files.length > 0 ? (
            <>
              <div className="upload-icon-wrap" style={{ background: 'var(--primary-dim)' }}>
                <FileIcon size={28} color="var(--primary-light)" />
              </div>
              <p className="upload-title" style={{ wordBreak: 'break-all', padding: '0 8px', fontWeight: 'bold' }}>
                {files.length === 1 ? files[0].name : `${files.length} files selected`}
              </p>
              {files.length > 1 && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 60, overflowY: 'auto', margin: '4px 0', padding: '0 12px', width: '100%', boxSizing: 'border-box' }}>
                  {files.map((f, i) => (
                    <span key={i} style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', display: 'block' }}>
                      📄 {f.name}
                    </span>
                  ))}
                </div>
              )}
              <p className="upload-hint">
                {pageCount === null || pageCount === undefined ? 'Unknown pages total' : `${pageCount} page${pageCount > 1 ? 's' : ''} total`}
              </p>
              <button className="upload-btn" type="button" style={{ background: 'var(--bg-card)', color: 'var(--text)' }}>
                Change Files
              </button>
            </>
          ) : (
            <>
              <div className="upload-icon-wrap"><UploadIcon size={28} /></div>
              <p className="upload-title">Select Documents</p>
              <p className="upload-hint">Tap to browse files (Maximum 20MB)</p>
              <button className="upload-btn" type="button">Choose Files</button>
            </>
          )}
        </div>
      )}

      {layoutMode === 'id_card' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Front Side Upload */}
          <div
            className={`upload-zone ${frontFile ? 'has-file' : ''}`}
            onClick={() => frontFileRef.current?.click()}
            style={{ minHeight: 100, padding: '16px' }}
          >
            <input
              type="file"
              ref={frontFileRef}
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                const sel = e.target.files?.[0];
                if (sel && sel.type.startsWith('image/')) {
                  setFrontFile(sel);
                  setError('');
                } else if (sel) {
                  setError('Aadhaar layout requires image files only.');
                }
              }}
            />
            {frontFile ? (
              <>
                <p className="upload-title" style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>✓ Aadhaar Front: {frontFile.name}</p>
                <button className="upload-btn" type="button" style={{ height: 26, fontSize: '0.75rem', padding: '0 8px', width: 'auto' }}>Change Front Image</button>
              </>
            ) : (
              <>
                <p className="upload-title" style={{ fontSize: '0.85rem' }}>📤 Select Aadhaar Front Side Image</p>
                <p className="upload-hint" style={{ fontSize: '0.7rem' }}>JPG, PNG, WebP supported</p>
              </>
            )}
          </div>

          {/* Back Side Upload */}
          <div
            className={`upload-zone ${backFile ? 'has-file' : ''}`}
            onClick={() => backFileRef.current?.click()}
            style={{ minHeight: 100, padding: '16px' }}
          >
            <input
              type="file"
              ref={backFileRef}
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                const sel = e.target.files?.[0];
                if (sel && sel.type.startsWith('image/')) {
                  setBackFile(sel);
                  setError('');
                } else if (sel) {
                  setError('Aadhaar layout requires image files only.');
                }
              }}
            />
            {backFile ? (
              <>
                <p className="upload-title" style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>✓ Aadhaar Back: {backFile.name}</p>
                <button className="upload-btn" type="button" style={{ height: 26, fontSize: '0.75rem', padding: '0 8px', width: 'auto' }}>Change Back Image</button>
              </>
            ) : (
              <>
                <p className="upload-title" style={{ fontSize: '0.85rem' }}>📤 Select Aadhaar Back Side Image</p>
                <p className="upload-hint" style={{ fontSize: '0.7rem' }}>JPG, PNG, WebP supported</p>
              </>
            )}
          </div>
        </div>
      )}

      {layoutMode === 'photo_grid' && (
        <div
          className={`upload-zone ${files.length > 0 ? 'has-file' : ''}`}
          onClick={() => fileRef.current?.click()}
        >
          <input
            type="file"
            ref={fileRef}
            multiple
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />
          {files.length > 0 ? (
            <>
              <div className="upload-icon-wrap" style={{ background: 'var(--primary-dim)' }}>
                <FileIcon size={28} color="var(--primary-light)" />
              </div>
              <p className="upload-title" style={{ wordBreak: 'break-all', padding: '0 8px', fontWeight: 'bold' }}>
                {files.length === 1 ? files[0].name : `${files.length} images selected`}
              </p>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 80, overflowY: 'auto', margin: '4px 0', padding: '0 12px', width: '100%', boxSizing: 'border-box' }}>
                {files.map((f, i) => (
                  <span key={i} style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', display: 'block', color: 'var(--text-muted)' }}>
                    🖼️ {f.name}
                  </span>
                ))}
              </div>
              <p className="upload-hint" style={{ fontWeight: '500' }}>
                Image Count: {files.length} | Images Per Page: {pagesPerSheet} | Sheets Required: {Math.ceil(files.length / pagesPerSheet)}
              </p>
              <button className="upload-btn" type="button" style={{ background: 'var(--bg-card)', color: 'var(--text)' }}>
                Change Images
              </button>
            </>
          ) : (
            <>
              <div className="upload-icon-wrap"><UploadIcon size={28} /></div>
              <p className="upload-title">Select Grid Images</p>
              <p className="upload-hint">Upload images for the photo grid</p>
              <button className="upload-btn" type="button">Choose Images</button>
            </>
          )}
        </div>
      )}

      {/* Guide Section */}
      <div style={{
        marginTop: 16,
        borderRadius: 8,
        border: '1px solid var(--border, rgba(255,255,255,0.1))',
        background: 'var(--bg-card, rgba(255,255,255,0.02))',
        padding: '10px 14px',
        fontSize: '0.85rem',
        cursor: 'pointer'
      }} onClick={() => setGuideOpen(!guideOpen)}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: '600', color: 'var(--text)' }}>
          <span>📋 Can't find your PDF?</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{guideOpen ? 'Hide ▲' : 'Show ▼'}</span>
        </div>
        {guideOpen && (
          <div style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: '0.8rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 8 }} onClick={(e) => e.stopPropagation()}>
            <p style={{ margin: '0 0 6px 0', fontWeight: '500' }}>Check these folders on your device:</p>
            <ul style={{ margin: '0 0 8px 0', paddingLeft: 16 }}>
              <li><strong>Downloads</strong></li>
              <li><strong>Documents</strong></li>
              <li><strong>WhatsApp Documents</strong></li>
            </ul>
            <div style={{ background: 'rgba(255,255,255,0.03)', padding: 8, borderRadius: 6, fontSize: '0.75rem', border: '1px dashed rgba(255,255,255,0.05)' }}>
              <strong>WhatsApp Path:</strong><br />
              <code style={{ display: 'block', marginTop: 4, background: 'rgba(0,0,0,0.2)', padding: 4, borderRadius: 4, wordBreak: 'break-all' }}>
                Android/media/com.whatsapp/WhatsApp/Documents
              </code>
            </div>
          </div>
        )}
      </div>

      {error && (
        <p style={{ color: 'var(--error)', fontSize: '0.82rem', marginTop: 8, textAlign: 'center', fontWeight: '500' }}>
          {error}
        </p>
      )}

      {/* Options Form */}
      {(files.length > 0 || (frontFile && backFile)) && (
        <form onSubmit={handleSubmit} style={{ marginTop: 20, width: '100%' }}>
          
          {/* Photo Grid Clarity Summary Banner */}
          {layoutMode === 'photo_grid' && files.length > 0 && (
            <div style={{
              background: 'rgba(6, 182, 212, 0.08)',
              border: '1px solid var(--primary-light, #06B6D4)',
              borderRadius: 8,
              padding: 14,
              marginBottom: 16,
              fontSize: '0.85rem',
              color: 'var(--text)'
            }}>
              <div style={{ fontWeight: 'bold', fontSize: '0.9rem', marginBottom: 8, color: 'var(--primary-light, #06B6D4)' }}>
                🖼️ Photo Layout Configuration
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 4 }}>
                <div><strong>{files.length} Images Uploaded</strong></div>
                <div><strong>{pagesPerSheet} Images Per Page</strong></div>
                <div><strong>{Math.ceil(files.length / pagesPerSheet)} Sheets Required</strong></div>
                <div style={{ marginTop: 2 }}>Paper Size: <strong>{paperSize}</strong></div>
                <div>Estimated Cost: <strong style={{ color: 'var(--primary-light, #06B6D4)' }}>₹{getEstimatedPriceDetails().total}</strong></div>
              </div>
            </div>
          )}

          <div className="details-card" style={{ marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {renderLayoutPreview()}
            
            <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '0 0 8px 0' }} />

            {/* Copies row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '4px 0' }}>
              <span style={{ fontWeight: '600', color: 'var(--text)', fontSize: '0.9rem' }}>Copies</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button
                  type="button"
                  onClick={() => setCopies(Math.max(1, copies - 1))}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    border: '1px solid var(--border)',
                    background: 'var(--bg-card)',
                    color: 'var(--text)',
                    fontSize: '1.2rem',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                >
                  -
                </button>
                <span style={{ fontSize: '1.1rem', fontWeight: '600', minWidth: 20, textAlign: 'center' }}>
                  {copies}
                </span>
                <button
                  type="button"
                  onClick={() => setCopies(copies + 1)}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    border: '1px solid var(--border)',
                    background: 'var(--bg-card)',
                    color: 'var(--text)',
                    fontSize: '1.2rem',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                >
                  +
                </button>
              </div>
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: 0 }} />

            {/* Color Mode Select */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '4px 0' }}>
              <span style={{ fontWeight: '600', color: 'var(--text)', fontSize: '0.9rem' }}>Color Mode</span>
              <select
                value={colorMode}
                onChange={(e) => setColorMode(e.target.value)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-card)',
                  color: 'var(--text)',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  outline: 'none'
                }}
              >
                <option value="bw">Black & White</option>
                <option value="color">Color</option>
              </select>
            </div>

            {/* Duplex Select (Only for document mode) */}
            {layoutMode === 'document' && (
              <>
                <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: 0 }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '4px 0' }}>
                  <span style={{ fontWeight: '600', color: 'var(--text)', fontSize: '0.9rem' }}>Sides</span>
                  <select
                    value={duplex ? 'double' : 'single'}
                    onChange={(e) => setDuplex(e.target.value === 'double')}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-card)',
                      color: 'var(--text)',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      outline: 'none'
                    }}
                  >
                    <option value="single">Single Side</option>
                    <option value="double">Double Side (Duplex)</option>
                  </select>
                </div>
              </>
            )}
            {layoutMode === 'photo_grid' && (
              <>
                <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: 0 }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '4px 0' }}>
                  <span style={{ fontWeight: '600', color: 'var(--text)', fontSize: '0.9rem' }}>Images Per Page</span>
                  <select
                    value={pagesPerSheet}
                    onChange={(e) => { setPagesPerSheet(parseInt(e.target.value, 10)); setPreviewSheetIndex(0); }}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-card)',
                      color: 'var(--text)',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      outline: 'none'
                    }}
                  >
                    <option value={1}>1 Image</option>
                    <option value={2}>2 Images</option>
                    <option value={4}>4 Images</option>
                    <option value={6}>6 Images</option>
                    <option value={9}>9 Images</option>
                    <option value={16}>16 Images</option>
                  </select>
                </div>

                <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: 0 }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '4px 0' }}>
                  <span style={{ fontWeight: '600', color: 'var(--text)', fontSize: '0.9rem' }}>Paper Size</span>
                  <select
                    value={paperSize}
                    onChange={(e) => setPaperSize(e.target.value)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-card)',
                      color: 'var(--text)',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      outline: 'none'
                    }}
                  >
                    <option value="A4">A4</option>
                    <option value="A3">A3</option>
                    <option value="legal">Legal</option>
                  </select>
                </div>
              </>
            )}
          </div>

          {/* Advanced Settings Section (Only for document mode) */}
          {layoutMode === 'document' && (
            <div style={{ marginBottom: 20 }}>
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--primary-light, #06B6D4)',
                  fontSize: '0.85rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: 0
                }}
              >
                <span>{showAdvanced ? '⚙️ Hide Advanced Settings' : '⚙️ Show Advanced Settings'}</span>
              </button>

              {showAdvanced && (
                <div className="details-card" style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {/* Page Range (Only for standard document) */}
                  {layoutMode === 'document' && (
                    <>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span style={{ fontWeight: '600', color: 'var(--text)', fontSize: '0.9rem' }}>Page Range</span>
                        <input
                          type="text"
                          placeholder="e.g. 1-5, 8, 11-15 (Leave blank for all)"
                          value={pageRange}
                          onChange={(e) => setPageRange(e.target.value)}
                          style={{
                            height: 38,
                            borderRadius: 6,
                            border: '1px solid var(--border)',
                            background: 'var(--bg-card)',
                            color: 'var(--text)',
                            padding: '0 10px',
                            fontSize: '0.85rem',
                            outline: 'none'
                          }}
                        />
                      </div>
                      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: 0 }} />
                    </>
                  )}

                  {/* Orientation select (Only for standard document) */}
                  {layoutMode === 'document' && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                        <span style={{ fontWeight: '600', color: 'var(--text)', fontSize: '0.9rem' }}>Orientation</span>
                        <select
                          value={orientation}
                          onChange={(e) => setOrientation(e.target.value)}
                          style={{
                            padding: '6px 12px',
                            borderRadius: 6,
                            border: '1px solid var(--border)',
                            background: 'var(--bg-card)',
                            color: 'var(--text)',
                            fontSize: '0.85rem',
                            cursor: 'pointer',
                            outline: 'none'
                          }}
                        >
                          <option value="auto">Auto-Detect</option>
                          <option value="portrait">Portrait</option>
                          <option value="landscape">Landscape</option>
                        </select>
                      </div>
                      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: 0 }} />
                    </>
                  )}

                  {/* Sizing & scale select (Only for standard document) */}
                  {layoutMode === 'document' && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                        <span style={{ fontWeight: '600', color: 'var(--text)', fontSize: '0.9rem' }}>Page Sizing</span>
                        <select
                          value={fitMode}
                          onChange={(e) => setFitMode(e.target.value)}
                          style={{
                            padding: '6px 12px',
                            borderRadius: 6,
                            border: '1px solid var(--border)',
                            background: 'var(--bg-card)',
                            color: 'var(--text)',
                            fontSize: '0.85rem',
                            cursor: 'pointer',
                            outline: 'none'
                          }}
                        >
                          <option value="fit">Fit to Printable Area</option>
                          <option value="shrink">Shrink Oversized Pages</option>
                          <option value="noscale">Actual Size (No Scaling)</option>
                        </select>
                      </div>
                      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: 0 }} />
                    </>
                  )}

                  {/* Paper Size select */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <span style={{ fontWeight: '600', color: 'var(--text)', fontSize: '0.9rem' }}>Paper Size</span>
                    <select
                      value={paperSize}
                      onChange={(e) => setPaperSize(e.target.value)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 6,
                        border: '1px solid var(--border)',
                        background: 'var(--bg-card)',
                        color: 'var(--text)',
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                        outline: 'none'
                      }}
                    >
                      <option value="A4">A4</option>
                      <option value="A3">A3</option>
                      <option value="legal">Legal</option>
                    </select>
                  </div>

                  <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: 0 }} />

                  {/* Pages Per Sheet / Images Per Page select */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <span style={{ fontWeight: '600', color: 'var(--text)', fontSize: '0.9rem' }}>
                      {layoutMode === 'photo_grid' ? 'Images Per Page' : 'Pages Per Sheet'}
                    </span>
                    <select
                      value={pagesPerSheet}
                      onChange={(e) => { setPagesPerSheet(parseInt(e.target.value, 10)); setPreviewSheetIndex(0); }}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 6,
                        border: '1px solid var(--border)',
                        background: 'var(--bg-card)',
                        color: 'var(--text)',
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                        outline: 'none'
                      }}
                    >
                      <option value={1}>{layoutMode === 'photo_grid' ? '1 Image' : '1 Page'}</option>
                      <option value={2}>{layoutMode === 'photo_grid' ? '2 Images' : '2 Pages'}</option>
                      <option value={4}>{layoutMode === 'photo_grid' ? '4 Images' : '4 Pages'}</option>
                      <option value={6}>{layoutMode === 'photo_grid' ? '6 Images' : '6 Pages'}</option>
                      <option value={9}>{layoutMode === 'photo_grid' ? '9 Images' : '9 Pages'}</option>
                      <option value={16}>{layoutMode === 'photo_grid' ? '16 Images' : '16 Pages'}</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Dynamic Slab Pricing Estimate Box */}
          {(() => {
            const pricing = getEstimatedPriceDetails();
            return (
              <div className="details-card" style={{ marginBottom: 20, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                    {layoutMode === 'photo_grid' ? 'Estimated Sheets' : 'Total Pages'}
                  </span>
                  <span style={{ fontSize: '0.88rem', fontWeight: 'bold' }}>
                    {pricing.totalPages} {layoutMode === 'photo_grid' ? 'sheet' : 'page'}{pricing.totalPages > 1 ? 's' : ''}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>Rate per {layoutMode === 'photo_grid' ? 'sheet' : 'page'}</span>
                  <span style={{ fontSize: '0.88rem', fontWeight: 'bold' }}>₹{pricing.rate.toFixed(2)}</span>
                </div>
                <hr style={{ border: 'none', borderTop: '1px dashed var(--border)', margin: '4px 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.9rem', fontWeight: '700', color: 'var(--text)' }}>Estimated Total Cost</span>
                  <span style={{ fontSize: '1.1rem', fontWeight: '800', color: 'var(--primary-light, #06B6D4)' }}>
                    ₹{pricing.total}
                  </span>
                </div>
                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: 4, fontStyle: 'italic' }}>
                  *Estimate only. Final price determined by the shopkeeper.
                </span>
              </div>
            );
          })()}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={uploading}
            style={{ width: '100%', height: 46, fontSize: '0.95rem', fontWeight: 'bold' }}
          >
            {uploading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <div className="spinner" style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white' }} />
                <span>Sending to Printer...</span>
              </div>
            ) : (
              <span>
                {layoutMode === 'id_card'
                  ? `Print Aadhaar Card (${copies} cop${copies > 1 ? 'ies' : 'y'})`
                  : layoutMode === 'photo_grid'
                  ? `Print Photo Grid (${copies} cop${copies > 1 ? 'ies' : 'y'})`
                  : pageCount === null || pageCount === undefined
                  ? `Print ${copies} copies`
                  : `Print ${pageCount * copies} Total Pages`}
              </span>
            )}
          </button>
        </form>
      )}
    </main>
  );
}
