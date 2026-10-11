/**
 * RF-SMART Prototype - Knockout.js ViewModel & Mobile Simulation Engine
 * 
 * Demonstrates:
 * - MVVM Pattern with Knockout.js observables and computeds
 * - Rugged Handheld Scanner UX (Zebra TC52) with camera and photo barcode capture
 * - Real-world Physical Storage Racks (Kitchen Locations & Warehouse Racks)
 * - Household item registration flow with photos & custom barcodes
 * - Real-time NetSuite Middleware activity feed & OAuth 1.0a TBA telemetry
 * - Instant phone pairing via LAN QR code
 */

// Web Audio API Synthesizer for Industrial Warehouse Scanners
// Base64 WAV chimes for instant playback and iOS Safari fallback
const SUCCESS_CHIRP_WAV = 'data:audio/wav;base64,UklGRkIYAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAYAAAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA';

class ScannerAudio {
  constructor() {
    this.ctx = null;
    this.unlocked = false;
    this.audioEl = null;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
  }

  unlock() {
    this.init();
    if (this.unlocked) return;
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(function () {});
    }
    // Play a tiny silent buffer synchronously to unlock iOS Safari Web Audio
    if (this.ctx) {
      try {
        const buffer = this.ctx.createBuffer(1, 1, 22050);
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.ctx.destination);
        source.start(0);
        this.unlocked = true;
      } catch (_) {}
    }
  }

  playSuccess() {
    this.init();
    let played = false;
    try {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') {
          this.ctx.resume().catch(function () {});
        }
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        // Classic industrial dual-frequency chirp: 1800Hz jumping to 2400Hz
        osc.frequency.setValueAtTime(1800, this.ctx.currentTime);
        osc.frequency.setValueAtTime(2400, this.ctx.currentTime + 0.04);

        gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.15);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start();
        osc.stop(this.ctx.currentTime + 0.15);
        played = true;
      }
    } catch (_) {}

    // HTML5 Audio fallback for mobile browsers
    if (!played || (typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent))) {
      try {
        const a = new Audio(SUCCESS_CHIRP_WAV);
        a.play().catch(function () {});
      } catch (_) {}
    }
  }

  playError() {
    this.init();
    try {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') {
          this.ctx.resume().catch(function () {});
        }
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        // Industrial error buzz: 220Hz dropping to 180Hz
        osc.frequency.setValueAtTime(220, this.ctx.currentTime);
        osc.frequency.setValueAtTime(180, this.ctx.currentTime + 0.15);

        gain.gain.setValueAtTime(0.25, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.3);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start();
        osc.stop(this.ctx.currentTime + 0.3);
      }
    } catch (_) {}
  }
}

const scannerAudio = new ScannerAudio();

// Unlock audio on the very first touch/click anywhere on the screen
if (typeof document !== 'undefined') {
  ['touchstart', 'touchend', 'click', 'pointerdown'].forEach(function(evt) {
    document.addEventListener(evt, function() {
      scannerAudio.unlock();
    }, { once: false, passive: true });
  });
}

