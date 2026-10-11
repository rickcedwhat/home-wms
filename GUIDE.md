# RF-SMART Backend Architecture & Code Walkthrough Guide

This guide breaks down the core backend systems powering this RF-SMART warehouse mobile middleware and NetSuite SuiteScript 2.1 integration. Use this guide to understand how each piece functions and how to articulate these design decisions in an engineering interview.

---

## Architecture Overview

```
 [ Rugged Zebra Scanner (TC52x) ]
              │
              │  HTTP/JSON (REST)
              ▼
 ┌─────────────────────────────────────────────────────────────┐
 │               Node.js Middleware (Port 7370)                │
 │                                                             │
 │  1. Barcode Parser (GS1-128 AI, UPC-A, SKU, Bin)           │
 │  2. Token-Based Authentication (RFC 5849 OAuth 1.0a)        │
 │  3. In-Memory Cache (Sub-5ms response vs 280ms ERP)         │
 │  4. Async Keyed Mutex (Serializes concurrent bin transfers) │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                │  Simulated ERP Latency (280ms)
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │            Mock NetSuite SuiteScript 2.1 Engine             │
 │                                                             │
 │  • RESTlet: AMD define(['N/record', 'N/search'])            │
 │  • Dynamic Sublist Operations (selectNewLine, commitLine)   │
 │  • SQLite Ledger: items, bins, inventory_balances           │
 └─────────────────────────────────────────────────────────────┘
```

---

## 1. High-Speed Middleware & Request Pipeline
**File**: `server/routes/scanner.js`

### What It Does & Why It Matters
In high-volume distribution centers, warehouse pickers scan thousands of items per shift. If every scan had to endure a 200–500ms roundtrip to Oracle NetSuite's cloud ERP, the scanner UI would feel sluggish and pick rates would drop. Furthermore, NetSuite enforces strict tier-based concurrency limits (e.g. 10–25 simultaneous requests per account); unthrottled handheld scans will trigger HTTP `429 Too Many Requests` errors.

The Node.js middleware acts as an enterprise shock absorber:
1. Validates and parses barcodes before touching NetSuite.
2. Serves repeated lookups directly from memory cache (<5ms).
3. Handles Token-Based Auth (TBA) so mobile scanners never store long-lived ERP credentials.
4. Serializes concurrent operations on identical inventory resources.

### Key Code Paths
- `GET /api/scanner/lookup` (`scanner.js:80`): Resolves raw scan strings (SKU, UPC, GS1-128) via cache or NetSuite RESTlet.
- `POST /api/scanner/transfer` (`scanner.js:560`): Wraps inventory movements in an `AsyncKeyedMutex` lock, invokes NetSuite's `bintransfer` record, and surgically invalidates stale cache keys.
- Error Normalization (`scanner.js:696`): Catches NetSuite SuiteScript error codes (`INSUFFICIENT_INVENTORY_IN_BIN`, `INVALID_BIN_LOCATION`, `RECORD_LOCKED`) and translates them into friendly, localized messages for warehouse floor operators.

---

## 2. Token-Based Authentication (TBA / OAuth 1.0a)
**File**: `server/services/auth.js`

### What It Does & Why It Matters
NetSuite deprecates basic username/password authentication for RESTlets. Enterprise integrations use Token-Based Authentication (TBA) conforming to RFC 5849 (OAuth 1.0a) with HMAC-SHA256 signatures.

TBA ensures:
- **No Stored Passwords**: Requests are authenticated with cryptographically signed tokens.
- **Replay Attack Defense**: Every request requires a cryptographically random `oauth_nonce` and Unix `oauth_timestamp`. NetSuite rejects duplicate nonces or expired timestamps.
- **Payload Integrity**: The HTTP method, URL, and OAuth parameters are concatenated into a strict signature base string and hashed using the consumer secret and token secret.

### Key Functions
- `generateTBAHeader(method, baseUrl, queryParams)` (`auth.js:23`): Creates the `OAuth realm="...", oauth_consumer_key="...", oauth_signature="..."` header and signature metadata.
- `verifyTBAHeader(headerString)` (`auth.js:84`): Server-side validation verifying that all required OAuth 1.0a parameters are present and the timestamp is within a 5-minute clock drift window.

---

## 3. Industrial GS1-128 & Barcode Parsing
**File**: `server/services/barcodeParser.js`

### What It Does & Why It Matters
Modern distribution centers do not just scan single UPCs. Pallets and cartons carry composite GS1-128 (formerly UCC/EAN-128) barcodes containing multiple data elements prefixed by 2- to 4-digit Application Identifiers (AIs):
- `(01)`: 14-digit Global Trade Item Number (GTIN)
- `(10)`: Batch / Lot Number (variable length)
- `(30)`: Variable Quantity
- `(21)`: Serial Number

A picker scanning a single GS1 barcode on a pallet can immediately register the SKU, quantity, and lot number simultaneously without three separate scans.

