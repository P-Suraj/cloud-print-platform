/**
 * Utility for formatting quote breakdown for display in v3 Customer UI
 */

export function formatQuoteBreakdown(breakdown) {
  if (!breakdown) return { formattedTotal: '₹0.00', details: [] };

  const { total_amount, currency = 'INR', logical_page_count, copies, total_printed_sides, rate_per_side, color_mode, duplex } = breakdown;

  const formattedTotal = `${currency === 'INR' ? '₹' : currency} ${floatToCurrency(total_amount)}`;

  const details = [
    { label: 'Document Pages', value: `${logical_page_count} pages` },
    { label: 'Copies', value: `${copies}` },
    { label: 'Total Sides to Print', value: `${total_printed_sides} sides` },
    { label: 'Print Mode', value: `${color_mode.toUpperCase()} (${duplex ? 'Duplex' : 'Simplex'})` },
    { label: 'Rate per Side', value: `₹ ${floatToCurrency(rate_per_side)}` }
  ];

  return { formattedTotal, details };
}

function floatToCurrency(val) {
  return (Number(val) || 0).toFixed(2);
}
