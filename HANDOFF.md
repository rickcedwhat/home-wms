# RF-SMART Prototype Handoff & Architecture Blueprint

## Purpose of this Project
This repository is an exploratory, realistic learning prototype built by Cedrick Catalan. The goal is to get hands-on experience with the exact technology stack and architectural patterns used at RF-SMART before upcoming engineering interview rounds.

RF-SMART builds mobile data capture systems for physical warehouses. Handheld barcode scanners communicate with custom Node.js middleware, which validates transactions and synchronizes inventory records into Oracle NetSuite ERP via SuiteScript 2.1 RESTlets.

This prototype simulates that entire lifecycle locally with zero external dependencies and no paid enterprise NetSuite license.

---

## High-Level System Architecture

```
+------------------------------------+
|  Handheld Scanner (Knockout.js)   |  <-- Mobile viewport SPA (Zebra/Honeywell simulation)
|  - Barcode input & audio chimes    |
|  - Observables & MVVM data-bind    |
+-----------------+------------------+
                  |
                  | HTTP REST (Local Wi-Fi simulation)
                  v
+-----------------+------------------+
|  RF-SMART Node.js Middleware      |  <-- Express service layer on port 5190
|  - Input validation & rate limits  |
|  - In-memory cache layer           |
|  - Token-Based Auth (TBA) signing  |
+-----------------+------------------+
                  |
                  | Signed HTTPS POST
                  v
+-----------------+------------------+
|  Mock NetSuite SuiteScript Core    |  <-- Emulates NetSuite RESTlet environment
|  - N/record & N/search mock APIs   |
|  - Relational SQLite / memory DB   |
|  - Simulated ERP latency (300ms)   |
+------------------------------------+
```

---

## Three Core Layers to Build

### 1. Handheld Scanner Frontend (Knockout.js)
A mobile-friendly Single Page Application designed to mimic rugged warehouse barcode scanners:
* Uses Knockout's MVVM pattern with pure HTML templates and JavaScript ViewModels.
* Has an autofocusing barcode input with `data-bind="textInput: scannedBarcode"`.
* Features simulated barcode buttons (or keystroke triggers) so Cedrick can click sample barcodes ("SKU-1001", "BIN-A01", "BIN-B04") without physical hardware.
* Shows live reactive UI states: scanning state, item details card, quantity input, and transfer confirmation.
* Plays an audio beep and flashes green on successful scan, or flashes red and buzzes on an invalid barcode.

### 2. RF-SMART Node.js Middleware (Express)
The fast gateway and buffer service:
* Listens on port 5190 (registered with local-dev-dashboard).
* Endpoints:
  * `GET /api/scanner/lookup?barcode=...`: Validates barcode format, checks local memory cache, and returns item metadata in under 20ms.
  * `POST /api/scanner/transfer`: Validates payload (`itemId`, `fromBin`, `toBin`, `quantity`), generates signed mock TBA headers, and delegates execution to the mock ERP layer.
* Demonstrates why Node.js is needed in front of NetSuite: absorbs high-frequency scan traffic, prevents 429 rate limit errors from the ERP, and keeps device response times instant.

### 3. Mock NetSuite SuiteScript 2.1 RESTlet & Relational Database
A simulated NetSuite environment:
* Implements the SuiteScript 2.1 AMD module structure (`define(['N/record', 'N/search'], ...)`).
* Backed by a simple SQLite database or in-memory tables containing:
  * Items (`itemid`, `displayname`, `sku`, `total_qty`)
  * Bins (`binnumber`, `aisle`, `location_id`)
  * Inventory Balances (`item_id`, `bin_id`, `qty_on_hand`)
  * Transfer Log (`transfer_id`, `item_id`, `from_bin`, `to_bin`, `quantity`, `timestamp`)
* Injects an intentional 250ms to 400ms delay to realistically simulate NetSuite ERP processing times.

---

## Primary Learning Opportunities for Cedrick

### 1. Knockout.js vs React Mental Model
* Observables vs State: Understanding `ko.observable(val)` as a getter/setter function vs React's `[val, setVal]`.
* Automatic Dependency Tracking: Learning how `ko.computed` figures out its own dependencies automatically, unlike React's manual `useMemo` dependency array.
* Fine-Grained DOM Updates: Observing how Knockout surgically updates a single text node via pub/sub subscriptions without re-rendering the whole component tree.
* Two-Way Binding: Experiencing how `data-bind="textInput: myVar"` syncs both ways automatically.

### 2. Backend Middleware & Integration Patterns
* High-Throughput Buffering: How to handle bursts of warehouse scans gracefully using memory caching and request queuing.
* Token-Based Authentication: Understanding how NetSuite signs API calls using OAuth 1.0a HMAC-SHA256 headers with consumer keys, tokens, and nonces.
* Error Normalization: Translating cryptic ERP database errors (e.g. `INSUFFICIENT_INVENTORY_IN_BIN`) into clear, actionable messages for warehouse pickers.

### 3. NetSuite & Enterprise Relational Concepts
* Record Types & Sublists: Seeing how NetSuite groups parent transaction records with child item lines.
* SuiteScript 2.1 APIs: Becoming familiar with `N/record.create()`, `transfer.selectNewLine()`, `transfer.setCurrentSublistValue()`, and `transfer.commitLine()`.

---

## Recommended Project File Structure

```
RFSmart/
├── package.json
├── server/
│   ├── index.js                  # Main Express server entry point (port 5190)
│   ├── routes/
│   │   └── scanner.js            # Node middleware routes for lookup and transfer
│   ├── services/
│   │   ├── cache.js              # In-memory lookup cache
│   │   └── auth.js               # Mock NetSuite TBA signature generator
│   └── netsuite-mock/
│       ├── db.js                 # SQLite or in-memory tables (items, bins, balances)
│       ├── nRecord.js            # Mock implementation of SuiteScript N/record
│       ├── nSearch.js            # Mock implementation of SuiteScript N/search
│       └── restlet.js            # SuiteScript 2.1 RESTlet script (get/post handlers)
├── public/
│   ├── index.html                # Mobile scanner UI layout with Knockout bindings
│   ├── app.js                    # Knockout ViewModel & observable logic
│   └── styles.css                # Handheld terminal styling (contrast, buttons, alerts)
├── README.md
└── HANDOFF.md                    # This document
```

---

## Getting Started for the Implementing Agent

1. Check existing directory structure and verify git is initialized.
2. Initialize `package.json` with `"type": "module"` and install minimal dependencies: `express`, `cors`, and optionally `better-sqlite3` or plain in-memory JavaScript stores.
3. Configure the start command to launch on port 5190: `npm run dev`.
4. Keep the code clean, modular, and heavily commented so Cedrick can easily inspect every layer and explain it during his hiring manager interview.
5. Avoid complex build tooling like Webpack or Vite for this specific learning demo unless requested. Plain static files for Knockout via CDN and vanilla ES modules for Node will make debugging instant.
