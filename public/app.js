/**
 * RF-SMART Kitchen Inventory - Knockout.js ViewModel
 *
 * Features:
 * - Camera barcode scanning via BarcodeDetector API (iOS 17+, Chrome)
 * - Manual barcode entry fallback
 * - Add new items when barcode not found (name + photo + location)
 * - Transfer items between kitchen locations
 * - Full inventory + location browsing
 * - Transfer history
 */

(function () {
  'use strict';

  // ─── Audio: scan chimes ─────────────────────────────────────────
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let audioCtx = null;

  function getAudioCtx() {
    if (!audioCtx) audioCtx = new AudioCtx();
    return audioCtx;
  }

  function playChime(type = 'success') {
    try {
      const ctx = getAudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      const now = ctx.currentTime;
      if (type === 'success') {
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.setValueAtTime(1100, now + 0.08);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
      } else {
        osc.frequency.setValueAtTime(400, now);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.35);
      }
    } catch (_) {}
  }

  // ─── Utilities ───────────────────────────────────────────────────
  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // ─── ViewModel ───────────────────────────────────────────────────
  function AppViewModel() {
    const self = this;

    // ── Navigation ──────────────────────────────────────────────────
    self.currentPage = ko.observable('scan');
    self.currentPageTitle = ko.computed(() => {
      const m = { scan: 'Kitchen Scanner', inventory: 'Inventory', locations: 'Locations', history: 'History' };
      return m[self.currentPage()] || 'RF-SMART Kitchen';
    });

    self.goToScan = () => { self.currentPage('scan'); self.loadIfNeeded(); };
    self.goToInventory = () => { self.currentPage('inventory'); self.loadInventory(); };
    self.goToLocations = () => { self.currentPage('locations'); };
    self.goToHistory = () => { self.currentPage('history'); self.loadHistory(); };

    // ── Data ─────────────────────────────────────────────────────────
    self.kitchenBins = ko.observableArray([]);
    self.inventoryItems = ko.observableArray([]);
    self.inventoryLoading = ko.observable(false);
    self.inventorySearch = ko.observable('');
    self.transferHistory = ko.observableArray([]);

    self.filteredInventoryItems = ko.computed(() => {
      const q = self.inventorySearch().toLowerCase().trim();
      if (!q) return self.inventoryItems();
      return self.inventoryItems().filter(i =>
        (i.displayname || '').toLowerCase().includes(q) ||
        (i.upc || '').includes(q)
      );
    });

    // ── Scan State ───────────────────────────────────────────────────
    self.manualBarcode = ko.observable('');
    self.scanStatus = ko.observable('');
    self.scanStatusClass = ko.computed(() => {
      const s = self.scanStatus();
      if (!s) return 'scan-toast';
      if (s.startsWith('✓') || s.startsWith('✅')) return 'scan-toast toast-success';
      if (s.startsWith('⚠') || s.startsWith('❌') || s.startsWith('✕')) return 'scan-toast toast-error';
      return 'scan-toast toast-info';
    });
    self.scannedItem = ko.observable(null);
    self.cameraActive = ko.observable(false);

    // ── Camera / BarcodeDetector ─────────────────────────────────────
    let scanStream = null;
    let barcodeDetector = null;
    let scanLoopId = null;
    let lastScannedCode = null;
    let lastScanTime = 0;

    async function initBarcodeDetector() {
      if (barcodeDetector) return true;
      if ('BarcodeDetector' in window) {
        try {
          const formats = await BarcodeDetector.getSupportedFormats();
          barcodeDetector = new BarcodeDetector({ formats });
          return true;
        } catch (e) {
          console.warn('BarcodeDetector init failed:', e);
        }
      }
      return false;
    }

    async function startScanLoop() {
      const video = document.getElementById('scanVideo');
      const canvas = document.getElementById('scanCanvas');
      if (!video || !canvas || !barcodeDetector) return;

      const ctx = canvas.getContext('2d');
      async function tick() {
        if (!self.cameraActive()) return;
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);
          try {
            const barcodes = await barcodeDetector.detect(canvas);
            if (barcodes.length > 0) {
              const code = barcodes[0].rawValue;
              const now = Date.now();
              // Debounce: don't re-scan same code within 3 seconds
              if (code !== lastScannedCode || now - lastScanTime > 3000) {
                lastScannedCode = code;
                lastScanTime = now;
                self.processBarcode(code);
              }
            }
          } catch (_) {}
        }
        scanLoopId = requestAnimationFrame(tick);
      }
      scanLoopId = requestAnimationFrame(tick);
    }

    self.toggleCamera = async () => {
      if (self.cameraActive()) {
        // Stop camera
        self.cameraActive(false);
        if (scanLoopId) { cancelAnimationFrame(scanLoopId); scanLoopId = null; }
        if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
        return;
      }

      // Start camera
      const ok = await initBarcodeDetector();
      if (!ok) {
        self.setScanStatus('⚠ BarcodeDetector not supported on this browser. Use manual entry.', 'error');
        return;
      }

      try {
        scanStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        const video = document.getElementById('scanVideo');
        if (video) { video.srcObject = scanStream; }
        self.cameraActive(true);
        // Wait for video to be ready then start scanning
        setTimeout(startScanLoop, 500);
      } catch (err) {
        self.setScanStatus('⚠ Camera access denied. Please allow camera permissions.', 'error');
      }
    };

    // ── Barcode Lookup ───────────────────────────────────────────────
    self.onBarcodeKeydown = (data, e) => {
      if (e.key === 'Enter') { self.lookupManual(); return false; }
      return true;
    };

    self.lookupManual = () => {
      const code = self.manualBarcode().trim();
      if (code) self.processBarcode(code);
    };

    self.processBarcode = debounce(async (code) => {
      self.scannedItem(null);
      self.setScanStatus('🔍 Looking up…', 'info');

      try {
        const res = await fetch(`/api/scanner/lookup?barcode=${encodeURIComponent(code)}`);
        const data = await res.json();

        if (data.success) {
          playChime('success');
          const item = data.data;
          item.image_url = item.image_url || null;
          self.scannedItem(item);
          self.scanStatus('');
        } else if (data.errorCode === 'RECORD_NOT_FOUND') {
          // Not in system yet — let user add it
          playChime('error');
          self.scannedItem({ isNew: true, upc: code, displayName: 'Unknown Item', bins: [] });
          self.setScanStatus(`⚠ Not found — you can add this item`, 'info', 4000);
        } else {
          playChime('error');
          self.setScanStatus(`❌ ${data.error}`, 'error', 3500);
        }
      } catch (err) {
        self.setScanStatus(`❌ Connection error: ${err.message}`, 'error', 3000);
      }
    }, 300);

    self.clearScan = () => {
      self.scannedItem(null);
      self.scanStatus('');
      self.manualBarcode('');
      lastScannedCode = null;
    };

    // Status helper: shows toast for optional duration then auto-clears
    self.setScanStatus = (msg, type = 'info', autoClearMs = 0) => {
      self.scanStatus(msg);
      if (autoClearMs > 0) setTimeout(() => { if (self.scanStatus() === msg) self.scanStatus(''); }, autoClearMs);
    };

    // ── Add Item Modal ───────────────────────────────────────────────
    self.showAddItemModal = ko.observable(false);
    self.newItem = {
      upc: ko.observable(''),
      displayname: ko.observable(''),
      notes: ko.observable(''),
      startBin: ko.observable(''),
      startQty: ko.observable(1),
      previewUrl: ko.observable(''),
      fileObj: null,
      isValid: ko.computed(() => false), // placeholder, set below
      pickPhoto: (data, e) => {
        const file = e.target.files[0];
        if (!file) return;
        self.newItem.fileObj = file;
        const reader = new FileReader();
        reader.onload = (ev) => self.newItem.previewUrl(ev.target.result);
        reader.readAsDataURL(file);
      }
    };
    self.newItem.isValid = ko.computed(() =>
      self.newItem.upc().trim().length > 0 && self.newItem.displayname().trim().length > 0
    );

    self.openAddItem = () => {
      const scanned = self.scannedItem();
      if (scanned && scanned.isNew) {
        self.newItem.upc(scanned.upc || '');
      } else {
        self.newItem.upc('');
      }
      self.newItem.displayname('');
      self.newItem.notes('');
      self.newItem.startBin('');
      self.newItem.startQty(1);
      self.newItem.previewUrl('');
      self.newItem.fileObj = null;
      self.showAddItemModal(true);
    };

    self.submitNewItem = async () => {
      if (!self.newItem.isValid()) return;

      try {
        // 1. Create item record
        const res = await fetch('/api/scanner/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            upc: self.newItem.upc().trim(),
            displayname: self.newItem.displayname().trim(),
            notes: self.newItem.notes().trim() || null
          })
        });
        const data = await res.json();
        if (!data.success) {
          alert(`Could not create item: ${data.error}`);
          return;
        }
        const itemId = data.item.itemid;

        // 2. Upload photo if selected
        if (self.newItem.fileObj) {
          const form = new FormData();
          form.append('image', self.newItem.fileObj);
          await fetch(`/api/scanner/items/${itemId}/image`, { method: 'POST', body: form });
        }

        // 3. Add to starting location if selected
        if (self.newItem.startBin()) {
          // Use a direct DB API — create inventory balance via transfer from CART
          // We'll do it by adding stock directly via a dedicated endpoint (simpler than a transfer)
          await fetch('/api/scanner/items/' + itemId + '/stock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              binId: self.newItem.startBin(),
              qty: Number(self.newItem.startQty()) || 1
            })
          });
        }

        self.closeAllModals();
        playChime('success');
        self.setScanStatus(`✅ "${self.newItem.displayname()}" added!`, 'success', 3000);
        self.scannedItem(null);
        self.loadInventory();
      } catch (err) {
        alert(`Error: ${err.message}`);
      }
    };

    // ── Transfer Modal ───────────────────────────────────────────────
    self.showTransferModal = ko.observable(false);
    self.transferTarget = ko.observable(null);
    self.transferForm = {
      fromBin: ko.observable(''),
      toBin: ko.observable(''),
      quantity: ko.observable(1)
    };

    self.transferableBins = ko.computed(() => {
      const item = self.transferTarget();
      if (!item || !item.bins) return [];
      return (item.bins || []).map(b => ({
        id: b.bin_id,
        label: `${b.display_label || b.bin_id} (${b.qty_on_hand} in stock)`
      }));
    });

    self.transferFormValid = ko.computed(() => {
      return self.transferForm.fromBin() && self.transferForm.toBin() &&
        self.transferForm.fromBin() !== self.transferForm.toBin() &&
        Number(self.transferForm.quantity()) > 0;
    });

    self.openTransfer = () => {
      const item = self.scannedItem();
      if (!item) return;
      self.transferTarget(item);
      self.transferForm.fromBin(item.bins && item.bins.length > 0 ? item.bins[0].bin_id : '');
      self.transferForm.toBin('');
      self.transferForm.quantity(1);
      self.showTransferModal(true);
    };

    self.submitTransfer = async () => {
      if (!self.transferFormValid()) return;
      const item = self.transferTarget();
      try {
        const res = await fetch('/api/scanner/transfer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemId: item.itemId || item.itemid,
            fromBin: self.transferForm.fromBin(),
            toBin: self.transferForm.toBin(),
            quantity: Number(self.transferForm.quantity())
          })
        });
        const data = await res.json();
        if (data.success) {
          playChime('success');
          self.closeAllModals();
          self.setScanStatus(`✅ Moved to ${self.transferForm.toBin()}`, 'success', 3000);
          // Refresh the scanned item
          const barcode = item.upc || item.sku;
          if (barcode) self.processBarcode(barcode);
        } else {
          alert(`Transfer failed: ${data.error}`);
        }
      } catch (err) {
        alert(`Error: ${err.message}`);
      }
    };

    // ── Location Modal ───────────────────────────────────────────────
    self.showLocationModal = ko.observable(false);
    self.selectedLocation = ko.observable(null);
    self.locationItems = ko.observableArray([]);

    self.openLocation = async (bin) => {
      self.selectedLocation(bin);
      self.locationItems([]);
      self.showLocationModal(true);

      // Load items in this bin from inventory
      try {
        const res = await fetch('/api/scanner/inventory');
        const data = await res.json();
        if (data.status === 'SUCCESS') {
          const filtered = data.data
            .filter(row => row.bin_id === bin.binnumber && row.qty_on_hand > 0)
            .map(row => {
              // Find image_url from inventory items
              const found = self.inventoryItems().find(i => i.itemid === row.item_id);
              return { ...row, image_url: found ? found.image_url : null };
            });
          self.locationItems(filtered);
        }
      } catch (_) {}
    };

    // ── Inventory Item Selection ─────────────────────────────────────
    self.selectInventoryItem = (item) => {
      self.scannedItem({
        itemId: item.itemid,
        itemid: item.itemid,
        displayName: item.displayname,
        displayname: item.displayname,
        sku: item.sku,
        upc: item.upc,
        image_url: item.image_url,
        bins: [] // will reload on lookup
      });
      self.currentPage('scan');
      // Re-lookup to get live bin data
      self.processBarcode(item.upc || item.sku);
    };

    // ── Close All Modals ─────────────────────────────────────────────
    self.closeAllModals = () => {
      self.showAddItemModal(false);
      self.showTransferModal(false);
      self.showLocationModal(false);
    };

    // ── Data Loading ─────────────────────────────────────────────────
    let binsLoaded = false;

    self.loadBins = async () => {
      if (binsLoaded) return;
      try {
        const res = await fetch('/api/scanner/bins');
        const data = await res.json();
        if (data.status === 'SUCCESS') {
          self.kitchenBins(data.data);
          binsLoaded = true;
        }
      } catch (_) {}
    };

    self.loadInventory = async () => {
      self.inventoryLoading(true);
      try {
        const res = await fetch('/api/scanner/items');
        const data = await res.json();
        if (data.success) self.inventoryItems(data.items);
      } catch (_) {}
      self.inventoryLoading(false);
    };

    self.loadHistory = async () => {
      try {
        const res = await fetch('/api/scanner/transfers');
        const data = await res.json();
        if (data.status === 'SUCCESS') self.transferHistory(data.data);
      } catch (_) {}
    };

    self.loadIfNeeded = () => {
      self.loadBins();
    };

    self.formatDate = (dateStr) => {
      if (!dateStr) return '';
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    // ── Initialize ───────────────────────────────────────────────────
    self.loadBins();
    self.loadInventory();
  }

  ko.applyBindings(new AppViewModel(), document.body);

})();
