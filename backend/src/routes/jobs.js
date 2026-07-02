import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import config from '../config.js';
import { createJob, getJob, updateJobOptions, getRecentJobs, getQueuePosition, getQueueStats } from '../database.js';
import { extractPdfInfo, isValidPdf, calculatePrice } from '../services/pdf.js';
import { getPrinterStatus } from '../services/printer.js';

const router = Router();

// ──────────────────────────────────────────────
// Multer setup for PDF uploads
// ──────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.upload.dir),
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${uuidv4().slice(0, 8)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.upload.maxFileSizeMB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  },
});

// ──────────────────────────────────────────────
// POST /api/jobs — Upload PDF and create job
// ──────────────────────────────────────────────
router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file uploaded' });
    }

    // Validate PDF magic bytes
    const valid = await isValidPdf(req.file.path);
    if (!valid) {
      return res.status(400).json({ error: 'Invalid PDF file' });
    }

    // Extract page count
    const pdfInfo = await extractPdfInfo(req.file.path);

    // Parse options from request body
    const copies = parseInt(req.body.copies) || 1;
    const isDuplex = req.body.isDuplex === 'true' || req.body.isDuplex === true ? 1 : 0;
    const colorMode = req.body.colorMode === 'color' ? 'color' : 'bw';
    const userName = req.body.userName || 'Guest';
    const userPhone = req.body.userPhone || '';

    // Calculate price
    const { totalPrice, breakdown } = calculatePrice(
      pdfInfo.pageCount, copies, isDuplex, colorMode, config.pricing
    );

    const jobId = uuidv4();
    const job = createJob({
      id: jobId,
      userName,
      userPhone,
      filePath: req.file.path,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      pageCount: pdfInfo.pageCount,
      copies,
      isDuplex,
      colorMode,
      totalPrice,
      status: 'created',
    });

    res.status(201).json({
      job,
      pricing: breakdown,
    });
  } catch (error) {
    console.error('[JOBS] Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ──────────────────────────────────────────────
// GET /api/jobs/:id — Get job details
// ──────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const position = getQueuePosition(job.id);
  res.json({ job, queuePosition: position });
});

// ──────────────────────────────────────────────
// PATCH /api/jobs/:id — Update print options
// ──────────────────────────────────────────────
router.patch('/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status !== 'created') {
    return res.status(400).json({ error: 'Cannot modify job after payment' });
  }

  const copies = parseInt(req.body.copies) || job.copies;
  const isDuplex = req.body.isDuplex !== undefined
    ? (req.body.isDuplex === true || req.body.isDuplex === 'true' ? 1 : 0)
    : job.is_duplex;
  const colorMode = req.body.colorMode || job.color_mode;

  const { totalPrice, breakdown } = calculatePrice(
    job.page_count, copies, isDuplex, colorMode, config.pricing
  );

  const updated = updateJobOptions({
    id: job.id,
    copies,
    isDuplex,
    colorMode,
    totalPrice,
  });

  res.json({ job: updated, pricing: breakdown });
});

// ──────────────────────────────────────────────
// GET /api/jobs — List recent jobs
// ──────────────────────────────────────────────
router.get('/', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const jobs = getRecentJobs(limit);
  res.json({ jobs });
});

// ──────────────────────────────────────────────
// GET /api/queue/stats — Queue statistics
// ──────────────────────────────────────────────
router.get('/queue/stats', (req, res) => {
  const stats = getQueueStats();
  res.json(stats);
});

// ──────────────────────────────────────────────
// GET /api/printer/status — Printer health check
// ──────────────────────────────────────────────
router.get('/printer/status', async (req, res) => {
  const status = await getPrinterStatus();
  res.json(status);
});

// ──────────────────────────────────────────────
// GET /api/pricing — Get pricing config
// ──────────────────────────────────────────────
router.get('/pricing/config', (req, res) => {
  res.json({
    perPageBW: config.pricing.perPageBW,
    perPageColor: config.pricing.perPageColor,
    duplexDiscountPercent: config.pricing.duplexDiscountPercent,
  });
});

export default router;
