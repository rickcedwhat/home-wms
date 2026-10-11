/**
 * Open Food Facts API Service
 * 
 * Free, open database of global grocery products.
 * Used for instant auto-discovery of unknown food barcodes (UPC-A / EAN-13).
 */

export async function lookupOpenFoodFacts(barcode) {
  if (!barcode || typeof barcode !== 'string') return null;
  const raw = barcode.trim();
  const candidates = [raw];

  // 12-digit UPC-A is often indexed as 13-digit EAN with leading 0 in Open Food Facts
  if (/^\d{12}$/.test(raw)) {
    candidates.push('0' + raw);
  }
  // 13-digit EAN with leading 0 can also be queried without it
  if (/^\d{13}$/.test(raw) && raw.startsWith('0')) {
    candidates.push(raw.slice(1));
  }
  // Also try stripped of all leading zeroes
  const stripped = raw.replace(/^0+/, '');
  if (stripped && !candidates.includes(stripped)) {
    candidates.push(stripped);
  }

  for (const code of candidates) {
    try {
      const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'RFSmartKitchenScanner/1.0 (local personal prototype)' },
        signal: AbortSignal.timeout(5000)
      });

      if (!res.ok) continue;
      const data = await res.json();

      if (data && data.status === 1 && data.product) {
        const p = data.product;
        const brand = p.brands ? p.brands.split(',')[0].trim() : '';
        const rawName = p.product_name || p.product_name_en || p.generic_name || '';
        const displayName = brand && !rawName.toLowerCase().includes(brand.toLowerCase())
          ? `${brand} ${rawName}`.trim()
          : (rawName || brand || `Grocery Item ${barcode}`);

        const imageUrl = p.image_front_url || p.image_url || p.image_small_url || null;

        return {
          upc: barcode.trim(),
          displayName,
          brand: brand || null,
          imageUrl,
          categories: p.categories || null,
          quantity: p.quantity || null
        };
      }
    } catch (err) {
      // Timeout or network error; fall through to next candidate or return null
    }
  }

  // Fallback for non-food household items (toilet paper, paper towels, cleaners, toiletries)
  try {
    const upcUrl = `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(raw)}`;
    const upcRes = await fetch(upcUrl, {
      headers: { 'User-Agent': 'RFSmartKitchenScanner/1.0' },
      signal: AbortSignal.timeout(4000)
    });
    if (upcRes.ok) {
      const upcData = await upcRes.json();
      if (upcData && upcData.items && upcData.items.length > 0) {
        const item = upcData.items[0];
        const title = item.title || item.description || `Household Item ${raw}`;
        const brand = item.brand || null;
        const imageUrl = (item.images && item.images.length > 0) ? item.images[0] : null;

        return {
          upc: raw,
          displayName: title,
          brand,
          imageUrl,
          categories: item.category || 'Household',
          quantity: null
        };
      }
    }
  } catch (_) {}

  return null;
}
