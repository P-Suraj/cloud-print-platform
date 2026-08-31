/**
 * Client-side PDF page counter and validation engine.
 * Loads pdf.js dynamically from CDN to bypass Vite worker bundling issues.
 */
export async function loadPdfDocument(file) {
  if (!file) throw new Error('Choose a PDF first.');
  if (!window.pdfjsLib) {
    await new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-autoprint-pdfjs]');
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.dataset.autoprintPdfjs = 'true';
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Failed to load PDF preview.'));
      document.head.appendChild(script);
    });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  return window.pdfjsLib.getDocument({ data: bytes }).promise;
}

export async function getPdfPageCount(file) {
  return new Promise((resolve, reject) => {
    if (file.size > 50 * 1024 * 1024) {
      return reject(new Error('File exceeds the maximum size limit of 50MB.'));
    }

    if (!window.pdfjsLib) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
      script.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
        parsePdf(file, resolve, reject);
      };
      script.onerror = () => reject(new Error('Failed to load PDF processing library. Please check your internet connection.'));
      document.head.appendChild(script);
    } else {
      parsePdf(file, resolve, reject);
    }
  });
}

function parsePdf(file, resolve, reject) {
  const reader = new FileReader();
  reader.onload = async function (e) {
    try {
      const typedarray = new Uint8Array(e.target.result);
      const loadingTask = window.pdfjsLib.getDocument({ data: typedarray });
      
      loadingTask.promise.then(
        (pdf) => {
          resolve(pdf.numPages);
        },
        (err) => {
          if (err && err.name === 'PasswordException') {
            reject(new Error('This PDF is password-protected. Please upload an unprotected PDF.'));
          } else {
            reject(new Error('Failed to read PDF. The file may be corrupted or invalid.'));
          }
        }
      );
    } catch (err) {
      reject(new Error('Unexpected error processing PDF.'));
    }
  };
  reader.onerror = () => reject(new Error('Failed to read file buffer.'));
  reader.readAsArrayBuffer(file);
}

/**
 * Parses PDF to get both page count and render the first page as a base64 thumbnail.
 */
export async function getPdfDetails(file) {
  return new Promise((resolve, reject) => {
    if (file.size > 50 * 1024 * 1024) {
      return reject(new Error('File exceeds the maximum size limit of 50MB.'));
    }

    if (!window.pdfjsLib) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
      script.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
        parsePdfDetails(file, resolve, reject);
      };
      script.onerror = () => reject(new Error('Failed to load PDF processing library. Please check your internet connection.'));
      document.head.appendChild(script);
    } else {
      parsePdfDetails(file, resolve, reject);
    }
  });
}

function parsePdfDetails(file, resolve, reject) {
  const reader = new FileReader();
  reader.onload = async function (e) {
    try {
      const typedarray = new Uint8Array(e.target.result);
      const loadingTask = window.pdfjsLib.getDocument({ data: typedarray });
      
      loadingTask.promise.then(
        async (pdf) => {
          try {
            const pageCount = pdf.numPages;
            let thumbnail = null;
            if (pageCount > 0) {
              const page = await pdf.getPage(1);
              const baseViewport = page.getViewport({ scale: 1.0 });
              // Target around 400px width for preview thumbnail
              const scale = 400 / baseViewport.width;
              const viewport = page.getViewport({ scale: scale });
              
              const canvas = document.createElement('canvas');
              const context = canvas.getContext('2d');
              canvas.height = viewport.height;
              canvas.width = viewport.width;
              
              await page.render({
                canvasContext: context,
                viewport: viewport
              }).promise;
              
              thumbnail = canvas.toDataURL('image/jpeg', 0.85);
            }
            resolve({ pageCount, thumbnail });
          } catch (err) {
            console.error("Error rendering PDF thumbnail:", err);
            resolve({ pageCount: pdf.numPages, thumbnail: null });
          }
        },
        (err) => {
          if (err && err.name === 'PasswordException') {
            reject(new Error('This PDF is password-protected. Please upload an unprotected PDF.'));
          } else {
            reject(new Error('Failed to read PDF. The file may be corrupted or invalid.'));
          }
        }
      );
    } catch (err) {
      reject(new Error('Unexpected error processing PDF.'));
    }
  };
  reader.onerror = () => reject(new Error('Failed to read file buffer.'));
  reader.readAsArrayBuffer(file);
}
