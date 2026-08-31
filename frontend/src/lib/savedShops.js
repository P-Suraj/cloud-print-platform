const STORAGE_KEY = 'autoprint_saved_shops_v1';
const MAX_SAVED_SHOPS = 10;
const SHOP_CODE_PATTERN = /^[A-Z0-9]{3,20}$/;

export function normalizeShopCode(value) {
  return String(value || '').trim().toUpperCase();
}

export function isValidShopCode(value) {
  return SHOP_CODE_PATTERN.test(normalizeShopCode(value));
}

export function readSavedShops(storage = globalThis.localStorage) {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    const unique = new Map();
    for (const item of parsed) {
      const shopCode = normalizeShopCode(item?.shopCode);
      if (!isValidShopCode(shopCode) || unique.has(shopCode)) continue;
      unique.set(shopCode, {
        shopCode,
        name: String(item?.name || 'Print Shop').slice(0, 120),
        savedAt: String(item?.savedAt || ''),
      });
    }
    return [...unique.values()].slice(0, MAX_SAVED_SHOPS);
  } catch {
    return [];
  }
}

export function saveShop(shop, storage = globalThis.localStorage) {
  const shopCode = normalizeShopCode(shop?.shopCode);
  if (!storage || !isValidShopCode(shopCode)) return readSavedShops(storage);
  const next = [
    {
      shopCode,
      name: String(shop?.name || 'Print Shop').slice(0, 120),
      savedAt: new Date().toISOString(),
    },
    ...readSavedShops(storage).filter(item => item.shopCode !== shopCode),
  ].slice(0, MAX_SAVED_SHOPS);
  storage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function removeSavedShop(shopCode, storage = globalThis.localStorage) {
  if (!storage) return [];
  const normalized = normalizeShopCode(shopCode);
  const next = readSavedShops(storage).filter(item => item.shopCode !== normalized);
  storage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function isShopSaved(shopCode, storage = globalThis.localStorage) {
  const normalized = normalizeShopCode(shopCode);
  return readSavedShops(storage).some(item => item.shopCode === normalized);
}

export { STORAGE_KEY as SAVED_SHOPS_STORAGE_KEY };
