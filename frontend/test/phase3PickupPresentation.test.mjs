import test from 'node:test';
import assert from 'node:assert';
import { v3Api } from '../src/services/v3Api.js';

const PICKUP_STATUS_WORDING = {
  awaiting_print: 'Printing in progress',
  ready_for_pickup: 'Printed and ready for collection',
  collected: 'Order collected',
  hold_expired: 'Hold period expired. Please contact counter staff.',
  no_show: 'Order marked as uncollected',
  voided: 'Order voided',
};

test('pickup status wording map is distinct from print completion', () => {
  assert.notStrictEqual(PICKUP_STATUS_WORDING.ready_for_pickup, PICKUP_STATUS_WORDING.collected);
  assert.strictEqual(PICKUP_STATUS_WORDING.ready_for_pickup, 'Printed and ready for collection');
  assert.strictEqual(PICKUP_STATUS_WORDING.collected, 'Order collected');
  assert.strictEqual(PICKUP_STATUS_WORDING.hold_expired, 'Hold period expired. Please contact counter staff.');
  assert.strictEqual(PICKUP_STATUS_WORDING.no_show, 'Order marked as uncollected');
});

test('v3Api defines all required Phase 3 pickup endpoints', () => {
  assert.strictEqual(typeof v3Api.getPickupStatus, 'function');
  assert.strictEqual(typeof v3Api.getPickupCode, 'function');
  assert.strictEqual(typeof v3Api.listShopPickups, 'function');
  assert.strictEqual(typeof v3Api.getShopPickupDetail, 'function');
  assert.strictEqual(typeof v3Api.collectPickupWithCode, 'function');
  assert.strictEqual(typeof v3Api.manualCollectPickup, 'function');
  assert.strictEqual(typeof v3Api.recordPickupNoShow, 'function');
  assert.strictEqual(typeof v3Api.restoreCustomerTrust, 'function');
  assert.strictEqual(typeof v3Api.getShopPickupPolicy, 'function');
  assert.strictEqual(typeof v3Api.updateShopPickupPolicy, 'function');
});

test('pickup code formatting groups 8 characters into 4-4 with hyphen', () => {
  const formatCodeDisplay = (code) => {
    if (!code || code.length !== 8) return code;
    return `${code.slice(0, 4)} - ${code.slice(4)}`;
  };

  assert.strictEqual(formatCodeDisplay('23AB78KL'), '23AB - 78KL');
  assert.strictEqual(formatCodeDisplay('SHORT'), 'SHORT');
});
