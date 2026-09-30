# RF-SMART Prototype: Warehouse Mobile Data Capture & NetSuite ERP Middleware

An exploratory, high-fidelity learning prototype built by **Cedrick Catalan** to master the core architectural patterns, backend middleware strategies, and NetSuite SuiteScript 2.1 integration flows used at **RF-SMART**.

---

## Architecture Blueprint

```
+-------------------------------------------------------------+
|        Rugged Handheld Scanner (Knockout.js MVVM)           |
|        - Barcode input & audio chirps (Web Audio API)       |
|        - Observables, computeds, and fine-grained DOM sync  |
+------------------------------+------------------------------+
                               |
                               | HTTP REST (/api/scanner/...)
                               v
+-------------------------------------------------------------+
|        RF-SMART Node.js Middleware Gateway (Port 7370)       |
|        - GS1-128 & UPC barcode parser                       |
|        - In-memory cache (<5ms response, 429 throttle guard)|
|        - Keyed async mutex concurrency locks                |
|        - NetSuite Token-Based Auth (TBA) OAuth 1.0a signer  |
|        - ERP error normalization                            |
+------------------------------+------------------------------+
                               |
                               | Signed RESTlet Invocation (TBA)
                               v
+-------------------------------------------------------------+
|        NetSuite SuiteScript 2.1 RESTlet & Relational Engine |
|        - AMD Module: define(['N/record', 'N/search'])       |
|        - Dynamic Bin Transfer sublist execution             |
|        - Native SQLite datastore (node:sqlite)              |
|        - Simulated ERP latency window (280ms)               |
+-------------------------------------------------------------+
```

---

## Key Backend Engineering Concepts Implemented

### 1. High-Throughput Buffering & Caching
* **Why it matters:** In a high-velocity physical distribution center, hundreds of handheld scanners scan items constantly (picking, cycle counting, receiving). Direct calls to NetSuite ERP would quickly hit governance unit limits, trigger `429 Too Many Requests`, and leave warehouse workers waiting 300–500ms per scan.
* **Implementation:** The Node middleware checks an in-memory cache (`server/services/cache.js`). Cache hits return in `<5ms`, reducing roundtrips by over 80%. When an inventory transfer occurs, the cache for affected items is surgically invalidated.

### 2. Concurrency Control & Race Condition Mitigation
* **Why it matters:** Two pickers scanning the exact same bin simultaneously could cause inventory overselling or cause NetSuite to throw record locking collisions (`RECORD_LOCKED_BY_ANOTHER_USER`).
* **Implementation:** `server/services/concurrencyManager.js` provides an asynchronous keyed mutex lock per resource (`item:${itemId}:bin:${fromBin}`) that queues simultaneous operations and releases them safely.

### 3. NetSuite Token-Based Authentication (TBA / RFC 5849)
* **Why it matters:** NetSuite RESTlets require OAuth 1.0a HMAC-SHA256 authentication for secure, scriptable headless API calls.
* **Implementation:** `server/services/auth.js` computes compliant OAuth headers by creating the normalized Signature Base String, calculating HMAC-SHA256 with composite consumer and token secrets, and providing nonce/timestamp replay protection.

### 4. SuiteScript 2.1 RESTlet & `N/record` Sublist Semantics
* **Why it matters:** Demonstrates deep familiarity with NetSuite's official JavaScript runtime.
* **Implementation:** 
  ```javascript
  const binTransfer = record.create({ type: record.Type.BIN_TRANSFER, isDynamic: true });
  binTransfer.selectNewLine({ sublistId: 'inventory' });
  binTransfer.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'item', value: itemId });
  binTransfer.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'frombins', value: fromBin });
  binTransfer.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'tobins', value: toBin });
  binTransfer.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'quantity', value: quantity });
  binTransfer.commitLine({ sublistId: 'inventory' });
  const txId = binTransfer.save();
  ```

### 5. Knockout.js MVVM vs. React Mental Model
* **Observables vs State:** Knockout uses getter/setter functions `ko.observable(val)` rather than React's array tuple `[state, setState]`.
* **Automatic Dependency Tracking:** `ko.computed` automatically registers dependencies on any observables evaluated inside it; no manual `useEffect` or `useMemo` dependency array is required.
* **Fine-Grained DOM Updates:** Knockout updates only the specific text node or attribute bound to the observable via pub/sub notifications, avoiding React's Virtual DOM tree reconciliation.

---

## Getting Started

### Prerequisites
* Node.js v22+ (v26.8.1 recommended; uses native `node:sqlite`)

### Installation & Launch

```bash
# 1. Install dependencies
npm install

# 2. Run backend automated test suite (16 tests)
npm test

# 3. Start the development server (runs on port 7370)
npm run dev
```

### Accessing the Prototype
* Open your browser to **`http://localhost:7370`**.
* The application is pre-registered with the **Local Dev Dashboard** on port 7370.

---

## Automated Test Coverage

The test suite in `test/scanner.test.js` covers:
1. **Industrial Barcode Parser:** SKUs, UPC-A, Bin barcodes, and GS1-128 Application Identifiers.
2. **NetSuite TBA:** RFC 5849 OAuth 1.0a HMAC-SHA256 signature generation and header validation.
3. **In-Memory Cache:** Miss tracking, hit tracking, and surgical invalidation.
4. **Concurrency Mutex:** Async resource locking and serialization under concurrency.
5. **SuiteScript Mock Engine:** `N/search` lookups, `N/record` bin transfers, atomic balance updates, `INSUFFICIENT_INVENTORY_IN_BIN` error handling.
6. **RESTlet Handlers:** End-to-end `get` and `post` execution.
