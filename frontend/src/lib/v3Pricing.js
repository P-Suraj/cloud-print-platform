export function selectedPageCount(pageRange, logicalPageCount) {
  if (pageRange == null || String(pageRange).trim() === '') return logicalPageCount;
  const value = String(pageRange).trim();
  if (!/^\d+(?:-\d+)?(?:\s*,\s*\d+(?:-\d+)?)*$/.test(value)) {
    throw new Error('Pages must look like 1-5, 8, 11-15');
  }
  const selected = new Set();
  for (const part of value.split(',')) {
    const bounds = part.trim().split('-').map(Number);
    const start = bounds[0]; const end = bounds.length === 1 ? start : bounds[1];
    if (start < 1 || end < start || end > logicalPageCount) {
      throw new Error(`Pages must stay between 1 and ${logicalPageCount}`);
    }
    for (let page = start; page <= end; page += 1) selected.add(page);
  }
  return selected.size;
}

export function calculateLineEstimate(logicalPageCount, options, rules) {
  const copies = Number(options.copies ?? 1);
  const colorMode = String(options.color_mode ?? 'bw').toLowerCase();
  const duplex = options.duplex ?? false;
  if (!Number.isInteger(copies) || copies < 1 || copies > 100) throw new Error('Copies must be between 1 and 100');
  if (!['bw', 'color'].includes(colorMode)) throw new Error("Colour must be B&W or colour");
  if (typeof duplex !== 'boolean') throw new Error('Sides selection is invalid');
  if (!Number.isInteger(logicalPageCount) || logicalPageCount < 1) throw new Error('PDF page count is unavailable');
  const pages = selectedPageCount(options.page_range, logicalPageCount);
  const totalSides = pages * copies;
  const slabKey = `${colorMode === 'color' ? 'color' : 'bw'}_${duplex ? 'duplex' : 'simplex'}_slabs`;
  const slabs = rules?.[slabKey];
  if (!Array.isArray(slabs) || !slabs.length) throw new Error(`Shop rate is missing ${slabKey}`);
  const slab = slabs.find(item => Number(item.min_pages) <= totalSides && totalSides <= Number(item.max_pages));
  if (!slab || Number(slab.rate) < 0) throw new Error('No shop rate applies to this document');
  return Math.round(totalSides * Number(slab.rate) * 100) / 100;
}

export function calculateBatchEstimate(documents, rules) {
  const lines = documents.map(document => ({
    id: document.id,
    total: calculateLineEstimate(document.pageCount, document.options, rules),
  }));
  return { lines, total: Math.round(lines.reduce((sum, line) => sum + line.total, 0) * 100) / 100 };
}
