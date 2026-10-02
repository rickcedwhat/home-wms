/**
 * RF-SMART NetSuite Mock: Relational Database Engine
 * 
 * Uses Node.js native SQLite engine (node:sqlite DatabaseSync) to simulate
 * Oracle NetSuite's relational ERP datastore (Items, Bins, Inventory Balances, and Bin Transfer transactions).
 * 
 * Supports both:
 * - Enterprise Warehouse Logistics (Zebra TC52, Fast-Pick zones, High-Racks)
 * - Real-world Household / Kitchen Inventory (Pantry, Refrigerator, Cabinets, Counter)
 * - Custom item images, UPC barcode registration, and persistence
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let dbInstance = null;

export function getDatabase(memoryOnly = false) {
  if (dbInstance) {
    return dbInstance;
  }

  const db = memoryOnly 
    ? new DatabaseSync(':memory:') 
    : new DatabaseSync(path.join(__dirname, 'netsuite_sim.sqlite'));

  // Enable foreign keys & WAL mode for speed and relational consistency
  db.exec('PRAGMA foreign_keys = ON;');
  try {
    db.exec('PRAGMA journal_mode = WAL;');
  } catch (_) {
    // In-memory ignores journal_mode WAL
  }

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
  const existingBins = db.prepare('SELECT COUNT(*) as count FROM bins').get();
  if (existingBins.count > 0) return;

  const insertBin = db.prepare(`
    INSERT OR IGNORE INTO bins (binnumber, aisle, zone, location_id, display_label, barcode)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  // Warehouse Bins (required for NetSuite backend simulation tests)
  const warehouseBins = [
    ['BIN-A01', 'A', 'Receiving Staging', 'LOC-EAST-WH', '📦 Receiving Staging (A01)', 'BIN-A01'],
    ['BIN-A02', 'A', 'Bulk Storage', 'LOC-EAST-WH', '📦 Bulk Storage (A02)', 'BIN-A02'],
    ['BIN-B01', 'B', 'Fast-Pick Front', 'LOC-EAST-WH', '⚡ Fast-Pick Front (B01)', 'BIN-B01'],
    ['BIN-B02', 'B', 'Fast-Pick Mid', 'LOC-EAST-WH', '⚡ Fast-Pick Mid (B02)', 'BIN-B02'],
    ['BIN-B04', 'B', 'High-Rack Storage', 'LOC-EAST-WH', '🏗 High-Rack Storage (B04)', 'BIN-B04'],
    ['BIN-C01', 'C', 'Replenishment', 'LOC-EAST-WH', '🔄 Replenishment (C01)', 'BIN-C01'],
    ['BIN-C02', 'C', 'Reserve Pallets', 'LOC-EAST-WH', '🧱 Reserve Pallets (C02)', 'BIN-C02'],
    ['BIN-STAGE', 'STAGE', 'Outbound Shipping Dock', 'LOC-EAST-WH', '🚚 Shipping Dock (STAGE)', 'BIN-STAGE']
  ];

  for (const bin of warehouseBins) {
    insertBin.run(...bin);
  }

  // Kitchen Bins (for household scanning prototype)
  const kitchenBins = [
    ['PANTRY',       'Kitchen', 'Dry Storage',      'HOME-KITCHEN', '🥫 Pantry',         'BIN-PANTRY'],
    ['FRIDGE-DOOR',  'Kitchen', 'Refrigerator',     'HOME-KITCHEN', '🧊 Fridge (Door)',   'BIN-FRIDGE-DOOR'],
    ['FRIDGE-SHELF', 'Kitchen', 'Refrigerator',     'HOME-KITCHEN', '🥗 Fridge (Shelf)',  'BIN-FRIDGE-SHELF'],
    ['FREEZER',      'Kitchen', 'Freezer',          'HOME-KITCHEN', '❄️ Freezer',          'BIN-FREEZER'],
    ['COUNTER',      'Kitchen', 'Counter Top',      'HOME-KITCHEN', '🍳 Kitchen Counter', 'BIN-COUNTER'],
    ['CABINET-HIGH', 'Kitchen', 'Upper Cabinets',   'HOME-KITCHEN', '🪣 Upper Cabinet',   'BIN-CABINET-HIGH'],
    ['CABINET-LOW',  'Kitchen', 'Lower Cabinets',   'HOME-KITCHEN', '🫙 Lower Cabinet',   'BIN-CABINET-LOW'],
    ['SPICE-RACK',   'Kitchen', 'Spice Storage',    'HOME-KITCHEN', '🧂 Spice Rack',      'BIN-SPICE-RACK']
  ];

  for (const bin of kitchenBins) {
    insertBin.run(...bin);
  }

  const insertItem = db.prepare(`
    INSERT OR IGNORE INTO items (itemid, sku, displayname, upc, item_type, base_price, image_url, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Warehouse items (for tests & enterprise simulation)
  const warehouseItems = [
    ['1001', 'SKU-1001', 'Zebra TC52 Touch Computer (Android)', '012345678901', 'InvtPart', 1250.00, null, 'Rugged mobile terminal'],
    ['1002', 'SKU-1002', 'Honeywell CK65 Rugged Terminal', '012345678902', 'InvtPart', 1420.00, null, 'Alphanumeric physical keypad'],
    ['1003', 'SKU-1003', 'Symbol LS2208 Handheld 1D Laser Scanner', '012345678903', 'InvtPart', 185.00, null, 'USB bi-directional scanner'],
    ['1004', 'SKU-1004', 'Industrial Direct Thermal Labels (Roll of 1000)', '012345678904', 'InvtPart', 28.50, null, '4x6 in shipping labels']
  ];

  for (const item of warehouseItems) {
    insertItem.run(...item);
  }

  // Household items with real retail UPC barcodes
  const groceryItems = [
    ['H001', 'SKU-H001', 'Heinz Tomato Ketchup 32oz', '013000006088', 'GroceryItem', 4.99, null, 'Refrigerate after opening'],
    ['H002', 'SKU-H002', 'Quaker Oats Old Fashioned 42oz', '030000010501', 'GroceryItem', 5.49, null, 'Dry pantry storage'],
    ['H003', 'SKU-H003', 'Skippy Creamy Peanut Butter 16oz', '037600102988', 'GroceryItem', 3.99, null, 'Store at room temp'],
    ['H004', 'SKU-H004', 'Progresso Traditional Chicken Noodle Soup', '041196003306', 'GroceryItem', 2.49, null, 'Pantry shelf'],
    ['H005', 'SKU-H005', 'Huy Fong Sriracha Hot Chili Sauce 28oz', '024463061095', 'GroceryItem', 4.29, null, 'Spice rack / counter']
  ];

  for (const item of groceryItems) {
    insertItem.run(...item);
  }

  const insertBalance = db.prepare(`
    INSERT OR IGNORE INTO inventory_balances (item_id, bin_id, qty_on_hand)
    VALUES (?, ?, ?)
  `);

  const balances = [
    // Warehouse balances (required by tests)
    ['1001', 'BIN-A01', 15],
    ['1001', 'BIN-A02', 5],
    ['1002', 'BIN-B01', 8],
    ['1002', 'BIN-B04', 12],
    ['1003', 'BIN-C02', 40],
    ['1004', 'BIN-A01', 120],
    ['1004', 'BIN-B02', 80],

    // Household balances
    ['H001', 'FRIDGE-DOOR',  2],
    ['H002', 'PANTRY',       3],
    ['H003', 'CABINET-LOW',  2],
    ['H004', 'PANTRY',       5],
    ['H005', 'SPICE-RACK',   2]
  ];

  for (const bal of balances) {
    insertBalance.run(...bal);
  }
}

export function resetDatabase() {
  dbInstance = null;
  return getDatabase(true);
}