### Key Functions
- `parseBarcode(rawInput)` (`barcodeParser.js:32`):
  - Detects GS1 AI strings (e.g. `(01)00012345678901(30)5(10)LOT-2026A`).
  - Matches 12-digit standard UPC-A (`012345678905`).
  - Identifies warehouse Bin locations (e.g. `BIN-A01`, `BIN-STAGE`).
  - Falls back gracefully to alphanumeric internal SKUs (`SKU-1001`).

---

## 4. Sub-5ms In-Memory Caching & Surgical Invalidation
**File**: `server/services/cache.js`

### What It Does & Why It Matters
When 50 warehouse workers scan the same fast-moving consumer goods (FMCG) item over and over during order picking, hitting NetSuite every time wastes API governance units and risks rate limits.

Our in-memory caching engine achieves:
- **Sub-5ms Lookups**: Reads directly from memory, providing instantaneous feedback on handheld scanners.
- **TTL Expiration**: Configurable Time-To-Live (default 60 seconds) ensures data remains reasonably fresh.
- **Surgical Invalidation**: When an inventory transfer occurs, the system does **not** flush the entire cache. It specifically purges cached entries matching the affected `itemId` via `invalidateByPattern`, leaving other unaffected cached inventory intact.

### Key Functions
- `scanCache.get(key)` / `scanCache.set(key, value)` (`cache.js:23-49`): Constant-time $O(1)$ lookups with automatic expiration checks.
- `scanCache.invalidateByPattern(predicate)` (`cache.js:61-70`): Targeted key purging after state changes.

---

## 5. Async Keyed Mutex (Race Condition Defense)
**File**: `server/services/concurrencyManager.js`

### What It Does & Why It Matters
Consider this classic warehouse race condition:
- Bin `BIN-A01` has exactly **10 units** of `SKU-1001`.
- Picker A scans `SKU-1001` to transfer **8 units** to `BIN-STAGE`.
- Simultaneously (within 50ms), Picker B scans `SKU-1001` to transfer **5 units** to `BIN-QC`.
- Without serialization, both read 10 units available. Both attempt to transfer. The ledger enters a negative inventory state (-3 units) or crashes with an ERP concurrency lock exception.

`AsyncKeyedMutex` locks operations per unique resource key (`item:1001:bin:BIN-A01`):
- Picker A acquires the lock; Picker B's operation is queued asynchronously.
- Picker A's transfer completes (balance drops to 2 units).
- Picker B's transfer runs next, sees only 2 units remaining, and returns a clean, user-friendly `INSUFFICIENT_INVENTORY_IN_BIN` error.
- Pickers working on **different** items or bins operate fully in parallel without blocking each other.

### Key Functions
- `concurrencyMutex.acquire(key, timeoutMs)` (`concurrencyManager.js:17`): Chains asynchronous promises to enforce FIFO execution per resource key and returns a `releaseLock` callback to be invoked inside a `finally` block.

---

## 6. SuiteScript 2.1 AMD RESTlet & Dynamic Sublist Mutations
**Files**: `server/netsuite-mock/restlet.js`, `server/netsuite-mock/nRecord.js`, `server/netsuite-mock/nSearch.js`

### What It Does & Why It Matters
NetSuite's modern SuiteScript 2.1 API uses Asynchronous Module Definition (AMD) syntax (`define(['N/record', 'N/search'], ...)`). 

In standard mode, sublist lines cannot be inspected mid-edit. In **dynamic mode** (`isDynamic: true`), SuiteScript behaves like the NetSuite UI: you select a new line, set fields one by one (triggering sourcing and validation rules), commit the line, and then save the parent transaction.

### Dynamic Sublist Workflow
```javascript
const rec = record.create({
  type: record.Type.INVENTORY_TRANSFER,
  isDynamic: true
});

// Set transaction body fields
rec.setValue({ fieldId: 'subsidiary', value: 1 });
rec.setValue({ fieldId: 'location', value: 1 });

// Dynamic line entry on the 'inventory' sublist
rec.selectNewLine({ sublistId: 'inventory' });
rec.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'item', value: itemId });
rec.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'quantity', value: quantity });
rec.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'frombin', value: fromBinId });
rec.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'tobin', value: toBinId });
rec.commitLine({ sublistId: 'inventory' });

// Persist transaction atomically
const transferId = rec.save();
```

---

## Quick Interview Talking Points
1. **Middleware Architecture**: "I designed the Node.js middleware layer to decouple high-frequency warehouse scanning from NetSuite's concurrency-constrained cloud API, using in-memory caching and keyed async mutexes to protect NetSuite from 429 limits while maintaining sub-5ms device latency."
2. **Security**: "We implemented RFC 5849 OAuth 1.0a Token-Based Authentication with HMAC-SHA256 signatures, nonces, and timestamp validation to prevent replay attacks and ensure mobile scanners never store raw ERP credentials."
3. **Data Capture**: "Our barcode parser supports GS1-128 Application Identifiers, allowing a single scan of a carton or pallet to extract GTIN, Lot Number, and Quantity in one go."
4. **Data Integrity**: "To eliminate negative inventory and double-pick race conditions, we built an `AsyncKeyedMutex` that locks transactions at the granular `item:bin` level without bottlenecking unrelated warehouse movements."
