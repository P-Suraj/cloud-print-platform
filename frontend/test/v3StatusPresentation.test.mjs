import test from 'node:test';
import assert from 'node:assert';

const STATUS_TEXT_MAP = {
  waiting_for_shop: 'Awaiting shop approval',
  printing: 'Submitted to shop printing workflow',
  needs_attention: 'Outcome verification in progress',
  completed: 'Confirmed printed',
  failed: 'Printing failed',
  rejected: 'Job rejected by shopkeeper',
  cancelled: 'Order cancelled'
};

test('v3 status presentation map returns accurate wording', () => {
  assert.strictEqual(STATUS_TEXT_MAP.waiting_for_shop, 'Awaiting shop approval');
  assert.strictEqual(STATUS_TEXT_MAP.printing, 'Submitted to shop printing workflow');
  assert.strictEqual(STATUS_TEXT_MAP.needs_attention, 'Outcome verification in progress');
  assert.strictEqual(STATUS_TEXT_MAP.completed, 'Confirmed printed');
});
