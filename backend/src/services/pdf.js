import { PDFDocument } from 'pdf-lib';
import fs from 'fs/promises';

/**
 * Extract page count and metadata from a PDF file.
 * @param {string} filePath - Absolute path to the PDF file
 * @returns {Promise<{pageCount: number, title: string|null}>}
 */
export async function extractPdfInfo(filePath) {
  const fileBuffer = await fs.readFile(filePath);
  const pdfDoc = await PDFDocument.load(fileBuffer, { ignoreEncryption: true });
  const pageCount = pdfDoc.getPageCount();
  const title = pdfDoc.getTitle() || null;

  return { pageCount, title };
}

/**
 * Validate that a file is a valid PDF.
 * Checks magic bytes (PDF header: %PDF-)
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
export async function isValidPdf(filePath) {
  try {
    const fd = await fs.open(filePath, 'r');
    const buffer = Buffer.alloc(5);
    await fd.read(buffer, 0, 5, 0);
    await fd.close();
    return buffer.toString('ascii') === '%PDF-';
  } catch {
    return false;
  }
}

/**
 * Calculate print price.
 * @param {number} pageCount
 * @param {number} copies
 * @param {boolean} isDuplex
 * @param {string} colorMode - 'bw' or 'color'
 * @param {object} pricing - { perPageBW, perPageColor, duplexDiscountPercent }
 * @returns {{ totalPrice: number, breakdown: object }}
 */
export function calculatePrice(pageCount, copies, isDuplex, colorMode, pricing) {
  const pricePerPage = colorMode === 'color' ? pricing.perPageColor : pricing.perPageBW;
  const totalPages = pageCount * copies;
  let subtotal = totalPages * pricePerPage; // in paise

  let discount = 0;
  if (isDuplex) {
    discount = Math.floor(subtotal * (pricing.duplexDiscountPercent / 100));
    subtotal -= discount;
  }

  return {
    totalPrice: subtotal, // in paise
    breakdown: {
      pageCount,
      copies,
      isDuplex,
      colorMode,
      pricePerPage,       // paise per page
      totalPages,
      subtotalBeforeDiscount: subtotal + discount,
      duplexDiscount: discount,
      total: subtotal,
    },
  };
}
