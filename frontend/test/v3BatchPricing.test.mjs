import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { calculateBatchEstimate } from '../src/lib/v3Pricing.js';

const rules = {
  bw_simplex_slabs: [{ min_pages: 1, max_pages: 9999, rate: 2 }],
  bw_duplex_slabs: [{ min_pages: 1, max_pages: 9999, rate: 1.5 }],
  color_simplex_slabs: [{ min_pages: 1, max_pages: 9999, rate: 10 }],
  color_duplex_slabs: [{ min_pages: 1, max_pages: 9999, rate: 8 }],
};
const doc = (id, pageCount, options) => ({ id, pageCount, options });

test('add, remove, and independent settings update the batch total locally', () => {
  const a = doc('a', 2, { copies: 2, color_mode: 'bw', duplex: false });
  const b = doc('b', 4, { copies: 1, color_mode: 'color', duplex: true });
  const c = doc('c', 1, { copies: 3, color_mode: 'bw', duplex: false });
  assert.equal(calculateBatchEstimate([a], rules).total, 8);
  assert.equal(calculateBatchEstimate([a, b, c], rules).total, 46);
  assert.equal(calculateBatchEstimate([a, c], rules).total, 14);
  assert.equal(calculateBatchEstimate([{ ...a, options: { ...a.options, copies: 3 } }, c], rules).total, 18);
});

test('customer UI is truly multi-file and has no exact-price button flow', () => {
  const source = readFileSync(new URL('../src/pages/v3/CustomerPrint.jsx', import.meta.url), 'utf8');
  assert.match(source, /type="file" multiple/);
  assert.match(source, /createBatchQuote/);
  assert.match(source, /for \(let index = 0; index < documents\.length/);
  assert.doesNotMatch(source, /Get Exact Price|Get exact price/i);
  assert.doesNotMatch(source, /files\?\.\[0\]|files\.first/);
});

test('setting interactions do not call the authoritative quote endpoint', () => {
  const source = readFileSync(new URL('../src/pages/v3/CustomerPrint.jsx', import.meta.url), 'utf8');
  const updateBody = source.slice(source.indexOf('const updateOptions'), source.indexOf('const activeDocument'));
  assert.doesNotMatch(updateBody, /createQuote|createBatchQuote|fetch\(/);
});
