import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'autoprint.db');

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ──────────────────────────────────────────────
// Schema
// ──────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS print_jobs (
    id TEXT PRIMARY KEY,
    user_name TEXT DEFAULT 'Guest',
    user_phone TEXT DEFAULT '',
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size INTEGER DEFAULT 0,
    page_count INTEGER NOT NULL,
    copies INTEGER DEFAULT 1,
    is_duplex INTEGER DEFAULT 0,
    color_mode TEXT DEFAULT 'bw',
    total_price INTEGER NOT NULL,
    status TEXT DEFAULT 'created',
    razorpay_order_id TEXT,
    razorpay_payment_id TEXT,
    razorpay_signature TEXT,
    error_message TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

// ──────────────────────────────────────────────
// Queries
// ──────────────────────────────────────────────

const stmts = {
  insertJob: db.prepare(`
    INSERT INTO print_jobs (id, user_name, user_phone, file_path, file_name, file_size, page_count, copies, is_duplex, color_mode, total_price, status)
    VALUES (@id, @userName, @userPhone, @filePath, @fileName, @fileSize, @pageCount, @copies, @isDuplex, @colorMode, @totalPrice, @status)
  `),

  getJob: db.prepare(`SELECT * FROM print_jobs WHERE id = ?`),

  updateJobOptions: db.prepare(`
    UPDATE print_jobs SET copies = @copies, is_duplex = @isDuplex, color_mode = @colorMode, total_price = @totalPrice, updated_at = datetime('now')
    WHERE id = @id
  `),

  updateJobStatus: db.prepare(`
    UPDATE print_jobs SET status = @status, error_message = @errorMessage, updated_at = datetime('now')
    WHERE id = @id
  `),

  updateJobPayment: db.prepare(`
    UPDATE print_jobs SET status = 'paid', razorpay_order_id = @orderId, razorpay_payment_id = @paymentId, razorpay_signature = @signature, updated_at = datetime('now')
    WHERE id = @id
  `),

  setRazorpayOrderId: db.prepare(`
    UPDATE print_jobs SET razorpay_order_id = @orderId, updated_at = datetime('now')
    WHERE id = @id
  `),

  getNextPendingJob: db.prepare(`
    SELECT * FROM print_jobs WHERE status = 'paid' ORDER BY created_at ASC LIMIT 1
  `),

  getRecentJobs: db.prepare(`
    SELECT * FROM print_jobs ORDER BY created_at DESC LIMIT ?
  `),

  getQueuePosition: db.prepare(`
    SELECT COUNT(*) as position FROM print_jobs
    WHERE status IN ('paid', 'printing') AND created_at <= (SELECT created_at FROM print_jobs WHERE id = ?)
  `),

  getQueueStats: db.prepare(`
    SELECT
      COUNT(CASE WHEN status = 'paid' THEN 1 END) as queued,
      COUNT(CASE WHEN status = 'printing' THEN 1 END) as printing,
      COUNT(CASE WHEN status = 'completed' AND date(created_at) = date('now') THEN 1 END) as completed_today,
      COUNT(CASE WHEN date(created_at) = date('now') THEN 1 END) as total_today
    FROM print_jobs
  `),
};

// ──────────────────────────────────────────────
// Exported Functions
// ──────────────────────────────────────────────

export function createJob(data) {
  stmts.insertJob.run(data);
  return stmts.getJob.get(data.id);
}

export function getJob(id) {
  return stmts.getJob.get(id);
}

export function updateJobOptions(data) {
  stmts.updateJobOptions.run(data);
  return stmts.getJob.get(data.id);
}

export function updateJobStatus(id, status, errorMessage = null) {
  stmts.updateJobStatus.run({ id, status, errorMessage });
  return stmts.getJob.get(id);
}

export function updateJobPayment(id, orderId, paymentId, signature) {
  stmts.updateJobPayment.run({ id, orderId, paymentId, signature });
  return stmts.getJob.get(id);
}

export function setRazorpayOrderId(id, orderId) {
  stmts.setRazorpayOrderId.run({ id, orderId });
}

export function getNextPendingJob() {
  return stmts.getNextPendingJob.get();
}

export function getRecentJobs(limit = 20) {
  return stmts.getRecentJobs.all(limit);
}

export function getQueuePosition(jobId) {
  const result = stmts.getQueuePosition.get(jobId);
  return result ? result.position : 0;
}

export function getQueueStats() {
  return stmts.getQueueStats.get();
}

export default db;
