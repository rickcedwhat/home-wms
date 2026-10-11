/**
 * Mock implementation of Oracle NetSuite SuiteScript 2.1 'N/search' module.
 * 
 * Supports search.create(), search.Type, search.Operator,
 * and search.run().getRange({ start, end }) with .getValue() and .getText().
 */

import { getDatabase } from './db.js';

export const Type = {
  ITEM: 'item',
  BIN: 'bin',
  INVENTORY_BALANCE: 'inventorybalance',
  TRANSACTION: 'transaction'
};

export const Operator = {
  IS: 'is',
  ANYOF: 'anyof',
  EQUALTO: 'equalto',
  CONTAINS: 'contains'
};

class MockSearchResult {
  constructor(data) {
    this.data = data;
  }

  getValue(fieldId) {
    return this.data[fieldId] !== undefined ? this.data[fieldId] : null;
  }

  getText(fieldId) {
    const val = this.getValue(fieldId);
    return val !== null && val !== undefined ? String(val) : '';
  }
}

class MockSearchResultSet {
  constructor(results) {
    this.results = results;
  }

  getRange({ start = 0, end = 50 } = {}) {
    return this.results.slice(start, end);
  }

  each(callback) {
    for (let i = 0; i < this.results.length; i++) {
      const continueLoop = callback(this.results[i], i);
      if (continueLoop === false) break;
    }
  }
}

class MockSearch {
  constructor(type, filters = [], columns = []) {
    this.type = type;
    this.filters = filters;
    this.columns = columns;
  }

  run() {
    const db = getDatabase();
    let rows = [];

    if (this.type === Type.ITEM) {
      // Find filter by barcode / SKU / UPC / itemid
      let query = `
        SELECT 
          i.itemid,
          i.sku,
          i.displayname,
          i.upc,
          i.item_type,
          i.base_price,
          i.image_url,
          i.notes,
          i.default_bin_id,
          i.store,
          COALESCE(SUM(b.qty_on_hand), 0) as total_qty
        FROM items i
        LEFT JOIN inventory_balances b ON i.itemid = b.item_id
      `;

      const params = [];
      const whereClauses = [];

      for (const filter of this.filters) {
        if (Array.isArray(filter)) {
          const [field, , value] = filter;
          if (field === 'barcode' || field === 'sku_or_upc') {
            whereClauses.push('(i.sku = ? OR i.upc = ? OR i.itemid = ?)');
            params.push(value, value, value);
          } else if (field === 'sku') {
            whereClauses.push('i.sku = ?');
            params.push(value);
          } else if (field === 'upc') {
            whereClauses.push('i.upc = ?');
            params.push(value);
          } else if (field === 'itemid') {
            whereClauses.push('i.itemid = ?');
            params.push(value);
          }
        }
      }

      if (whereClauses.length > 0) {
        query += ' WHERE ' + whereClauses.join(' AND ');
      }
      query += ' GROUP BY i.itemid';

      const itemRows = db.prepare(query).all(...params);

      // Fetch per-bin balances for each found item
      rows = itemRows.map(item => {
        const binRows = db.prepare(`
          SELECT 
            ib.bin_id,
            ib.qty_on_hand,
            b.aisle,
            b.zone,
            b.display_label
          FROM inventory_balances ib
          JOIN bins b ON ib.bin_id = b.binnumber
          WHERE ib.item_id = ? AND ib.qty_on_hand > 0
          ORDER BY ib.bin_id ASC
        `).all(item.itemid);

        return {
          ...item,
          bins: binRows
        };
      });
    } else if (this.type === Type.BIN) {
      rows = db.prepare(`
        SELECT binnumber, aisle, zone, location_id, display_label, barcode
        FROM bins
        ORDER BY binnumber ASC
      `).all();
    } else if (this.type === Type.INVENTORY_BALANCE) {
      rows = db.prepare(`
        SELECT 
          ib.item_id,
          i.sku,
          i.displayname,
          i.upc,
          i.image_url,
          ib.bin_id,
          ib.qty_on_hand
        FROM inventory_balances ib
        JOIN items i ON ib.item_id = i.itemid
        ORDER BY ib.bin_id ASC, i.sku ASC
      `).all();
    } else if (this.type === Type.TRANSACTION) {
      rows = db.prepare(`
        SELECT 
          t.transfer_id,
          t.item_id,
          i.sku,
          i.displayname,
          t.from_bin,
          t.to_bin,
          t.quantity,
          t.tran_date,
          t.status,
          t.created_at
        FROM transfer_logs t
        JOIN items i ON t.item_id = i.itemid
        ORDER BY t.created_at DESC
        LIMIT 50
      `).all();
    }

    const wrappedResults = rows.map(r => new MockSearchResult(r));
    return new MockSearchResultSet(wrappedResults);
  }
}

export function create({ type, filters = [], columns = [] }) {
  return new MockSearch(type, filters, columns);
}

export default {
  Type,
  Operator,
  create
};
