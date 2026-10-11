/**
 * RF-SMART Backend Automated Test Suite
 * 
 * Verifies Barcode Parsing, Token-Based Authentication (TBA), Caching,
 * Concurrency Mutex Locks, and NetSuite SuiteScript 2.1 N/record & N/search operations.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { parseBarcode } from '../server/services/barcodeParser.js';
import { generateTBAHeader, verifyTBAHeader } from '../server/services/auth.js';
import { scanCache } from '../server/services/cache.js';
import { concurrencyMutex } from '../server/services/concurrencyManager.js';
import { getDatabase, resetDatabase } from '../server/netsuite-mock/db.js';
import record from '../server/netsuite-mock/nRecord.js';
import search from '../server/netsuite-mock/nSearch.js';
import restlet from '../server/netsuite-mock/restlet.js';

describe('1. Industrial Barcode Parser', () => {
  test('parses plain warehouse SKU', () => {
    const res = parseBarcode('SKU-1001');
    assert.equal(res.isValid, true);
    assert.equal(res.type, 'SKU');
    assert.equal(res.identifier, 'SKU-1001');
  });

  test('parses 12-digit UPC-A barcode', () => {
    const res = parseBarcode('012345678901');
    assert.equal(res.isValid, true);
    assert.equal(res.type, 'UPC-A');
    assert.equal(res.identifier, '012345678901');
    assert.equal(res.quantity, 1);
  });

  test('parses warehouse bin barcode', () => {
    const res = parseBarcode('BIN-A01');
    assert.equal(res.isValid, true);
    assert.equal(res.type, 'BIN_LOCATION');
    assert.equal(res.identifier, 'BIN-A01');
  });

  test('parses GS1-128 composite barcode with Application Identifiers', () => {
    const res = parseBarcode('(01)00012345678901(30)10(10)LOT-992B');
    assert.equal(res.isValid, true);
    assert.equal(res.type, 'GS1-128');
    assert.equal(res.quantity, 10);
    assert.equal(res.lot, 'LOT-992B');
    assert.equal(res.identifier, '012345678901');
  });
});

describe('2. NetSuite Token-Based Authentication (TBA)', () => {
  test('generates compliant OAuth 1.0a HMAC-SHA256 header', () => {
    const tba = generateTBAHeader('POST', 'https://restlet.netsuite.com/app/site/hosting/restlet.nl');
    assert.ok(tba.header.startsWith('OAuth '));
    assert.ok(tba.header.includes('oauth_signature_method="HMAC-SHA256"'));
    assert.ok(tba.header.includes('realm="RF_SMART_WMS_DEMO"'));
    assert.ok(tba.signature.length > 20);
  });

  test('verifies valid incoming TBA header', () => {
    const tba = generateTBAHeader('POST', 'https://restlet.netsuite.com/app/site/hosting/restlet.nl');
    const verification = verifyTBAHeader(tba.header, 'POST', 'https://restlet.netsuite.com/app/site/hosting/restlet.nl');
    assert.equal(verification.isValid, true);
    assert.equal(verification.clientRealm, 'RF_SMART_WMS_DEMO');
  });

  test('rejects malformed or invalid TBA headers', () => {
    const result = verifyTBAHeader('Bearer invalid-token-string', 'GET', '/api');
    assert.equal(result.isValid, false);
    assert.equal(result.reason, 'MISSING_OR_INVALID_AUTH_SCHEME');
  });
});

describe('3. In-Memory Cache & Latency Buffering', () => {
  beforeEach(() => {
    scanCache.clear();
  });

  test('tracks cache miss and subsequent cache hit', () => {
    const key = 'SKU-1001';
    assert.equal(scanCache.get(key), null); // Miss

    scanCache.set(key, { name: 'Zebra TC52', qty: 20 });
    const cached = scanCache.get(key); // Hit
    assert.ok(cached);
    assert.equal(cached.name, 'Zebra TC52');

    const stats = scanCache.getStats();
    assert.equal(stats.hits, 1);
    assert.equal(stats.misses, 1);
  });

  test('supports surgical cache invalidation by predicate', () => {
    scanCache.set('SKU-1001', { itemId: '1001', name: 'Zebra' });
    scanCache.set('SKU-1002', { itemId: '1002', name: 'Honeywell' });

    scanCache.invalidateByPattern((k, v) => v?.itemId === '1001');

    assert.equal(scanCache.get('SKU-1001'), null);
    assert.ok(scanCache.get('SKU-1002'));
  });
});

describe('4. Concurrency Mutex Locking', () => {
  test('serializes concurrent acquisitions for the same resource key', async () => {
    const lockKey = 'item:1001:bin:BIN-A01';
    const executionOrder = [];

    const task1 = async () => {
      const release = await concurrencyMutex.acquire(lockKey);
      await new Promise(r => setTimeout(r, 40));
      executionOrder.push('task1');
      release();
    };

    const task2 = async () => {
      const release = await concurrencyMutex.acquire(lockKey);
      executionOrder.push('task2');
      release();
    };

    await Promise.all([task1(), task2()]);
    assert.deepEqual(executionOrder, ['task1', 'task2']);
    assert.equal(concurrencyMutex.getActiveLocksCount(), 0);
  });
});

describe('5. SuiteScript 2.1 N/record & N/search Mock Engine', () => {
  beforeEach(() => {
    resetDatabase();
  });

  test('search.create finds items and calculates total quantities across bins', () => {
    const itemSearch = search.create({
      type: search.Type.ITEM,
      filters: [['barcode', 'is', 'SKU-1001']]
    });

    const results = itemSearch.run().getRange({ start: 0, end: 1 });
    assert.equal(results.length, 1);

    const item = results[0].data;
    assert.equal(item.sku, 'SKU-1001');
    assert.equal(item.total_qty, 20); // 15 in BIN-A01 + 5 in BIN-A02
    assert.equal(item.bins.length, 2);
  });

  test('record.create executes Bin Transfer and adjusts relational balances atomically', () => {
    const binTransfer = record.create({
      type: record.Type.BIN_TRANSFER,
      isDynamic: true
    });

    binTransfer.setValue({ fieldId: 'location', value: 'LOC-EAST-WH' });
    binTransfer.selectNewLine({ sublistId: 'inventory' });
    binTransfer.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'item', value: '1001' });
    binTransfer.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'frombins', value: 'BIN-A01' });
    binTransfer.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'tobins', value: 'BIN-STAGE' });
    binTransfer.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'quantity', value: 5 });
    binTransfer.commitLine({ sublistId: 'inventory' });

    const transferId = binTransfer.save();
    assert.ok(transferId.startsWith('BT-'));

    // Check balances in SQLite
    const db = getDatabase();
    const fromBal = db.prepare('SELECT qty_on_hand FROM inventory_balances WHERE item_id = ? AND bin_id = ?').get('1001', 'BIN-A01');
    const toBal = db.prepare('SELECT qty_on_hand FROM inventory_balances WHERE item_id = ? AND bin_id = ?').get('1001', 'BIN-STAGE');

    assert.equal(fromBal.qty_on_hand, 10); // 15 - 5 = 10
    assert.equal(toBal.qty_on_hand, 5);    // 0 + 5 = 5
  });

  test('throws INSUFFICIENT_INVENTORY_IN_BIN when transferring more than available', () => {
    const binTransfer = record.create({
      type: record.Type.BIN_TRANSFER,
      isDynamic: true
    });

    binTransfer.selectNewLine({ sublistId: 'inventory' });
    binTransfer.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'item', value: '1001' });
    binTransfer.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'frombins', value: 'BIN-A01' });
    binTransfer.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'tobins', value: 'BIN-STAGE' });
    binTransfer.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'quantity', value: 999 });
    binTransfer.commitLine({ sublistId: 'inventory' });

    assert.throws(() => {
      binTransfer.save();
    }, (err) => {
      return err.name === 'INSUFFICIENT_INVENTORY_IN_BIN';
    });
  });

  test('throws INVALID_BIN_LOCATION when destination bin does not exist', () => {
    const binTransfer = record.create({
      type: record.Type.BIN_TRANSFER,
      isDynamic: true
    });

    binTransfer.selectNewLine({ sublistId: 'inventory' });
    binTransfer.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'item', value: '1001' });
    binTransfer.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'frombins', value: 'BIN-A01' });
    binTransfer.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'tobins', value: 'NONEXISTENT-BIN' });
    binTransfer.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'quantity', value: 1 });
    binTransfer.commitLine({ sublistId: 'inventory' });

    assert.throws(() => {
      binTransfer.save();
    }, (err) => {
      return err.name === 'INVALID_BIN_LOCATION';
    });
  });
});

describe('6. SuiteScript 2.1 RESTlet Execution', () => {
  beforeEach(() => {
    resetDatabase();
  });

  test('RESTlet get handles item lookup', async () => {
    const result = await restlet.get({ action: 'lookup', barcode: 'SKU-1002' });
    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.data.sku, 'SKU-1002');
    assert.equal(result.data.totalQty, 20); // 8 + 12
  });

  test('RESTlet post commits bin transfer successfully', async () => {
    const result = await restlet.post({
      action: 'transfer',
      itemId: '1002',
      fromBin: 'BIN-B01',
      toBin: 'BIN-STAGE',
      quantity: 3,
      tbaSignature: 'MOCK_TBA_TEST_SIGNATURE'
    });

    assert.equal(result.status, 'SUCCESS');
    assert.ok(result.data.transferId.startsWith('BT-'));
    assert.equal(result.data.quantity, 3);
  });
});
