/**
 * RF-SMART NetSuite Mock: Relational Database Engine
 * 
 * Uses Node.js native SQLite engine (node:sqlite DatabaseSync) to simulate
 * Oracle NetSuite's relational ERP datastore (Items, Bins, Inventory Balances, and Bin Transfer transactions).
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory or file-backed database
let dbInstance = null;

export function getDatabase(memoryOnly = true) {
  if (dbInstance) {
    return dbInstance;
  }

  const db = memoryOnly 
    ? new DatabaseSync(':memory:') 
    : new DatabaseSync(path.join(__dirname, 'netsuite_sim.sqlite'));

  // Enable WAL mode & foreign keys for relational consistency
  db.exec('PRAGMA foreign_keys = ON;');

  initSchema(db);
  seedInitialData(db);

  dbInstance = db;
  return dbInstance;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      itemid TEXT PRIMARY KEY,
      sku TEXT UNIQUE NOT NULL,
      displayname TEXT NOT NULL,
      upc TEXT UNIQUE,
      item_type TEXT DEFAULT 'InvtPart',
      base_price REAL DEFAULT 0.0
    );

    CREATE TABLE IF NOT EXISTS bins (
      binnumber TEXT PRIMARY KEY,
      aisle TEXT NOT NULL,
      zone TEXT NOT NULL,
      location_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inventory_balances (
      item_id TEXT NOT NULL,
      bin_id TEXT NOT NULL,
      qty_on_hand INTEGER NOT NULL CHECK(qty_on_hand >= 0),
      PRIMARY KEY (item_id, bin_id),
      FOREIGN KEY (item_id) REFERENCES items(itemid) ON DELETE CASCADE,
      FOREIGN KEY (bin_id) REFERENCES bins(binnumber) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS transfer_logs (
      transfer_id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      from_bin TEXT NOT NULL,
      to_bin TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      tran_date TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      signed_by_tba TEXT
    );
  `);
}

function seedInitialData(db) {
  // Check if items already exist
  const existing = db.prepare('SELECT COUNT(*) as count FROM items').get();
  if (existing.count > 0) return;

  // Insert Bins
  const insertBin = db.prepare(`
    INSERT INTO bins (binnumber, aisle, zone, location_id)
    VALUES (?, ?, ?, ?)
  `);

  const bins = [
    ['BIN-A01', 'A', 'Receiving Staging', 'LOC-EAST-WH'],
    ['BIN-A02', 'A', 'Bulk Storage', 'LOC-EAST-WH'],
    ['BIN-B01', 'B', 'Fast-Pick Front', 'LOC-EAST-WH'],
    ['BIN-B02', 'B', 'Fast-Pick Mid', 'LOC-EAST-WH'],
    ['BIN-B04', 'B', 'High-Rack Storage', 'LOC-EAST-WH'],
    ['BIN-C01', 'C', 'Replenishment', 'LOC-EAST-WH'],
    ['BIN-C02', 'C', 'Reserve Pallets', 'LOC-EAST-WH'],
    ['BIN-STAGE', 'STAGE', 'Outbound Shipping Dock', 'LOC-EAST-WH']
  ];

  for (const bin of bins) {
    insertBin.run(...bin);
  }

  // Insert Warehouse Items
  const insertItem = db.prepare(`
    INSERT INTO items (itemid, sku, displayname, upc, item_type, base_price)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const items = [
    ['1001', 'SKU-1001', 'Zebra TC52 Touch Computer (Android)', '012345678901', 'InvtPart', 1250.00],
    ['1002', 'SKU-1002', 'Honeywell CK65 Rugged Terminal', '012345678902', 'InvtPart', 1420.00],
    ['1003', 'SKU-1003', 'Symbol LS2208 Handheld 1D Laser Scanner', '012345678903', 'InvtPart', 185.00],
    ['1004', 'SKU-1004', 'Industrial Direct Thermal Barcode Labels (Roll of 1000)', '012345678904', 'InvtPart', 28.50]
  ];

  for (const item of items) {
    insertItem.run(...item);
  }

  // Insert Inventory Balances across Bins
  const insertBalance = db.prepare(`
    INSERT INTO inventory_balances (item_id, bin_id, qty_on_hand)
    VALUES (?, ?, ?)
  `);

  const balances = [
    // Zebra TC52 in A01 (15) and A02 (5)
    ['1001', 'BIN-A01', 15],
    ['1001', 'BIN-A02', 5],
    // Honeywell CK65 in B01 (8) and B04 (12)
    ['1002', 'BIN-B01', 8],
    ['1002', 'BIN-B04', 12],
    // Symbol LS2208 in C02 (40)
    ['1003', 'BIN-C02', 40],
    // Thermal Labels in A01 (120) and B02 (80)
    ['1004', 'BIN-A01', 120],
    ['1004', 'BIN-B02', 80]
  ];

  for (const bal of balances) {
    insertBalance.run(...bal);
  }
}

export function resetDatabase() {
  dbInstance = null;
  return getDatabase(true);
}
