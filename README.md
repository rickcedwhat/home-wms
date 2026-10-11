# 📱 Kitchen & Household Barcode Inventory System

> **From Industrial ERP Prototype to Daily Home Driver:** Originally created as an exploratory, high-fidelity learning prototype to master Knockout.js MVVM and NetSuite SuiteScript 2.1 warehouse middleware (modeled after enterprise WMS solutions like RF-SMART). Now transformed into a real, zero-friction smart pantry and household inventory tracker for daily home use.

---

## 💡 Overview

Managing a household pantry shouldn't require tedious manual typing, complex spreadsheets, or bloated consumer apps. 

This project bridges **enterprise-grade warehouse barcode mechanics** with **daily home grocery management**:
- Scan groceries as you unpack them: items automatically increment into their designated spots.
- Scan items as you throw them in the trash: stock decrements, and depleted items automatically queue up on your **Shopping List**.
- Scan brand-new items: **Open Food Facts** and **UPCItemDB** automatically identify the product name, brand, and packaging photo—zero typing required.
- Switch modes or stores completely hands-free by scanning **Command Barcodes**.

---

## 🚀 Key Features

### 🛒 1. Zero-Click Intake Mode (`INTAKE`)
- **Instant Restock**: Scan any grocery item to automatically increment stock (`+1`) into its saved default location (e.g., *Pantry Bottom*, *Fridge Door*, *Spice Rack*).
- **Store & Origin Tracking**: Tag scans with your shopping destination (*Aldi*, *Walmart*, *Trader Joe's*, *Costco*, *Target*).
- **Audio Feedback**: Server plays macOS system chimes (`afplay`) and mobile devices vibrate/chirp on every valid read.

### 🗑 2. Disposal Mode & Automated Shopping List (`DISPOSE`)
- **Usage Tracking**: Scan empty packaging as you dispose of items to decrement stock (`-1`).
- **Auto-Shopping List**: When stock hits **0**, the item is automatically added to your **Shopping List**.
- **One-Tap Restock**: When you buy replacements, tap `[ ✓ Restock (+1) ]` on the shopping list drawer to return items straight into their kitchen spots.

### 🌐 3. Instant Product Auto-Discovery (Zero Typing)
- **Groceries & Food**: Integrated with **Open Food Facts** global database (cereal, peanut butter, pasta, drinks, condiments).
- **Household & Non-Food Goods**: Integrated with **UPCItemDB** for non-food items (**toilet paper, paper towels, cleaning supplies, trash bags, toiletries**).
- **One-Tap Assignment**: When an unknown barcode is scanned, the app pulls the product name, brand, and photo, asking once: *"Where does this live?"*

### ⚡ 4. Hands-Free Command Barcodes (`CMD:`)
Control the scanner hands-free without touching your phone screen by scanning printable command cards:
- `CMD:MODE:INTAKE` → Switch to Intake Mode
- `CMD:MODE:DISPOSE` → Switch to Disposal Mode
- `CMD:MODE:MOVE` → Switch to Location Transfer Mode
- `CMD:STORE:ALDI` / `WALMART` / `TRADER_JOES` / `COSTCO` / `TARGET` → Set active store
- Printable sheet available at [`/print-bins`](http://localhost:7370/print-bins) under the **⚡ Command Sheet** filter.

### 🚪 5. Minimalist QR Door & Shelf Labels
- Ultra-clean, zero-waste printable cutout labels for kitchen doors, shelves, and cabinets (`PANTRY-BOTTOM`, `PANTRY-TOP`, `FRIDGE-DOOR`, `COUNTER`, etc.).
- High-contrast 2D QR codes designed for instant 360° omnidirectional camera recognition.

---

## 🏗 System Architecture

```
+-------------------------------------------------------------+
|     Mobile Phone Camera (WebRTC) OR Hardware Scanner        |
|     - Fast continuous camera decoding (ZXing + Web Audio)   |
|     - Responsive touch drawers for intake, dispose & list   |
+------------------------------+------------------------------+
                               |
                               | HTTPS / HTTP REST (/api/scanner/...)
                               v
+-------------------------------------------------------------+
|       Node.js Kitchen Inventory Middleware (Port 7370/7373) |
|       - Barcode routing (GS1-128, UPC-A, EAN-13, CMD:)      |
|       - Open Food Facts & UPCItemDB auto-discovery engines   |
|       - In-memory cache (<5ms sub-millisecond response)     |
|       - Keyed async mutex concurrency locks                 |
|       - Native macOS audio chirps (afplay)                  |
+------------------------------+------------------------------+
                               |
                               | Local SQLite Datastore
                               v
+-------------------------------------------------------------+
|   Oracle NetSuite Mock / SQLite Relational Storage          |
|   - Tables: items, bins, inventory_balances, shopping_list  |
|   - Transfer logs & SuiteScript 2.1 RESTlet compatibility   |
|   - Atomic relational movements (node:sqlite WAL mode)      |
+-------------------------------------------------------------+
```

---

## 🛠 Tech Stack

- **Backend Runtime**: Node.js v22+ (Native `node:sqlite` DatabaseSync engine)
- **Frontend (Mobile)**: Vanilla JavaScript + Web Audio API + ZXing Barcode Engine (served over local HTTPS for iOS/Android camera access)
- **Frontend (Desktop Simulation)**: Knockout.js (MVVM architecture, observables, and computeds)
- **External Data**: Open Food Facts REST API v2 + UPCItemDB API
- **Testing**: Node.js native test runner (`node --test`), 16 passing unit & integration tests

---

## 🚦 Getting Started

### Prerequisites
- Node.js v22+ installed
- Phone and computer connected to the same local Wi-Fi network

### Installation & Launch

```bash
# 1. Clone repository
git clone https://github.com/rickcedwhat/home-wms.git
cd home-wms

# 2. Install dependencies
npm install

# 3. Run test suite
npm test

# 4. Start the server (HTTP: 7370, HTTPS: 7373)
npm run dev
```

### Accessing the Scanner
- **On Your Computer**: Open [`http://localhost:7370`](http://localhost:7370)
- **On Your Phone**: Open `https://<YOUR-LAN-IP>:7373/mobile` (e.g. `https://192.168.0.93:7373/mobile`)
  *(Mobile browsers automatically redirect from `/` to `/mobile`)*
- **Printable Labels & Command Sheet**: Open [`http://localhost:7370/print-bins`](http://localhost:7370/print-bins)

---

## 🧪 Test Coverage

Run the automated test suite with:

```bash
npm test
```

Covers 16 automated tests across:
1. **Industrial Barcode Parser**: SKUs, UPC-A, Bin barcodes, and GS1-128 identifiers.
2. **NetSuite TBA**: RFC 5849 OAuth 1.0a HMAC-SHA256 signature generation & validation.
3. **In-Memory Cache**: Sub-millisecond hits, misses, and surgical invalidations.
4. **Concurrency Mutex**: Asynchronous resource locking for race-condition prevention.
5. **SuiteScript Mock Engine**: Relational inventory balance adjustments and error assertions.
6. **RESTlet Handlers**: End-to-end lookup and transfer transactions.

---

## 📄 License

MIT License. Designed and built by Cedrick Catalan.
