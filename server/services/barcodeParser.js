/**
 * Industrial Barcode Parser for RF-SMART Middleware
 * 
 * Supports:
 * - Standard alphanumeric warehouse SKUs (e.g., 'SKU-1001')
 * - UPC-A / EAN-13 barcodes (12-13 digits)
 * - Warehouse Bin Barcodes (e.g., 'BIN-A01')
 * - GS1-128 / GS1 DataMatrix Application Identifiers (AI):
 *     (01) GTIN / UPC (14 digits)
 *     (10) Lot / Batch Number
 *     (21) Serial Number
 *     (30) Variable Count / Quantity
 */

export function parseBarcode(rawInput) {
  if (!rawInput || typeof rawInput !== 'string') {
    return {
      raw: '',
      type: 'UNKNOWN',
      identifier: '',
      quantity: 1,
      lot: null,
      serial: null,
      isValid: false
    };
  }

  const clean = rawInput.trim();

  // 1. Check for GS1 Application Identifier format with parentheses e.g. (01)00012345678901(30)5
  if (clean.includes('(01)') || clean.includes('(10)') || clean.includes('(21)') || clean.includes('(30)')) {
    const gtinMatch = clean.match(/\(01\)(\d{14})/);
    const lotMatch = clean.match(/\(10\)([A-Za-z0-9-_]+)/);
    const serialMatch = clean.match(/\(21\)([A-Za-z0-9-_]+)/);
    const qtyMatch = clean.match(/\(30\)(\d+)/);

    let upc = null;
    if (gtinMatch) {
      const gtin = gtinMatch[1];
      // 14-digit GTIN: if it has 2 leading zeros (e.g. 00012345678901), the 12-digit UPC is the last 12 digits
      if (gtin.startsWith('00')) {
        upc = gtin.slice(2);
      } else {
        upc = gtin;
      }
    }

    return {
      raw: clean,
      type: 'GS1-128',
      identifier: upc || (gtinMatch ? gtinMatch[1] : clean),
      quantity: qtyMatch ? parseInt(qtyMatch[1], 10) : 1,
      lot: lotMatch ? lotMatch[1] : null,
      serial: serialMatch ? serialMatch[1] : null,
      isValid: true,
      metadata: {
        gtin: gtinMatch ? gtinMatch[1] : null,
        description: 'GS1 Composite Barcode'
      }
    };
  }

  // 2. Bin Location Barcode format (e.g., BIN-A01, BIN-STAGE)
  if (/^BIN-[A-Z0-9-]+$/i.test(clean)) {
    return {
      raw: clean,
      type: 'BIN_LOCATION',
      identifier: clean.toUpperCase(),
      quantity: null,
      lot: null,
      serial: null,
      isValid: true
    };
  }

  // 3. Standard 12-digit UPC-A
  if (/^\d{12}$/.test(clean)) {
    return {
      raw: clean,
      type: 'UPC-A',
      identifier: clean,
      quantity: 1,
      lot: null,
      serial: null,
      isValid: true
    };
  }

  // 4. Standard 13-digit EAN-13
  if (/^\d{13}$/.test(clean)) {
    return {
      raw: clean,
      type: 'EAN-13',
      identifier: clean,
      quantity: 1,
      lot: null,
      serial: null,
      isValid: true
    };
  }

  // 5. Standard Warehouse SKU (e.g., SKU-1001, ITEM-5542)
  if (/^[A-Za-z0-9-_.]+$/.test(clean)) {
    return {
      raw: clean,
      type: 'SKU',
      identifier: clean.toUpperCase(),
      quantity: 1,
      lot: null,
      serial: null,
      isValid: true
    };
  }

  return {
    raw: clean,
    type: 'RAW_UNFORMATTED',
    identifier: clean,
    quantity: 1,
    lot: null,
    serial: null,
    isValid: true
  };
}
