/**
 * RF-SMART Middleware Scanner API Routes
 * 
 * Acts as the intelligent gateway between rugged mobile handhelds and NetSuite ERP.
 * Handles barcode parsing, cache buffering, concurrency locking, TBA signing,
 * and ERP error normalization.
 */

import express from 'express';
import { parseBarcode } from '../services/barcodeParser.js';
import { scanCache } from '../services/cache.js';
import { concurrencyMutex } from '../services/concurrencyManager.js';
import { generateTBAHeader } from '../services/auth.js';
import restlet from '../netsuite-mock/restlet.js';

const router = express.Router();

/**
 * GET /api/scanner/lookup
 * Fast lookup endpoint for handheld scans.
 */
router.get('/lookup', async (req, res) => {
  const startTime = Date.now();
  const rawBarcode = req.query.barcode;

  if (!rawBarcode) {
    return res.status(400).json({
      success: false,
      error: 'Missing required query parameter "barcode"'
    });
  }

  // 1. Parse barcode (extract SKU, UPC, or GS1 Application Identifiers)
  const parsed = parseBarcode(rawBarcode);

  // 2. Check in-memory cache first for sub-5ms response
  const cachedItem = scanCache.get(parsed.identifier);
  if (cachedItem) {
    const latencyMs = Date.now() - startTime;
    return res.json({
      success: true,
      source: 'CACHE',
      latencyMs,
      parsedBarcode: parsed,
      data: cachedItem
    });
  }

  // 3. Cache Miss: Sign request with NetSuite TBA (OAuth 1.0a)
  const tba = generateTBAHeader('GET', 'https://restlet.netsuite.com/app/site/hosting/restlet.nl', {
    action: 'lookup',
    barcode: parsed.identifier
  });

  // 4. Invoke NetSuite RESTlet (simulates ~300ms ERP latency)
  const restletResult = await restlet.get({
    action: 'lookup',
    barcode: parsed.identifier
  });

  const latencyMs = Date.now() - startTime;

  if (restletResult.status === 'ERROR') {
    return res.status(404).json({
      success: false,
      source: 'NETSUITE_RESTLET',
      latencyMs,
      parsedBarcode: parsed,
      tbaHeader: tba.header,
      error: restletResult.error.message || 'Item not found in NetSuite ERP'
    });
  }

  // 5. Populate cache with fresh ERP record
  scanCache.set(parsed.identifier, restletResult.data);
  // Also index by SKU and UPC for cross-lookup hits
  if (restletResult.data.sku) scanCache.set(restletResult.data.sku, restletResult.data);
  if (restletResult.data.upc) scanCache.set(restletResult.data.upc, restletResult.data);

  return res.json({
    success: true,
    source: 'NETSUITE_RESTLET',
    latencyMs,
    parsedBarcode: parsed,
    tbaHeader: tba.header,
    tbaSignature: tba.signature,
    data: restletResult.data
  });
});

/**
 * POST /api/scanner/transfer
 * Commits a warehouse bin-to-bin inventory movement.
 */
