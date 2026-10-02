/**
 * RF-SMART NetSuite Mock: Relational Database Engine
 * 
 * Uses Node.js native SQLite engine (node:sqlite DatabaseSync) to simulate
 * Oracle NetSuite's relational ERP datastore (Items, Bins, Inventory Balances, and Bin Transfer transactions).
 * 
 * Extended for household kitchen inventory use:
 * - Kitchen locations as bins (Pantry, Fridge, Freezer, etc.)
 * - Custom item images and names for regular consumer barcodes
 * - File-backed SQLite for data persistence across server restarts
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory or file-backed database
let dbInstance = null;

export function getDatabase(memoryOnly = false) {
  if (dbInstance) {
    return dbInstance;
  }

  const db = memoryOnly 
    ? new DatabaseSync(':memory:') 
    : new DatabaseSync(path.join(__dirname, 'netsuite_sim.sqlite'));

  // Enable WAL mode & foreign keys for relational consistency
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');

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
      base_price REAL DEFAULT 0.0,
      image_url TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bins (
      binnumber TEXT PRIMARY KEY,
      aisle TEXT NOT NULL,
      zone TEXT NOT NULL,
      location_id TEXT NOT NULL,
      display_label TEXT,
      barcode TEXT UNIQUE
    );

    CREATE TABLE IF NOT EXISTS inventory_balances (
      item_id TEXT NOT NULL,
      bin_id TEXT NOT NULL,
      qty_on_hand INTEGER NOT NULL DEFAULT 0 CHECK(qty_on_hand >= 0),
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
  // Check if bins already seeded
  const existingBins = db.prepare('SELECT COUNT(*) as count FROM bins').get();
  if (existingBins.count > 0) return;

  // ----- Kitchen Bins -----
  const insertBin = db.prepare(`
    INSERT OR IGNORE INTO bins (binnumber, aisle, zone, location_id, display_label, barcode)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const bins = [
    // Kitchen locations — the "bins" in our household warehouse
    ['PANTRY',       'Kitchen', 'Dry Storage',      'HOME-KITCHEN', '🥫 Pantry',         'BIN-PANTRY'],
    ['FRIDGE-DOOR',  'Kitchen', 'Refrigerator',     'HOME-KITCHEN', '🧊 Fridge (Door)',   'BIN-FRIDGE-DOOR'],
    ['FRIDGE-SHELF', 'Kitchen', 'Refrigerator',     'HOME-KITCHEN', '🥗 Fridge (Shelf)',  'BIN-FRIDGE-SHELF'],
    ['FRIDGE-VEGE',  'Kitchen', 'Refrigerator',     'HOME-KITCHEN', '🥦 Fridge (Vege)',   'BIN-FRIDGE-VEGE'],
    ['FREEZER',      'Kitchen', 'Freezer',          'HOME-KITCHEN', '❄️ Freezer',          'BIN-FREEZER'],
    ['COUNTER',      'Kitchen', 'Counter Top',      'HOME-KITCHEN', '🍳 Counter',         'BIN-COUNTER'],
    ['CABINET-HIGH', 'Kitchen', 'Upper Cabinets',   'HOME-KITCHEN', '🪣 Cabinet (Upper)', 'BIN-CABINET-HIGH'],
    ['CABINET-LOW',  'Kitchen', 'Lower Cabinets',   'HOME-KITCHEN', '🫙 Cabinet (Lower)', 'BIN-CABINET-LOW'],
    ['SPICE-RACK',   'Kitchen', 'Spice Storage',    'HOME-KITCHEN', '🧂 Spice Rack',      'BIN-SPICE-RACK'],
    ['CART',         'Kitchen', 'Mobile / Transit', 'HOME-KITCHEN', '🛒 Shopping Cart',   'BIN-CART'],
  ];

  for (const bin of bins) {
    insertBin.run(...bin);
  }

  // ----- Demo Items (real-world household products) -----
  // Users can add their own via the scanner app. These are just examples.
  const insertItem = db.prepare(`
    INSERT OR IGNORE INTO items (itemid, sku, displayname, upc, item_type, base_price, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const items = [
    // Use real retail UPCs for the demo items so users can actually scan them
    ['H001', 'SKU-H001', 'Heinz Ketchup 32oz',           '013000006088', 'GroceryItem', 4.99, 'Refrigerate after opening'],
    ['H002', 'SKU-H002', 'Quaker Oats Old Fashioned',    '030000010501', 'GroceryItem', 5.49, 'Keep dry'],
    ['H003', 'SKU-H003', 'Skippy Peanut Butter Creamy',  '037600102988', 'GroceryItem', 3.99, null],
    ['H004', 'SKU-H004', 'Progresso Chicken Soup',       '041196003306', 'GroceryItem', 2.49, null],
  ];

  for (const item of items) {
    insertItem.run(...item);
  }

  // ----- Demo Inventory Balances -----
  const insertBalance = db.prepare(`
    INSERT OR IGNORE INTO inventory_balances (item_id, bin_id, qty_on_hand)
    VALUES (?, ?, ?)
  `);

  const balances = [
    ['H001', 'FRIDGE-DOOR',  2],
    ['H002', 'PANTRY',       1],
    ['H003', 'CABINET-LOW',  1],
    ['H004', 'PANTRY',       3],
  ];

  for (const bal of balances) {
    insertBalance.run(...bal);
  }
}

export function resetDatabase() {
  dbInstance = null;
  return getDatabase(false);
}
