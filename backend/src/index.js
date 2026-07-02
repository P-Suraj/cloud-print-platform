import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import config from './config.js';
import jobRoutes from './routes/jobs.js';
import paymentRoutes from './routes/payments.js';
import { getNextPendingJob, updateJobStatus } from './database.js';
import { printFile } from './services/printer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ──────────────────────────────────────────────
// Express App Setup
// ──────────────────────────────────────────────
const app = express();
const httpServer = createServer(app);
const io = new SocketServer(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '..', config.upload.dir);
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Serve frontend static files (production)
const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
}

// ──────────────────────────────────────────────
// API Routes
// ──────────────────────────────────────────────
app.use('/api/jobs', jobRoutes);
app.use('/api/payments', paymentRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// SPA fallback — serve frontend for all non-API routes
if (fs.existsSync(frontendDist)) {
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

// ──────────────────────────────────────────────
// Socket.io — Real-time job status updates
// ──────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);

  socket.on('watch-job', (jobId) => {
    socket.join(`job:${jobId}`);
    console.log(`[WS] ${socket.id} watching job ${jobId}`);
  });

  socket.on('disconnect', () => {
    console.log(`[WS] Client disconnected: ${socket.id}`);
  });
});

// Helper to emit status updates
function emitJobUpdate(jobId, status, extra = {}) {
  io.to(`job:${jobId}`).emit('status-update', {
    jobId,
    status,
    timestamp: new Date().toISOString(),
    ...extra,
  });
}

// ──────────────────────────────────────────────
// Print Worker — Polls for paid jobs and prints
// ──────────────────────────────────────────────
const POLL_INTERVAL = 3000; // 3 seconds

async function processNextJob() {
  try {
    const job = getNextPendingJob();
    if (!job) return;

    console.log(`\n[WORKER] 🖨️  Processing job ${job.id} — ${job.file_name} (${job.page_count} pages)`);

    // Update status to printing
    updateJobStatus(job.id, 'printing');
    emitJobUpdate(job.id, 'printing');

    // Send to printer
    const result = await printFile(job.file_path, {
      copies: job.copies,
      isDuplex: job.is_duplex === 1,
      colorMode: job.color_mode,
    });

    // Update status to completed
    updateJobStatus(job.id, 'completed');
    emitJobUpdate(job.id, 'completed', { cupsJobId: result.cupsJobId });
    console.log(`[WORKER] ✅ Job ${job.id} completed`);
  } catch (error) {
    console.error(`[WORKER] ❌ Job failed:`, error.message);
    // We already have the job from getNextPendingJob, but it might have been updated
    // Let's try to update the status of whatever was being processed
    try {
      const job = getNextPendingJob();
      if (job) {
        updateJobStatus(job.id, 'failed', error.message);
        emitJobUpdate(job.id, 'failed', { error: error.message });
      }
    } catch (e) {
      // Ignore nested errors
    }
  }
}

// Start the worker polling loop
setInterval(processNextJob, POLL_INTERVAL);
console.log(`[WORKER] Print worker started (polling every ${POLL_INTERVAL / 1000}s)`);

// ──────────────────────────────────────────────
// Start Server
// ──────────────────────────────────────────────
httpServer.listen(config.port, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║           🖨️  AutoPrint Server               ║
╠══════════════════════════════════════════════╣
║  API:      http://localhost:${config.port}            ║
║  Printer:  ${config.printer.enabled ? config.printer.name : 'DISABLED (simulation mode)'}
║  Mode:     ${config.isDev ? 'Development' : 'Production'}                    ║
╚══════════════════════════════════════════════╝
  `);
});

export { io, emitJobUpdate };
