/**
 * RF-SMART Middleware Scanner API Routes
 * 
 * Acts as the intelligent gateway between rugged mobile handhelds and NetSuite ERP.
 * Extended for household kitchen inventory:
 * - Custom item creation when barcode not found
 * - Image upload for items (photo from phone camera)
 * - Kitchen bin management
 */

import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { parseBarcode } from '../services/barcodeParser.js';
import { scanCache } from '../services/cache.js';
import { concurrencyMutex } from '../services/concurrencyManager.js';
import { generateTBAHeader } from '../services/auth.js';
import restlet from '../netsuite-mock/restlet.js';
import { getDatabase } from '../netsuite-mock/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UPLOADS_DIR = path.join(__dirname, '..', '..', 'public', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Multer storage: save images to public/uploads with original extension
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const uniqueName = `item-${Date.now()}-${Math.floor(Math.random() * 1000)}${ext}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'));
  }
});

const router = express.Router();

/**
 * GET /api/scanner/info
 * Returns server info including LAN IP for QR code display.
 */
router.get('/info', (req, res) => {
  const nets = os.networkInterfaces();
  let lanIP = 'localhost';
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) { lanIP = net.address; break; }
    }
    if (lanIP !== 'localhost') break;
  }
  const port = process.env.PORT || 7370;
  res.json({
    success: true,
    lanIP,
    port,
    mobileUrl: `http://${lanIP}:${port}`
  });
});

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
      error: restletResult.error.message || 'Item not found in NetSuite ERP',
      errorCode: restletResult.error.code
    });
  }

  // 5. Populate cache with fresh ERP record
  scanCache.set(parsed.identifier, restletResult.data);
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
 * GET /api/scanner/items
 * Returns all items in the system (for browsing inventory).
 */
router.get('/items', (req, res) => {
  const db = getDatabase();
  const items = db.prepare(`
    SELECT 
      i.itemid, i.sku, i.displayname, i.upc, i.image_url, i.notes,
      COALESCE(SUM(b.qty_on_hand), 0) as total_qty
    FROM items i
    LEFT JOIN inventory_balances b ON i.itemid = b.item_id
    GROUP BY i.itemid
    ORDER BY i.displayname ASC
  `).all();
  res.json({ success: true, items });
});

/**
 * POST /api/scanner/items
 * Creates a new item (when barcode is scanned but not found in the system).
 * Body: { displayname, upc, notes, sku? }
 */
router.post('/items', (req, res) => {
  const { displayname, upc, notes, sku } = req.body;

  if (!displayname || !upc) {
    return res.status(400).json({
      success: false,
      error: 'displayname and upc are required'
    });
  }

  const db = getDatabase();

  // Check if UPC already exists
  const existing = db.prepare('SELECT itemid FROM items WHERE upc = ?').get(upc);
  if (existing) {
    return res.status(409).json({
      success: false,
      error: `An item with UPC "${upc}" already exists (id: ${existing.itemid})`
    });
  }

  // Generate a new item ID
  const idRow = db.prepare(`SELECT itemid FROM items ORDER BY CAST(itemid AS INTEGER) DESC LIMIT 1`).get();
  const lastId = idRow ? (parseInt(idRow.itemid, 10) || 9000) : 9000;
  const newId = String(lastId + 1);
  const newSku = sku || `SKU-${newId}`;

  db.prepare(`
    INSERT INTO items (itemid, sku, displayname, upc, item_type, notes)
    VALUES (?, ?, ?, ?, 'GroceryItem', ?)
  `).run(newId, newSku, displayname, upc, notes || null);

  // Invalidate cache for this UPC
  scanCache.invalidateByPattern((key) => key === upc || key === newSku);

  res.json({
    success: true,
    item: { itemid: newId, sku: newSku, displayname, upc, notes: notes || null }
  });
});

/**
 * POST /api/scanner/items/:id/image
 * Uploads a photo for an item. Accepts multipart/form-data with field "image".
 */
