import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('v3 pages do not hardcode localhost transport URLs', () => {
  for (const path of [
    '../src/pages/v3/ShopJob.jsx',
    '../src/pages/v3/ShopLogin.jsx',
    '../src/pages/v3/ShopQueue.jsx',
    '../src/pages/v3/CustomerPrint.jsx',
  ]) {
    assert.equal(source(path).includes('http://localhost:8000'), false, path);
  }
});

test('customer uploads raw PDFs, finalizes every artifact, and sends acceptance idempotency', () => {
  const customer = source('../src/pages/v3/CustomerPrint.jsx');
  const api = source('../src/services/v3Api.js');
  assert.match(customer, /finalizeUpload/);
  assert.match(customer, /body: document\.file/);
  assert.doesNotMatch(customer, /FormData/);
  assert.match(api, /Idempotency-Key/);
  assert.equal(api.includes("|| 'http://localhost:8000'"), false);
});

test('main customer software contains QR, shop-code, and saved-shop entry without a legacy studio redirect', () => {
  const app = source('../src/App.jsx');
  const customer = source('../src/pages/v3/CustomerPrint.jsx');
  const status = source('../src/pages/v3/CustomerStatus.jsx');
  const api = source('../src/services/v3Api.js');
  const entry = source('../src/pages/v3/ShopEntry.jsx');
  const shop = source('../src/pages/Shop.jsx');
  assert.match(app, /path="\/print\/:shopCode"/);
  assert.match(app, /path="\/order\/:orderId"/);
  assert.match(entry, /Scan the shop QR/);
  assert.match(entry, /Enter shop code/);
  assert.match(entry, /Saved shops/);
  assert.match(customer, /saved_shop/);
  assert.equal(customer.includes('Open the full print studio'), false);
  assert.equal(customer.includes('/kiosk/'), false);
  assert.match(customer, /shop\.demo_mode/);
  assert.match(customer, /CustomerVerification/);
  assert.match(customer, /fulfillmentMode/);
  assert.match(status, /Cancel print request/);
  assert.match(status, /checkInOrder/);
  assert.match(api, /cancelOrder/);
  assert.match(api, /X-AutoPrint-Customer-CSRF/);
  assert.match(shop, /\/print\/\$\{shopCode\}\?entry=qr/);
});