router.post('/transfer', async (req, res) => {
  const startTime = Date.now();
  const { itemId, fromBin, toBin, quantity } = req.body;

  // Validation
  if (!itemId || !fromBin || !toBin || !quantity) {
    return res.status(400).json({
      success: false,
      error: 'Missing required transfer fields: itemId, fromBin, toBin, quantity'
    });
  }

  const numQty = Number(quantity);
  if (isNaN(numQty) || numQty <= 0) {
    return res.status(400).json({
      success: false,
      error: 'Transfer quantity must be a positive integer'
    });
  }

  if (fromBin === toBin) {
    return res.status(400).json({
      success: false,
      error: `Source bin and destination bin cannot be the same (${fromBin})`
    });
  }

  // Concurrency Locking: Lock per item & source bin to serialize concurrent worker transfers
  const lockKey = `item:${itemId}:bin:${fromBin}`;
  let releaseLock;

  try {
    releaseLock = await concurrencyMutex.acquire(lockKey, 6000);

    // Generate NetSuite TBA Authorization Header
    const tba = generateTBAHeader('POST', 'https://restlet.netsuite.com/app/site/hosting/restlet.nl');

    // Call simulated SuiteScript 2.1 RESTlet
    const restletResponse = await restlet.post({
      action: 'transfer',
      itemId,
      fromBin,
      toBin,
      quantity: numQty,
      tbaSignature: tba.signature
    });

    const latencyMs = Date.now() - startTime;

    if (restletResponse.status === 'ERROR') {
      const normalizedError = normalizeNetSuiteError(restletResponse.error);
      return res.status(normalizedError.httpStatus).json({
        success: false,
        source: 'NETSUITE_RESTLET',
        latencyMs,
        tbaSignature: tba.signature,
        errorCode: restletResponse.error.code,
        error: normalizedError.message,
        details: restletResponse.error.details
      });
    }

    // Surgical Cache Invalidation: Invalidate all cache entries associated with this itemId
    scanCache.invalidateByPattern((key, val) => {
      return val?.itemId === itemId || key === itemId;
    });

    return res.json({
      success: true,
      source: 'NETSUITE_RESTLET',
      latencyMs,
      tbaSignature: tba.signature,
      transfer: restletResponse.data
    });
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    return res.status(500).json({
      success: false,
      latencyMs,
      error: err.message || 'Internal server error during transfer execution'
    });
  } finally {
    if (releaseLock) releaseLock();
  }
});

/**
 * GET /api/scanner/bins
 * Returns all active warehouse bins.
 */
router.get('/bins', async (req, res) => {
  const result = await restlet.get({ action: 'bins' });
  res.json(result);
});

/**
 * GET /api/scanner/inventory
 * Live inventory balance audit across all bins.
 */
router.get('/inventory', async (req, res) => {
  const result = await restlet.get({ action: 'inventory' });
  res.json(result);
});

/**
 * GET /api/scanner/transfers
 * Audit log of recent bin transfer transactions.
 */
router.get('/transfers', async (req, res) => {
  const result = await restlet.get({ action: 'transfers' });
  res.json(result);
});

/**
 * GET /api/scanner/stats
 * Telemetry and cache performance statistics.
 */
router.get('/stats', (req, res) => {
  res.json({
    cache: scanCache.getStats(),
    activeLocks: concurrencyMutex.getActiveLocksCount()
  });
});

/**
 * POST /api/scanner/cache/clear
 * Flush in-memory cache for live testing.
 */
router.post('/cache/clear', (req, res) => {
  scanCache.clear();
  res.json({ success: true, message: 'Cache flushed successfully' });
});

/**
 * Translates cryptic ERP/SuiteScript database errors into clean,
 * actionable messages for warehouse scanner operators.
 */
function normalizeNetSuiteError(nsError) {
  const code = nsError.code || '';
  const msg = nsError.message || '';

  if (code === 'INSUFFICIENT_INVENTORY_IN_BIN') {
    const d = nsError.details;
    return {
      httpStatus: 409,
      message: d
        ? `Insufficient stock in ${d.fromBin}: Available is ${d.available}, but requested ${d.requested}.`
        : `Insufficient inventory available in selected source bin.`
    };
  }

  if (code === 'INVALID_BIN_LOCATION') {
    return {
      httpStatus: 422,
      message: 'Destination bin is invalid or not assigned to this warehouse location.'
    };
  }

  if (code === 'RECORD_LOCKED' || code === 'RECORD_LOCKED_BY_ANOTHER_USER') {
    return {
      httpStatus: 423,
      message: 'This inventory record is currently locked by another scan. Please retry.'
    };
  }

  return {
    httpStatus: 400,
    message: msg.replace(/^SuiteScriptError:\s*/, '') || 'NetSuite ERP rejected transaction.'
  };
}

export default router;
