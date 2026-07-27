import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';

const SHOP_SELECT_FIELDS = 'id, name, last_seen_at, shop_code, print_mode, bw_slabs, color_slabs, printer_bw, printer_color';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEARTBEAT_STALE_SECONDS = 45;

/**
 * useShop — Single source of truth for shop data fetching.
 *
 * The URL param (shopUrlParam) may be either:
 *   - A shop_code like "TST001"   → query by shop_code first
 *   - A UUID like "11111111-..."  → query by id
 *
 * Returns the real UUID (realShopId) which must be used for all
 * print_jobs queries, realtime subscriptions, and updates.
 *
 * @param {string} shopUrlParam  - The :shopId value from useParams()
 * @param {number} pollInterval  - How often to re-fetch (ms). Set to 0 to disable polling.
 */
export function useShop(shopUrlParam, { pollInterval = 5000 } = {}) {
  const [realShopId, setRealShopId]     = useState(null);
  const [shopName, setShopName]         = useState('');
  const [shopCode, setShopCode]         = useState('');
  const [printMode, setPrintMode]       = useState('manual');
  const [bwSlabs, setBwSlabs]           = useState([]);
  const [colorSlabs, setColorSlabs]     = useState([]);
  const [printerBw, setPrinterBw]       = useState('');
  const [printerColor, setPrinterColor] = useState('');
  const [isOnline, setIsOnline]         = useState(false);
  const [loading, setLoading]           = useState(true);

  useEffect(() => {
    if (!shopUrlParam) return;

    async function fetchShopData() {
      try {
        const looksLikeUuid = UUID_REGEX.test(shopUrlParam);
        let shopData = null;

        // Try shop_code first (most common case — URLs use codes like TST001)
        if (!looksLikeUuid) {
          const { data } = await supabase
            .from('shops')
            .select(SHOP_SELECT_FIELDS)
            .eq('shop_code', shopUrlParam.toUpperCase())
            .single();
          shopData = data;
        }

        // Fall back to UUID lookup
        if (!shopData) {
          const { data } = await supabase
            .from('shops')
            .select(SHOP_SELECT_FIELDS)
            .eq('id', shopUrlParam)
            .single();
          shopData = data;
        }

        if (shopData) {
          setRealShopId(shopData.id);
          setShopName(shopData.name || '');
          setShopCode(shopData.shop_code || shopUrlParam.toUpperCase());
          setPrintMode(shopData.print_mode || 'manual');
          setBwSlabs(shopData.bw_slabs || []);
          setColorSlabs(shopData.color_slabs || []);
          setPrinterBw(shopData.printer_bw || '');
          setPrinterColor(shopData.printer_color || '');

          // Online = agent sent a heartbeat within HEARTBEAT_STALE_SECONDS
          if (shopData.last_seen_at) {
            const diffSeconds = (Date.now() - new Date(shopData.last_seen_at).getTime()) / 1000;
            setIsOnline(diffSeconds < HEARTBEAT_STALE_SECONDS);
          } else {
            setIsOnline(false);
          }
        } else {
          // Shop not found in DB — safe defaults, never fake online
          setRealShopId(shopUrlParam);
          setShopCode(shopUrlParam.toUpperCase());
          setShopName('Print Shop');
          setPrintMode('manual');
          setIsOnline(false);
        }
      } catch (err) {
        console.error('[useShop] Error fetching shop data:', err);
        setIsOnline(false);
      } finally {
        setLoading(false);
      }
    }

    fetchShopData();

    if (pollInterval > 0) {
      const interval = setInterval(fetchShopData, pollInterval);
      return () => clearInterval(interval);
    }
  }, [shopUrlParam, pollInterval]);

  return {
    realShopId,
    shopName,
    shopCode,
    printMode,
    bwSlabs,
    colorSlabs,
    printerBw,
    printerColor,
    isOnline,
    loading,
  };
}
