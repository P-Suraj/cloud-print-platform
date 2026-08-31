import test from 'node:test';
import assert from 'node:assert';
import { formatQuoteBreakdown } from '../src/lib/v3QuotePresentation.js';

test('formatQuoteBreakdown formats INR currency correctly', () => {
  const breakdown = {
    total_amount: 15.00,
    currency: 'INR',
    logical_page_count: 5,
    copies: 2,
    total_printed_sides: 10,
    rate_per_side: 1.50,
    color_mode: 'bw',
    duplex: false
  };

  const result = formatQuoteBreakdown(breakdown);
  assert.strictEqual(result.formattedTotal, '₹ 15.00');
  assert.strictEqual(result.details.length, 5);
  assert.strictEqual(result.details[0].value, '5 pages');
});
