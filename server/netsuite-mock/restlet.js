/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 * 
 * RF-SMART Simulated NetSuite SuiteScript 2.1 RESTlet
 * 
 * In production NetSuite, this script is deployed as an authenticated RESTlet endpoint
 * invoked via signed OAuth 1.0a (TBA) HTTPS calls from the RF-SMART Node.js middleware.
 */

import record from './nRecord.js';
import search from './nSearch.js';

// Simulated ERP processing latency (250ms - 350ms) to replicate cloud NetSuite execution
const SIMULATED_LATENCY_MS = 280;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * RESTlet GET Handler
 * Used for barcode lookups, bin listings, and balance inquiries.
 */
async function get(context) {
  await sleep(SIMULATED_LATENCY_MS);

  const { action = 'lookup', barcode, sku, bin } = context;

  if (action === 'lookup') {
    const term = barcode || sku;
    if (!term) {
      return {
        status: 'ERROR',
        error: {
          code: 'SSS_MISSING_REQD_ARGUMENT',
          message: 'Parameter "barcode" or "sku" is required for item lookup.'
        }
      };
    }

    const itemSearch = search.create({
      type: search.Type.ITEM,
      filters: [
        ['barcode', search.Operator.IS, term]
      ]
    });

    const results = itemSearch.run().getRange({ start: 0, end: 1 });
    if (results.length === 0) {
      return {
        status: 'ERROR',
        error: {
          code: 'RECORD_NOT_FOUND',
          message: `No active warehouse item found matching barcode/SKU: "${term}"`
        }
      };
    }

    const itemData = results[0].data;
    return {
      status: 'SUCCESS',
      data: {
        itemId: itemData.itemid,
        sku: itemData.sku,
        displayName: itemData.displayname,
        upc: itemData.upc,
        totalQty: itemData.total_qty,
        bins: itemData.bins || []
      }
    };
  }

  if (action === 'bins') {
    const binSearch = search.create({ type: search.Type.BIN });
    const results = binSearch.run().getRange({ start: 0, end: 100 });
    return {
      status: 'SUCCESS',
      data: results.map(r => r.data)
    };
  }

  if (action === 'inventory') {
    const invSearch = search.create({ type: search.Type.INVENTORY_BALANCE });
    const results = invSearch.run().getRange({ start: 0, end: 200 });
    return {
      status: 'SUCCESS',
      data: results.map(r => r.data)
    };
  }

  if (action === 'transfers') {
    const txSearch = search.create({ type: search.Type.TRANSACTION });
    const results = txSearch.run().getRange({ start: 0, end: 50 });
    return {
      status: 'SUCCESS',
      data: results.map(r => r.data)
    };
  }

  return {
    status: 'ERROR',
    error: {
      code: 'UNSUPPORTED_ACTION',
      message: `Unknown RESTlet GET action: "${action}"`
    }
  };
}

/**
 * RESTlet POST Handler
 * Used for committing inventory transactions like Bin Transfers.
 */
async function post(context) {
  await sleep(SIMULATED_LATENCY_MS);

  const { action = 'transfer', itemId, fromBin, toBin, quantity, tbaSignature } = context;

  if (action === 'transfer') {
    try {
      // 1. Instantiate NetSuite dynamic Bin Transfer record via SuiteScript N/record
      const binTransfer = record.create({
        type: record.Type.BIN_TRANSFER,
        isDynamic: true
      });

      // 2. Set record header values
      binTransfer.setValue({ fieldId: 'location', value: 'LOC-EAST-WH' });
      binTransfer.setValue({ fieldId: 'trandate', value: new Date().toISOString() });
      binTransfer.setValue({ fieldId: 'memo', value: 'RF-SMART Handheld Mobile Scan Transfer' });
      binTransfer.setValue({ fieldId: 'tbaSignature', value: tbaSignature });

      // 3. Set line item values on 'inventory' sublist
      binTransfer.selectNewLine({ sublistId: 'inventory' });
      binTransfer.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'item', value: itemId });
      binTransfer.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'frombins', value: fromBin });
      binTransfer.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'tobins', value: toBin });
      binTransfer.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'quantity', value: Number(quantity) });
      binTransfer.commitLine({ sublistId: 'inventory' });

      // 4. Save record to execute transaction and update ERP balances
      const recordId = binTransfer.save();

      return {
        status: 'SUCCESS',
        data: {
          transferId: recordId,
          recordType: 'bintransfer',
          itemId,
          fromBin,
          toBin,
          quantity: Number(quantity),
          committedAt: new Date().toISOString()
        }
      };
    } catch (err) {
      return {
        status: 'ERROR',
        error: {
          code: err.name || 'USER_ERROR',
          message: err.message,
          details: err.details || null
        }
      };
    }
  }

  return {
    status: 'ERROR',
    error: {
      code: 'UNSUPPORTED_ACTION',
      message: `Unknown RESTlet POST action: "${action}"`
    }
  };
}

export default {
  get,
  post
};