function ScannerViewModel() {
  const self = this;

  // --- Core State Observables ---
  self.scannedBarcode = ko.observable('');
  self.selectedItem = ko.observable(null);
  self.fromBin = ko.observable('');
  self.toBin = ko.observable('');
  self.transferQty = ko.observable(1);

  // Workflow mode on active item: 'transfer' (move) vs 'restock' (add units)
  self.itemWorkflowMode = ko.observable('transfer');
  self.restockBin = ko.observable('');
  self.restockQty = ko.observable(1);
  self.isRestocking = ko.observable(false);

  self.isProcessing = ko.observable(false);
  self.isTransferring = ko.observable(false);
  self.soundEnabled = ko.observable(true);

  // Visual scan flash indicators
  self.flashSuccess = ko.observable(false);
  self.flashError = ko.observable(false);

  // Status feedback message
  self.feedbackMessage = ko.observable('');
  self.feedbackType = ko.observable('info'); // 'info' | 'success' | 'error'

  // Unknown barcode registration prompt
  self.unknownBarcodeScanned = ko.observable(null);

  // Camera Scanning State
  self.cameraScanning = ko.observable(false);
  let zxingReader = null;
  let cameraStream = null;

  // Navigation tab for right column
  self.activeViewTab = ko.observable('items'); // 'items' | 'activity' | 'ledger'
  
  // Mobile segmented view switcher ('scanner' | 'racks' | 'activity')
  self.mobileActiveTab = ko.observable('scanner');

  // Filter for storage bins: 'all' | 'kitchen' | 'warehouse'
  self.binFilter = ko.observable('all');

  // Collections (Observable Arrays)
  self.inventoryList = ko.observableArray([]);
  self.transferHistory = ko.observableArray([]);
  self.telemetryLogs = ko.observableArray([]);
  self.allWarehouseBinsData = ko.observableArray([]);

  // Network info for phone access
  self.lanIP = ko.observable('localhost');
  self.port = ko.observable(7370);
  self.httpsPort = ko.observable(7373);
  self.phoneQrProtocol = ko.observable('http'); // 'http' | 'https'

  self.mobileUrl = ko.computed(function () {
    return 'http://' + self.lanIP() + ':' + self.port();
  });
  self.httpsUrl = ko.computed(function () {
    return 'https://' + self.lanIP() + ':' + self.httpsPort();
  });
  self.activeQrUrl = ko.computed(function () {
    return self.phoneQrProtocol() === 'https' ? self.httpsUrl() : self.mobileUrl();
  });

  // Phone QR Code Modal
  self.showPhoneModal = ko.observable(false);
  let qrCodeInstance = null;

  // Register Item Modal
  self.showRegisterModal = ko.observable(false);
  self.registerForm = {
    upc: ko.observable(''),
    displayname: ko.observable(''),
    notes: ko.observable(''),
    binId: ko.observable(''),
    quantity: ko.observable(1),
    previewUrl: ko.observable(''),
    fileObj: null
  };

  self.isRegisterFormValid = ko.computed(function () {
    const f = self.registerForm;
    const upc = f.upc() ? String(f.upc()).trim() : '';
    const name = f.displayname() ? String(f.displayname()).trim() : '';
    const bin = f.binId() ? String(f.binId()).trim() : '';
    const qty = Number(f.quantity()) || 0;
    return upc.length > 0 && name.length > 0 && bin.length > 0 && qty > 0;
  });

  // Track Open/Close state per bin
  self.binOpenMap = {};
  self.getBinOpenState = function(binId) {
    if (!self.binOpenMap[binId]) {
      self.binOpenMap[binId] = ko.observable(true);
    }
    return self.binOpenMap[binId];
  };

  self.toggleBin = function(bin) {
    const obs = self.getBinOpenState(bin.binId);
    obs(!obs());
  };

  self.expandAllBins = function() {
    self.allWarehouseBinsData().forEach(function (b) {
      self.getBinOpenState(b.binnumber)(true);
    });
  };

  self.collapseAllBins = function() {
    self.allWarehouseBinsData().forEach(function (b) {
      self.getBinOpenState(b.binnumber)(false);
    });
  };

  // Sound Toggle
  self.toggleSound = function() {
    self.soundEnabled(!self.soundEnabled());
  };

  // Helper for Category & Icon display
  self.getItemIcon = function(sku) {
    if (!sku) return '📦';
    const s = sku.toUpperCase();
    if (s.includes('H001') || s.includes('KETCHUP')) return '🥫';
    if (s.includes('H002') || s.includes('OAT')) return '🥣';
    if (s.includes('H003') || s.includes('PEANUT')) return '🥜';
    if (s.includes('H004') || s.includes('SOUP')) return '🍲';
    if (s.includes('H005') || s.includes('SRIRACHA') || s.includes('CHILI')) return '🌶';
    if (s.includes('1001') || s.includes('TC52')) return '📱';
    if (s.includes('1002') || s.includes('CK65')) return '📟';
    if (s.includes('1003') || s.includes('LS2208')) return '🔫';
    if (s.includes('1004') || s.includes('LABEL')) return '🏷';
    return '📦';
  };

  self.getBinEmoji = function(binId, displayLabel) {
    if (displayLabel && displayLabel.includes(' ')) {
      const first = displayLabel.trim().split(' ')[0];
      if (first.length <= 4) return first;
    }
    if (binId.includes('PANTRY')) return '🥫';
    if (binId.includes('FRIDGE-DOOR')) return '🧊';
    if (binId.includes('FRIDGE')) return '🥗';
    if (binId.includes('FREEZER')) return '❄️';
    if (binId.includes('COUNTER')) return '🍳';
    if (binId.includes('CABINET-HIGH')) return '🪣';
    if (binId.includes('CABINET-LOW')) return '🫙';
    if (binId.includes('SPICE')) return '🧂';
    if (binId.includes('STAGE')) return '🚚';
    if (binId.includes('A01') || binId.includes('A02')) return '📦';
    if (binId.includes('B01') || binId.includes('B02')) return '⚡';
    if (binId.includes('B04')) return '🏗';
    if (binId.includes('C01')) return '🔄';
    if (binId.includes('C02')) return '🧱';
    return '📦';
  };

  // --- Computed: Total Unique Items Count ---
  self.totalItemsCount = ko.computed(function () {
    const set = new Set();
    self.inventoryList().forEach(function (i) {
      if (i.qty_on_hand > 0) set.add(i.sku);
    });
    return set.size;
  });

  // --- Computed: Storage Racks Hierarchy ---
  self.warehouseRack = ko.computed(function() {
    const bins = self.allWarehouseBinsData();
    const inventory = self.inventoryList();
    const activeItem = self.selectedItem();
    const activeFromBin = self.fromBin();
    const activeToBin = self.toBin();

    return bins.map(function(bin) {
      const binId = bin.binnumber;
      const itemsInBin = inventory.filter(function (i) {
        return i.bin_id === binId && i.qty_on_hand > 0;
      });
      const totalUnits = itemsInBin.reduce(function (sum, item) {
        return sum + item.qty_on_hand;
      }, 0);

      const isKitchen = bin.aisle === 'Kitchen' || bin.location_id === 'HOME-KITCHEN';

      return {
        binId: binId,
        displayLabel: bin.display_label || binId,
        aisle: bin.aisle,
        zone: bin.zone,
        locationId: bin.location_id,
        isKitchen: isKitchen,
        emoji: self.getBinEmoji(binId, bin.display_label),
        totalUnits: totalUnits,
        itemCount: itemsInBin.length,
        items: itemsInBin,
        isOpen: self.getBinOpenState(binId),
        isSource: ko.computed(function() { return activeFromBin === binId; }),
        isTarget: ko.computed(function() { return activeToBin === binId; })
      };
    });
  });

  // Filtered Racks (All / Kitchen / Warehouse)
  self.filteredRack = ko.computed(function () {
    const f = self.binFilter();
    const rack = self.warehouseRack();
    if (f === 'kitchen') return rack.filter(function (b) { return b.isKitchen; });
    if (f === 'warehouse') return rack.filter(function (b) { return !b.isKitchen; });
    return rack;
  });

  // --- Computed: Transfer Dropdown Options ---
  self.getFriendlyBinLabel = function(binNumber) {
    if (!binNumber) return '';
    const b = self.allWarehouseBinsData().find(function(x) { return x.binnumber === binNumber; });
    if (b && b.display_label) return b.display_label;
    if (binNumber === 'PANTRY-TOP') return '🚪 Pantry Top';
    if (binNumber === 'PANTRY-BOTTOM') return '🚪 Pantry Bottom';
    if (binNumber === 'PANTRY') return '🥫 Pantry (Main)';
    return '📦 ' + binNumber;
  };

  self.sourceBinOptions = ko.computed(function() {
    const item = self.selectedItem();
    if (!item || !Array.isArray(item.bins)) return [];
    return item.bins.map(function(b) { return b.bin_id; });
  });

  self.destBinOptions = ko.computed(function() {
    const currentFrom = self.fromBin();
    const bins = self.allWarehouseBinsData();
    if (!Array.isArray(bins)) return [];
    return bins
      .map(function(b) { return b.binnumber; })
      .filter(function(b) { return b !== currentFrom; });
  });

  self.availableInFromBin = ko.computed(function() {
    const item = self.selectedItem();
    const from = self.fromBin();
    if (!item || !from || !Array.isArray(item.bins)) return 0;
    const binRow = item.bins.find(function(b) { return b.bin_id === from; });
    return binRow ? binRow.qty_on_hand : 0;
  });

  self.canCommitTransfer = ko.computed(function() {
    const item = self.selectedItem();
    const from = self.fromBin();
    const to = self.toBin();
    const qty = Number(self.transferQty());
    const available = self.availableInFromBin();

    return (
      item !== null &&
      from &&
      to &&
      from !== to &&
      !isNaN(qty) &&
      qty > 0 &&
      qty <= available &&
      !self.isTransferring()
    );
  });

  // --- Telemetry Logging ---
  self.logTelemetry = function(entry) {
    self.telemetryLogs.unshift({
      badge: entry.badge,
      badgeClass: entry.badgeClass,
      title: entry.title,
      message: entry.message,
      latency: entry.latency || 0,
      timestamp: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      type: entry.type || 'info'
    });
    if (self.telemetryLogs().length > 40) {
      self.telemetryLogs.pop();
    }
  };

  self.clearTelemetry = function() {
    self.telemetryLogs.removeAll();
  };

  // --- Scan Barcode Execution ---
  self.scanDirect = function(barcode) {
    self.scannedBarcode(barcode);
    self.executeBarcodeLookup(barcode);
  };

  self.submitManualBarcode = function () {
    const code = self.scannedBarcode().trim();
    if (code) self.executeBarcodeLookup(code);
  };

  self.handleBarcodeKeypress = function(data, event) {
    if (event.key === 'Enter') {
      const code = self.scannedBarcode().trim();
      if (code) self.executeBarcodeLookup(code);
      return false;
    }
    return true;
  };

  self.executeBarcodeLookup = async function(rawBarcode) {
    if (!rawBarcode || self.isProcessing()) return;

    const cleanCode = String(rawBarcode).trim();

    // 1. Check if user is scanning a Location/Bin barcode (e.g. door sticker)
    const matchingBin = self.allWarehouseBinsData().find(function (b) {
      return b.binnumber === cleanCode || 
             b.barcode === cleanCode || 
             cleanCode.toUpperCase() === 'BIN-' + b.binnumber.toUpperCase() ||
             cleanCode.toUpperCase() === b.binnumber.toUpperCase();
    });

    if (matchingBin) {
      if (self.selectedItem()) {
        if (matchingBin.binnumber === self.fromBin()) {
          self.feedbackType('error');
          self.feedbackMessage('⚠ Destination cannot be the same as source (' + (matchingBin.display_label || matchingBin.binnumber) + ')');
        } else {
          self.toBin(matchingBin.binnumber);
          self.restockBin(matchingBin.binnumber);
          if (self.soundEnabled()) scannerAudio.playSuccess();
          self.flashSuccess(true);
          setTimeout(function() { self.flashSuccess(false); }, 350);
          self.feedbackType('info');
          self.feedbackMessage('📍 Target location set to: ' + (matchingBin.display_label || matchingBin.binnumber));
        }
      } else {
        // Location scanned before an item: prime destination & highlight bin
        self.toBin(matchingBin.binnumber);
        self.restockBin(matchingBin.binnumber);
        self.getBinOpenState(matchingBin.binnumber)(true);
        if (self.soundEnabled()) scannerAudio.playSuccess();
        self.flashSuccess(true);
        setTimeout(function() { self.flashSuccess(false); }, 350);
        self.feedbackType('info');
        self.feedbackMessage('📍 Location ready: ' + (matchingBin.display_label || matchingBin.binnumber) + '. Now scan an item barcode!');
      }
      return;
    }

    self.isProcessing(true);
    self.feedbackMessage('');
    self.unknownBarcodeScanned(null);
    const start = Date.now();

    try {
      const res = await fetch('/api/scanner/lookup?barcode=' + encodeURIComponent(rawBarcode));
      const data = await res.json();
      const latency = Date.now() - start;

      // Handle server-identified bin/location barcode
      if (data.success && data.isBin && data.bin) {
        const bin = data.bin;
        if (self.selectedItem()) {
          if (bin.binnumber === self.fromBin()) {
            self.feedbackType('error');
            self.feedbackMessage('⚠ Destination cannot be the same as source (' + (bin.display_label || bin.binnumber) + ')');
          } else {
            self.toBin(bin.binnumber);
            self.restockBin(bin.binnumber);
            if (self.soundEnabled()) scannerAudio.playSuccess();
            self.flashSuccess(true);
            setTimeout(function() { self.flashSuccess(false); }, 350);
            self.feedbackType('info');
            self.feedbackMessage('📍 Target location set to: ' + (bin.display_label || bin.binnumber));
          }
        } else {
          self.toBin(bin.binnumber);
          self.restockBin(bin.binnumber);
          self.getBinOpenState(bin.binnumber)(true);
          if (self.soundEnabled()) scannerAudio.playSuccess();
          self.flashSuccess(true);
          setTimeout(function() { self.flashSuccess(false); }, 350);
          self.feedbackType('info');
          self.feedbackMessage('📍 Location ready: ' + (bin.display_label || bin.binnumber) + '. Now scan an item barcode!');
        }
        return;
      }

      if (data.success && data.data) {
        if (self.soundEnabled()) scannerAudio.playSuccess();
        self.flashSuccess(true);
        setTimeout(function() { self.flashSuccess(false); }, 400);

        const itemObj = {
          ...data.data,
          bins: Array.isArray(data.data.bins) ? data.data.bins : []
        };
        self.selectedItem(itemObj);
        self.transferQty(1);

        // Pre-select first available bin with stock
        if (itemObj.bins.length > 0) {
          self.fromBin(itemObj.bins[0].bin_id);
          self.restockBin(itemObj.bins[0].bin_id);
          const other = self.allWarehouseBinsData().find(function (b) {
            return b.binnumber !== itemObj.bins[0].bin_id;
          });
          if (other) self.toBin(other.binnumber);
        } else {
          self.fromBin('');
          self.toBin(self.allWarehouseBinsData().length > 0 ? self.allWarehouseBinsData()[0].binnumber : '');
          self.restockBin(self.allWarehouseBinsData().length > 0 ? self.allWarehouseBinsData()[0].binnumber : '');
        }

        self.feedbackType('success');
        self.feedbackMessage('✓ Found: ' + (data.data.displayName || data.data.displayname));

        const sym = (data.parsedBarcode && (data.parsedBarcode.type || data.parsedBarcode.symbology)) || 'Barcode';
        self.logTelemetry({
          badge: data.source === 'CACHE' ? 'CACHE-HIT' : 'NETSUITE',
          badgeClass: data.source === 'CACHE' ? 'badge-cache' : 'badge-erp',
          title: 'Lookup: ' + (data.data.displayName || data.data.sku),
          message: 'Parsed: ' + (data.parsedBarcode ? data.parsedBarcode.identifier : rawBarcode) + ' (' + sym + ') via ' + data.source,
          latency: latency
        });

      } else if (data.autoDiscovered && data.product) {
        if (self.soundEnabled()) scannerAudio.playSuccess();
        self.feedbackType('success');
        self.feedbackMessage('✨ Discovered via Open Food Facts: ' + data.product.displayName);
        self.openAddItemModal();
        self.registerForm.upc(data.product.upc);
        self.registerForm.displayname(data.product.displayName);
        self.registerForm.notes(data.product.brand ? 'Brand: ' + data.product.brand : '');
        if (data.product.imageUrl) {
          self.registerForm.previewUrl(data.product.imageUrl);
        }
        self.showRegisterModal(true);

        self.logTelemetry({
          badge: 'OPEN-FOOD-FACTS',
          badgeClass: 'badge-cache',
          title: 'Auto-Discovered: ' + data.product.displayName,
          message: 'Found on Open Food Facts for UPC ' + data.product.upc,
          latency: latency
        });
      } else {
        if (self.soundEnabled()) scannerAudio.playError();
        self.flashError(true);
        setTimeout(function() { self.flashError(false); }, 500);

        self.feedbackType('error');
        self.feedbackMessage('⚠ ' + (data.error || 'Barcode not found'));
        self.unknownBarcodeScanned(rawBarcode);

        self.logTelemetry({
          badge: 'NOT-FOUND',
          badgeClass: 'badge-transfer',
          title: 'Scan Miss: ' + rawBarcode,
          message: data.error || 'Barcode not registered in ERP',
          latency: latency,
          type: 'error'
        });
      }
    } catch (err) {
      if (self.soundEnabled()) scannerAudio.playError();
      self.feedbackType('error');
      self.feedbackMessage('✕ Connection error: ' + err.message);
    } finally {
      self.isProcessing(false);
      // Auto focus back on barcode input if on desktop
      const input = document.getElementById('barcodeInput');
      if (input && window.innerWidth > 768) input.focus();
    }
  };

  // --- Select Item Directly from Physical Storage Tile ---
  self.selectItemFromBin = function(item, binId) {
    self.selectedItem({
      itemId: item.item_id,
      itemid: item.item_id,
      sku: item.sku,
      displayName: item.displayname,
      displayname: item.displayname,
      upc: item.upc,
      image_url: item.image_url,
      totalQty: item.qty_on_hand,
      bins: [{ bin_id: binId, qty_on_hand: item.qty_on_hand }]
    });

    self.fromBin(binId);
    self.transferQty(1);

    // Pick a sensible default destination
    const candidateDest = self.allWarehouseBinsData().find(function (b) {
      return b.binnumber !== binId;
    });
    if (candidateDest) self.toBin(candidateDest.binnumber);

    if (self.soundEnabled()) scannerAudio.playSuccess();
    self.flashSuccess(true);
    setTimeout(function() { self.flashSuccess(false); }, 350);

    self.feedbackType('info');
    self.feedbackMessage('Scanned package: ' + item.displayname + ' from ' + binId);

    // If on phone, switch to scanner tab automatically
    if (self.mobileActiveTab() !== 'scanner') {
      self.mobileActiveTab('scanner');
    }

    // Refresh full item details via API in background
    self.executeBarcodeLookup(item.upc || item.sku);
  };

  self.selectSourceBin = function(binId) {
    self.fromBin(binId);
    if (self.toBin() === binId) {
      const candidate = self.allWarehouseBinsData().find(function(b) { return b.binnumber !== binId; });
      if (candidate) self.toBin(candidate.binnumber);
    }
  };

  self.setDestinationBin = function(binId) {
    self.toBin(binId);
    self.feedbackType('info');
    self.feedbackMessage('Target location set to ' + binId);
  };

  self.incrementQty = function() {
    const cur = Number(self.transferQty()) || 0;
    const max = self.availableInFromBin();
    if (cur < max) self.transferQty(cur + 1);
  };

  self.decrementQty = function() {
    const cur = Number(self.transferQty()) || 1;
    if (cur > 1) self.transferQty(cur - 1);
  };

  self.setMaxQty = function() {
    self.transferQty(self.availableInFromBin());
  };

  self.resetForm = function() {
    self.selectedItem(null);
    self.scannedBarcode('');
    self.fromBin('');
    self.toBin('');
    self.transferQty(1);
    self.feedbackMessage('');
    self.unknownBarcodeScanned(null);
    self.stopCameraScanner();
    const input = document.getElementById('barcodeInput');
    if (input) input.focus();
  };

  // --- Commit Bin Transfer ---
  self.commitTransfer = async function() {
    if (!self.canCommitTransfer()) return;

    self.isTransferring(true);
    self.feedbackMessage('');
    const start = Date.now();

    const item = self.selectedItem();
    const payload = {
      itemId: item.itemId || item.itemid,
      fromBin: self.fromBin(),
      toBin: self.toBin(),
      quantity: Number(self.transferQty())
    };

    try {
      const res = await fetch('/api/scanner/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      const latency = Date.now() - start;

      if (data.success) {
        if (self.soundEnabled()) scannerAudio.playSuccess();
        self.flashSuccess(true);
        setTimeout(function() { self.flashSuccess(false); }, 600);

        self.feedbackType('success');
        self.feedbackMessage('✓ Moved ' + payload.quantity + 'x to ' + payload.toBin + ' (' + data.transfer.transferId + ')');

        self.logTelemetry({
          badge: 'TRANSFER',
          badgeClass: 'badge-transfer',
          title: data.transfer.transferId + ': ' + payload.quantity + 'x ' + (item.sku || item.displayName),
          message: payload.fromBin + ' ➔ ' + payload.toBin + ' | TBA Auth: ' + data.tbaSignature.substring(0, 16) + '...',
          latency: latency
        });

        // Refresh inventory balances across UI
        await self.refreshInventory();

        // Refresh the selected item view
        const barcodeToRefresh = item.upc || item.sku;
        if (barcodeToRefresh) {
          const checkRes = await fetch('/api/scanner/lookup?barcode=' + encodeURIComponent(barcodeToRefresh));
          const checkData = await checkRes.json();
          if (checkData.success && checkData.data) {
            self.selectedItem(checkData.data);
            if (checkData.data.bins && checkData.data.bins.length > 0) {
              const currentFromStillHasStock = checkData.data.bins.find(function(b) { return b.bin_id === self.fromBin(); });
              if (!currentFromStillHasStock) {
                self.fromBin(checkData.data.bins[0].bin_id);
              }
            }
          }
        }
      } else {
        if (self.soundEnabled()) scannerAudio.playError();
        self.flashError(true);
        setTimeout(function() { self.flashError(false); }, 600);

        self.feedbackType('error');
        self.feedbackMessage('✕ ' + (data.error || 'Transfer failed'));

        self.logTelemetry({
          badge: 'ERROR',
          badgeClass: 'badge-transfer',
          title: 'Transfer Failed (' + (data.errorCode || 'ERP_REJECT') + ')',
          message: data.error || 'Transaction rolled back',
          latency: latency,
          type: 'error'
        });
      }
    } catch (err) {
      if (self.soundEnabled()) scannerAudio.playError();
      self.feedbackType('error');
      self.feedbackMessage('✕ NetSuite connection failed: ' + err.message);
    } finally {
      self.isTransferring(false);
    }
  };

  // --- Commit Restock (Add Stock into Location) ---
  self.commitRestock = async function() {
    const item = self.selectedItem();
    if (!item) return;
    const binId = self.restockBin();
    const qty = Number(self.restockQty()) || 1;
    if (!binId || qty <= 0) return;

    self.isRestocking(true);
    const start = Date.now();
    try {
      const res = await fetch('/api/scanner/items/' + (item.itemId || item.itemid) + '/stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ binId: binId, qty: qty })
      });
      const data = await res.json();
      const latency = Date.now() - start;

      if (data.success) {
        if (self.soundEnabled()) scannerAudio.playSuccess();
        self.flashSuccess(true);
        setTimeout(function() { self.flashSuccess(false); }, 500);

        self.feedbackType('success');
        self.feedbackMessage('✓ Added +' + qty + ' units into ' + binId);

        self.logTelemetry({
          badge: 'RESTOCK',
          badgeClass: 'badge-erp',
          title: 'Stock Added: +' + qty + 'x ' + (item.displayName || item.sku),
          message: 'Location: ' + binId + ' | Balances updated',
          latency: latency
        });

        await self.refreshInventory();
        await self.executeBarcodeLookup(item.upc || item.sku);
      } else {
        alert('Could not add stock: ' + data.error);
      }
    } catch (e) {
      alert('Network error: ' + e.message);
    } finally {
      self.isRestocking(false);
    }
  };

  // --- Live Video Camera Scanner ---
  self.supportsLiveVideo = ko.observable(
    typeof navigator !== 'undefined' && 
    !!navigator.mediaDevices && 
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );

  self.triggerCameraSnap = function() {
    const snapInput = document.getElementById('snapBarcodeInput');
    if (snapInput) {
      snapInput.click();
    }
  };

  self.toggleCameraScanner = function() {
    if (self.cameraScanning()) {
      self.stopCameraScanner();
    } else {
      self.startCameraScanner();
    }
  };

  self.startCameraScanner = async function() {
    // If the browser does not support live WebRTC on this origin (e.g. mobile Safari on plain HTTP),
    // automatically fall back to the native camera snap without throwing an error!
    if (!self.supportsLiveVideo()) {
      self.feedbackType('info');
      self.feedbackMessage('📸 Opening camera snap (live video stream requires HTTPS on mobile)...');
      setTimeout(function() {
        self.triggerCameraSnap();
      }, 100);
      return;
    }

    self.cameraScanning(true);
    self.feedbackType('info');
    self.feedbackMessage('📷 Starting camera...');

    setTimeout(async function() {
      const videoEl = document.getElementById('terminalVideo');
      if (!videoEl) return;

      try {
        if (window.ZXing && window.ZXing.BrowserMultiFormatReader) {
          zxingReader = new window.ZXing.BrowserMultiFormatReader();
          await zxingReader.decodeFromVideoDevice(null, 'terminalVideo', function(result, err) {
            if (result && result.text) {
              const code = result.text.trim();
              if (code && code !== self.scannedBarcode()) {
                self.stopCameraScanner();
                self.scanDirect(code);
              }
            }
          });
          self.feedbackMessage('📷 Point camera at barcode');
        } else if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' }
          });
          videoEl.srcObject = cameraStream;
          self.feedbackMessage('📷 Camera active');
        } else {
          self.stopCameraScanner();
          self.triggerCameraSnap();
        }
      } catch (e) {
        self.stopCameraScanner();
        self.feedbackType('info');
        self.feedbackMessage('📸 Using camera photo capture...');
        self.triggerCameraSnap();
      }
    }, 150);
  };

  self.stopCameraScanner = function() {
    self.cameraScanning(false);
    if (zxingReader) {
      try { zxingReader.reset(); } catch (_) {}
      zxingReader = null;
    }
    if (cameraStream) {
      try {
        cameraStream.getTracks().forEach(function(t) { t.stop(); });
      } catch (_) {}
      cameraStream = null;
    }
  };

  // --- Universal Photo Barcode Scanner (Works on iOS/Android over HTTP) ---
  self.handlePhotoBarcodeScan = function(data, event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    self.isProcessing(true);
    self.feedbackType('info');
    self.feedbackMessage('🔍 Analyzing barcode from photo...');

    const reader = new FileReader();
    reader.onload = function(e) {
      const img = new Image();
      img.onload = async function() {
        try {
          // Scale to max dimension 1280px to optimize decode speed and avoid mobile memory limits
          const maxDim = 1280;
          let w = img.width;
          let h = img.height;
          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);

          // 1. Try native BarcodeDetector if available
          if ('BarcodeDetector' in window) {
            try {
              const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'];
              const detector = new BarcodeDetector({ formats: formats });
              const codes = await detector.detect(canvas);
              if (codes && codes.length > 0) {
                const raw = codes[0].rawValue;
                self.scanDirect(raw);
                return;
              }
            } catch (_) {}
          }

          // 2. Try ZXing on the scaled image
          if (window.ZXing && window.ZXing.BrowserMultiFormatReader) {
            const zx = new window.ZXing.BrowserMultiFormatReader();
            // Create a scaled image element from the canvas
            const scaledImg = new Image();
            scaledImg.onload = async function() {
              try {
                const result = await zx.decodeFromImageElement(scaledImg);
                if (result && result.text) {
                  self.scanDirect(result.text.trim());
                  return;
                }
              } catch (_) {
                self.feedbackType('error');
                self.feedbackMessage('⚠ Barcode not clearly legible. Hold closer with good lighting or type manually.');
              }
            };
            scaledImg.src = canvas.toDataURL('image/jpeg', 0.9);
            return;
          }

          self.feedbackType('error');
          self.feedbackMessage('⚠ Could not read barcode from this photo. Try typing it above.');
        } catch (err) {
          self.feedbackType('error');
          self.feedbackMessage('⚠ Photo scan failed: ' + (err.message || 'unreadable'));
        } finally {
          self.isProcessing(false);
          event.target.value = '';
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  };

  // --- Item Registration Flow ---
  self.openAddItemModal = function() {
    self.registerForm.upc(self.scannedBarcode() || '');
    self.registerForm.displayname('');
    self.registerForm.notes('');
    self.registerForm.binId(self.allWarehouseBinsData().length > 0 ? self.allWarehouseBinsData()[0].binnumber : '');
    self.registerForm.quantity(1);
    self.registerForm.previewUrl('');
    self.registerForm.fileObj = null;
    self.showRegisterModal(true);
  };

  self.registerUnknownBarcode = function() {
    self.openAddItemModal();
    if (self.unknownBarcodeScanned()) {
      self.registerForm.upc(self.unknownBarcodeScanned());
    }
  };

  self.closeRegisterModal = function() {
    self.showRegisterModal(false);
  };

  self.handleRegisterPhotoSelect = function(data, event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    self.registerForm.fileObj = file;
    const reader = new FileReader();
    reader.onload = function(e) {
      self.registerForm.previewUrl(e.target.result);
    };
    reader.readAsDataURL(file);
  };

  self.submitRegisterItem = async function() {
    if (!self.isRegisterFormValid()) return;

    const upc = self.registerForm.upc() ? String(self.registerForm.upc()).trim() : '';
    const displayname = self.registerForm.displayname() ? String(self.registerForm.displayname()).trim() : '';
    const notes = self.registerForm.notes() ? String(self.registerForm.notes()).trim() : '';
    const binId = self.registerForm.binId() ? String(self.registerForm.binId()).trim() : '';
    const quantity = Number(self.registerForm.quantity()) || 1;

    try {
      // 1. Create Item Record
      const itemRes = await fetch('/api/scanner/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upc: upc, displayname: displayname, notes: notes })
      });
      const itemData = await itemRes.json();
      if (!itemData.success) {
        alert('Could not register item: ' + itemData.error);
        return;
      }

      const itemId = itemData.item.itemid;

      // 2. Upload Photo if selected
      if (self.registerForm.fileObj) {
        const formData = new FormData();
        formData.append('image', self.registerForm.fileObj);
        await fetch('/api/scanner/items/' + itemId + '/image', {
          method: 'POST',
          body: formData
        });
      }

      // 3. Add initial inventory stock to location
      if (binId && quantity > 0) {
        await fetch('/api/scanner/items/' + itemId + '/stock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ binId: binId, qty: quantity })
        });
      }

      self.closeRegisterModal();
      self.unknownBarcodeScanned(null);
      if (self.soundEnabled()) scannerAudio.playSuccess();

      // Refresh inventory and immediately scan the newly registered item
      await self.refreshInventory();
      if (upc) {
        await self.executeBarcodeLookup(upc);
      }

    } catch (err) {
      alert('Error saving item: ' + (err.message || err));
    }
  };

  // --- Phone Pairing QR Modal ---
  self.setPhoneQrProtocol = function(proto) {
    self.phoneQrProtocol(proto);
    self.renderPhoneQr();
  };

  self.renderPhoneQr = function() {
    const container = document.getElementById('phoneQrCanvas');
    if (!container) return;
    container.innerHTML = '';
    if (window.QRCode) {
      new QRCode(container, {
        text: self.activeQrUrl(),
        width: 190,
        height: 190,
        colorDark: '#090d13',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
    }
  };

  self.openPhoneModal = function() {
    self.showPhoneModal(true);
    setTimeout(function() {
      self.renderPhoneQr();
    }, 100);
  };

  self.closePhoneModal = function() {
    self.showPhoneModal(false);
  };

  // --- Data Loading & Initialization ---
  self.refreshInventory = async function() {
    try {
      const res = await fetch('/api/scanner/inventory');
      const data = await res.json();
      if (data.status === 'SUCCESS' && Array.isArray(data.data)) {
        self.inventoryList(data.data);
      }
    } catch (_) {}
  };

  self.loadBins = async function() {
    try {
      const res = await fetch('/api/scanner/bins');
      const data = await res.json();
      if (data.status === 'SUCCESS' && Array.isArray(data.data)) {
        self.allWarehouseBinsData(data.data);
      }
    } catch (_) {}
  };

  self.loadServerInfo = async function() {
    try {
      const res = await fetch('/api/scanner/info');
      const data = await res.json();
      if (data.success) {
        self.lanIP(data.lanIP || 'localhost');
        self.port(data.port || 7370);
      }
    } catch (_) {}
  };

  // Initial Load
  self.loadServerInfo();
  self.loadBins().then(function() {
    self.refreshInventory();
  });
}

// Instantiate and bind
const appVM = new ScannerViewModel();
ko.applyBindings(appVM, document.querySelector('.app-layout'));
