import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isShopSaved, isValidShopCode, normalizeShopCode, readSavedShops,
  removeSavedShop, saveShop,
} from '../src/lib/savedShops.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test('shop codes are normalized and constrained', () => {
  assert.equal(normalizeShopCode('  canary01 '), 'CANARY01');
  assert.equal(isValidShopCode('ABC123'), true);
  assert.equal(isValidShopCode('../bad'), false);
  assert.equal(isValidShopCode('x'), false);
});

test('saved shops are deduplicated, newest first, and removable', () => {
  const storage = memoryStorage();
  saveShop({ shopCode: 'abc123', name: 'First Name' }, storage);
  saveShop({ shopCode: 'CANARY01', name: 'Campus Print' }, storage);
  saveShop({ shopCode: 'ABC123', name: 'Updated Name' }, storage);

  const saved = readSavedShops(storage);
  assert.deepEqual(saved.map(item => item.shopCode), ['ABC123', 'CANARY01']);
  assert.equal(saved[0].name, 'Updated Name');
  assert.equal(isShopSaved('canary01', storage), true);

  const remaining = removeSavedShop('CANARY01', storage);
  assert.deepEqual(remaining.map(item => item.shopCode), ['ABC123']);
});

test('malformed local data fails closed', () => {
  const storage = memoryStorage({ autoprint_saved_shops_v1: '{bad json' });
  assert.deepEqual(readSavedShops(storage), []);
});