router.post('/items/:id/image', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No image file uploaded' });
  }

  const db = getDatabase();
  const item = db.prepare('SELECT itemid FROM items WHERE itemid = ?').get(req.params.id);
  if (!item) {
    fs.unlink(req.file.path, () => {});
    return res.status(404).json({ success: false, error: 'Item not found' });
  }

  const imageUrl = `/uploads/${req.file.filename}`;
  db.prepare('UPDATE items SET image_url = ? WHERE itemid = ?').run(imageUrl, req.params.id);

  // Invalidate cache for this item
  scanCache.invalidateByPattern((key, val) => val?.itemId === req.params.id);

  res.json({ success: true, imageUrl });
});

/**
 * POST /api/scanner/items/:id/stock
 * Adds initial inventory for an item at a specific location.
 * Body: { binId, qty }
 */
router.post('/items/:id/stock', (req, res) => {
  const { binId, qty } = req.body;
  if (!binId || !qty || Number(qty) <= 0) {
    return res.status(400).json({ success: false, error: 'binId and qty (> 0) required' });
  }

  const db = getDatabase();
  const item = db.prepare('SELECT itemid FROM items WHERE itemid = ?').get(req.params.id);
  if (!item) {
    return res.status(404).json({ success: false, error: 'Item not found' });
  }

  const bin = db.prepare('SELECT binnumber FROM bins WHERE binnumber = ?').get(binId);
  if (!bin) {
    return res.status(404).json({ success: false, error: `Location "${binId}" not found` });
  }

  db.prepare(`
    INSERT INTO inventory_balances (item_id, bin_id, qty_on_hand)
    VALUES (?, ?, ?)
    ON CONFLICT(item_id, bin_id) DO UPDATE SET qty_on_hand = qty_on_hand + excluded.qty_on_hand
  `).run(req.params.id, binId, Number(qty));

  // Invalidate cache
  scanCache.invalidateByPattern((key, val) => val?.itemId === req.params.id || key === req.params.id);

  res.json({ success: true, message: `Added ${qty} units to ${binId}` });
});

/**
 * POST /api/scanner/transfer
 * Commits a kitchen location-to-location inventory movement.
 */
router.post('/transfer', async (req, res) => {
  const startTime = Date.now();
  const { itemId, fromBin, toBin, quantity } = req.body;

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
      error: `Source and destination location cannot be the same (${fromBin})`
    });
  }

  const lockKey = `item:${itemId}:bin:${fromBin}`;
  let releaseLock;

  try {
    releaseLock = await concurrencyMutex.acquire(lockKey, 6000);

    const tba = generateTBAHeader('POST', 'https://restlet.netsuite.com/app/site/hosting/restlet.nl');

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

    // Surgical Cache Invalidation
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
 * Returns all active kitchen locations (bins).
 */
router.get('/bins', async (req, res) => {
  const result = await restlet.get({ action: 'bins' });
  res.json(result);
});

/**
 * GET /api/scanner/inventory
 * Live inventory balance audit across all locations.
 */
router.get('/inventory', async (req, res) => {
  const result = await restlet.get({ action: 'inventory' });
  res.json(result);
});

/**
 * GET /api/scanner/transfers
 * Audit log of recent location transfer transactions.
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
 * actionable messages for scanner operators.
 */
function normalizeNetSuiteError(nsError) {
  const code = nsError.code || '';
  const msg = nsError.message || '';

  if (code === 'INSUFFICIENT_INVENTORY_IN_BIN') {
    const d = nsError.details;
    return {
      httpStatus: 409,
      message: d
        ? `Not enough in ${d.fromBin}: You have ${d.available}, but tried to move ${d.requested}.`
        : `Insufficient inventory in selected location.`
    };
  }

  if (code === 'INVALID_BIN_LOCATION') {
    return {
      httpStatus: 422,
      message: 'Destination location is invalid or does not exist.'
    };
  }

  if (code === 'RECORD_LOCKED' || code === 'RECORD_LOCKED_BY_ANOTHER_USER') {
    return {
      httpStatus: 423,
      message: 'This item is currently being updated. Please retry.'
    };
  }

  return {
    httpStatus: 400,
    message: msg.replace(/^SuiteScriptError:\s*/, '') || 'Operation rejected by inventory system.'
  };
}

export default router;
