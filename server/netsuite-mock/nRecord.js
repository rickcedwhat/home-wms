/**
 * Mock implementation of Oracle NetSuite SuiteScript 2.1 'N/record' module.
 * 
 * Provides record.create(), record.load(), record.Type constants,
 * and dynamic sublist line manipulation (selectNewLine, setCurrentSublistValue, commitLine, save).
 */

import { getDatabase } from './db.js';

let transferSeq = 1000;

export const Type = {
  BIN_TRANSFER: 'bintransfer',
  INVENTORY_ITEM: 'inventoryitem',
  INVENTORY_ADJUSTMENT: 'inventoryadjustment'
};

class MockSublistLine {
  constructor() {
    this.fields = {};
  }
  set(fieldId, value) {
    this.fields[fieldId] = value;
  }
  get(fieldId) {
    return this.fields[fieldId];
  }
}

class MockRecord {
  constructor(type, isDynamic = true) {
    this.type = type;
    this.isDynamic = isDynamic;
    this.fields = {};
    this.sublists = {
      inventory: []
    };
    this.currentLine = null;
    this.currentSublistId = null;
  }

  setValue({ fieldId, value }) {
    this.fields[fieldId] = value;
    return this;
  }

  getValue({ fieldId }) {
    return this.fields[fieldId];
  }

  selectNewLine({ sublistId }) {
    this.currentSublistId = sublistId;
    this.currentLine = new MockSublistLine();
    return this;
  }

  setCurrentSublistValue({ sublistId, fieldId, value }) {
    if (!this.currentLine || this.currentSublistId !== sublistId) {
      throw new Error(`SuiteScriptError: No line currently selected on sublist ${sublistId}`);
    }
    this.currentLine.set(fieldId, value);
    return this;
  }

  getCurrentSublistValue({ sublistId, fieldId }) {
    if (!this.currentLine || this.currentSublistId !== sublistId) {
      throw new Error(`SuiteScriptError: No line currently selected on sublist ${sublistId}`);
    }
    return this.currentLine.get(fieldId);
  }

  commitLine({ sublistId }) {
    if (!this.currentLine || this.currentSublistId !== sublistId) {
      throw new Error(`SuiteScriptError: Cannot commit line - sublist ${sublistId} does not match active line.`);
    }
    if (!this.sublists[sublistId]) {
      this.sublists[sublistId] = [];
    }
    this.sublists[sublistId].push(this.currentLine);
    this.currentLine = null;
    this.currentSublistId = null;
    return this;
  }

  getLineCount({ sublistId }) {
    return (this.sublists[sublistId] || []).length;
  }

  getSublistValue({ sublistId, fieldId, line }) {
    const lines = this.sublists[sublistId] || [];
    if (!lines[line]) return null;
    return lines[line].get(fieldId);
  }

  /**
   * NetSuite record.save() execution against the relational SQLite datastore.
   */
  save() {
    const db = getDatabase();

    if (this.type === Type.BIN_TRANSFER) {
      const lines = this.sublists.inventory || [];
      if (lines.length === 0) {
        const err = new Error('SuiteScriptError: Bin Transfer requires at least one inventory line.');
        err.name = 'RECORD_VALIDATION_ERROR';
        throw err;
      }

      // Execute within an SQLite transaction for atomicity
      db.exec('BEGIN TRANSACTION;');
      try {
        const transferIds = [];

        for (const line of lines) {
          const itemId = line.get('item');
          const fromBin = line.get('frombins') || line.get('frombin');
          const toBin = line.get('tobins') || line.get('tobin');
          const quantity = Number(line.get('quantity'));

          if (!itemId || !fromBin || !toBin || !quantity || quantity <= 0) {
            const err = new Error('SuiteScriptError: Missing required fields (item, frombin, tobin, quantity > 0)');
            err.name = 'INVALID_FLD_VALUE';
            throw err;
          }

          if (fromBin === toBin) {
            const err = new Error(`SuiteScriptError: Source and destination bin cannot be identical (${fromBin})`);
            err.name = 'INVALID_BIN_COMBINATION';
            throw err;
          }

          // Verify destination bin exists
          const binCheck = db.prepare('SELECT binnumber FROM bins WHERE binnumber = ?').get(toBin);
          if (!binCheck) {
            const err = new Error(`SuiteScriptError: Destination bin '${toBin}' does not exist in location.`);
            err.name = 'INVALID_BIN_LOCATION';
            throw err;
          }

          // Verify current available balance at fromBin
          const balanceRow = db.prepare(`
            SELECT qty_on_hand FROM inventory_balances
            WHERE item_id = ? AND bin_id = ?
          `).get(itemId, fromBin);

          const available = balanceRow ? balanceRow.qty_on_hand : 0;
          if (available < quantity) {
            const err = new Error(
              `SuiteScriptError: Insufficient inventory for item ${itemId} in bin ${fromBin}. Available: ${available}, Requested: ${quantity}`
            );
            err.name = 'INSUFFICIENT_INVENTORY_IN_BIN';
            err.details = { itemId, fromBin, available, requested: quantity };
            throw err;
          }

          // 1. Decrement fromBin
          const newFromQty = available - quantity;
          db.prepare(`
            UPDATE inventory_balances
            SET qty_on_hand = ?
            WHERE item_id = ? AND bin_id = ?
          `).run(newFromQty, itemId, fromBin);

          // 2. Increment toBin (UPSERT)
          db.prepare(`
            INSERT INTO inventory_balances (item_id, bin_id, qty_on_hand)
            VALUES (?, ?, ?)
            ON CONFLICT(item_id, bin_id) DO UPDATE SET
              qty_on_hand = qty_on_hand + excluded.qty_on_hand
          `).run(itemId, toBin, quantity);

          // 3. Insert into transfer_logs (sync sequence with DB so restarts never collide)
          const maxRow = db.prepare(`
            SELECT MAX(CAST(SUBSTR(transfer_id, 9) AS INTEGER)) AS max_seq
            FROM transfer_logs
            WHERE transfer_id LIKE 'BT-____-%'
          `).get();
          transferSeq = Math.max(transferSeq, (maxRow && maxRow.max_seq) || 1000) + 1;
          const transferId = `BT-${new Date().getFullYear()}-${transferSeq}`;
          transferIds.push(transferId);

          db.prepare(`
            INSERT INTO transfer_logs (
              transfer_id, item_id, from_bin, to_bin, quantity, tran_date, status, created_at, signed_by_tba
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            transferId,
            itemId,
            fromBin,
            toBin,
            quantity,
            new Date().toISOString().split('T')[0],
            'COMMITTED',
            new Date().toISOString(),
            this.fields.tbaSignature || 'OAUTH-1.0a-OK'
          );
        }

        db.exec('COMMIT;');
        return transferIds[0];
      } catch (err) {
        db.exec('ROLLBACK;');
        throw err;
      }
    }

    throw new Error(`SuiteScriptError: Unsupported record type '${this.type}'`);
  }
}

export function create({ type, isDynamic = true }) {
  return new MockRecord(type, isDynamic);
}

export default {
  Type,
  create
};
