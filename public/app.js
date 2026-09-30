/**
 * RF-SMART Prototype - Knockout.js ViewModel & Client Orchestration
 * 
 * Demonstrates Knockout's Model-View-ViewModel (MVVM) pattern with:
 * - Observables: ko.observable(initialValue)
 * - Computed Observables: ko.computed(function) with automatic dependency tracking
 * - Observable Arrays: ko.observableArray([])
 * - Two-way data binding and custom DOM updates
 * - Web Audio API industrial barcode beeps
 */

// Web Audio API Synthesizer for Warehouse Barcode Scanners
class ScannerAudio {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
  }

  playSuccess() {
    try {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      // Classic industrial dual-frequency chirp: 1800Hz jumping to 2400Hz
      osc.frequency.setValueAtTime(1800, this.ctx.currentTime);
      osc.frequency.setValueAtTime(2400, this.ctx.currentTime + 0.04);

      gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.12);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.12);
    } catch (e) {
      console.warn('Audio feedback failed:', e);
    }
  }

  playError() {
    try {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      // Harsh industrial error buzz: 220Hz
      osc.frequency.setValueAtTime(220, this.ctx.currentTime);
      osc.frequency.setValueAtTime(180, this.ctx.currentTime + 0.15);

      gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.3);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.3);
    } catch (e) {
      console.warn('Audio feedback failed:', e);
    }
  }
}

const scannerAudio = new ScannerAudio();

/**
 * Main Knockout ViewModel
 */
function ScannerViewModel() {
  const self = this;

  // --- Observables (State) ---
  // In Knockout, an observable is a getter/setter function:
  // Read: self.scannedBarcode()
  // Write: self.scannedBarcode('new-value')
  // (Unlike React where you have const [scannedBarcode, setScannedBarcode] = useState(''))
  self.scannedBarcode = ko.observable('');
  self.selectedItem = ko.observable(null);
  self.fromBin = ko.observable('');
  self.toBin = ko.observable('');
  self.transferQty = ko.observable(1);

  self.isProcessing = ko.observable(false);
  self.isTransferring = ko.observable(false);
  self.soundEnabled = ko.observable(true);

  // Visual scan flash indicators
  self.flashSuccess = ko.observable(false);
  self.flashError = ko.observable(false);

  // Status feedback message
  self.feedbackMessage = ko.observable('');
  self.feedbackType = ko.observable('info'); // 'info' | 'success' | 'error'

  // Navigation tab for right column (Physical Warehouse environment)
  self.activeViewTab = ko.observable('items'); // 'items' | 'ledger' | 'activity'

  // Collections (Observable Arrays)
  self.inventoryList = ko.observableArray([]);
  self.transferHistory = ko.observableArray([]);
  self.telemetryLogs = ko.observableArray([]);
  self.allWarehouseBins = ko.observableArray([
    'BIN-A01', 'BIN-A02', 'BIN-B01', 'BIN-B02', 'BIN-B04', 'BIN-C01', 'BIN-C02', 'BIN-STAGE'
  ]);

  // Middleware cache stats
  self.cacheStats = ko.observable({
    hitRatio: '0.0%',
    hits: 0,
    misses: 0,
    savedLatencyMs: 0
  });

  // --- Computed Observables ---
  // Knockout's ko.computed automatically observes any observables called within it.
  // When self.selectedItem() changes, sourceBinOptions automatically updates!
  self.sourceBinOptions = ko.computed(function() {
    const item = self.selectedItem();
    if (!item || !item.bins) return [];
    return item.bins.map(b => b.bin_id);
  });

  // Destination bin options (excludes the currently selected source bin)
  self.destBinOptions = ko.computed(function() {
    const from = self.fromBin();
    return self.allWarehouseBins().filter(b => b !== from);
  });

  // Available stock in currently selected fromBin
  self.availableInFromBin = ko.computed(function() {
    const item = self.selectedItem();
    const from = self.fromBin();
    if (!item || !from || !item.bins) return null;
    const match = item.bins.find(b => b.bin_id === from);
    return match ? match.qty_on_hand : 0;
  });

  // Validation rule for commit transfer button
  self.canCommitTransfer = ko.computed(function() {
    if (self.isTransferring() || self.isProcessing()) return false;
    if (!self.selectedItem()) return false;
    if (!self.fromBin() || !self.toBin()) return false;
    if (self.fromBin() === self.toBin()) return false;

    const qty = Number(self.transferQty());
    const available = self.availableInFromBin();
    return !isNaN(qty) && qty > 0 && available !== null && qty <= available;
  });

  // --- User Actions & Methods ---

  self.toggleSound = function() {
    self.soundEnabled(!self.soundEnabled());
  };

  self.triggerFlash = function(isSuccess) {
    if (isSuccess) {
      self.flashSuccess(true);
      setTimeout(() => self.flashSuccess(false), 450);
      if (self.soundEnabled()) scannerAudio.playSuccess();
    } else {
      self.flashError(true);
      setTimeout(() => self.flashError(false), 550);
      if (self.soundEnabled()) scannerAudio.playError();
    }
  };

  self.showFeedback = function(message, type = 'info', durationMs = 4000) {
    self.feedbackMessage(message);
    self.feedbackType(type);
    if (durationMs > 0) {
      setTimeout(() => {
        if (self.feedbackMessage() === message) {
          self.feedbackMessage('');
        }
      }, durationMs);
    }
  };

  self.selectSourceBin = function(binId) {
    self.fromBin(binId);
    // Auto-select a smart default destination bin (e.g. BIN-STAGE or another bin)
    const options = self.destBinOptions();
    if (options.length > 0 && !self.toBin()) {
      self.toBin(options.includes('BIN-STAGE') ? 'BIN-STAGE' : options[0]);
    }
  };

  self.incrementQty = function() {
    const current = Number(self.transferQty()) || 1;
    const max = self.availableInFromBin() || 9999;
    if (current < max) {
      self.transferQty(current + 1);
    }
  };

  self.decrementQty = function() {
    const current = Number(self.transferQty()) || 1;
    if (current > 1) {
      self.transferQty(current - 1);
    }
  };

  self.setMaxQty = function() {
    const max = self.availableInFromBin();
    if (max > 0) {
      self.transferQty(max);
    }
  };

  self.handleBarcodeKeypress = function(data, event) {
    if (event.keyCode === 13) { // Enter key
      self.executeLookup();
      return false;
    }
    return true;
  };

  self.scanWarehouseBarcode = function(barcode) {
    // If the barcode is a shelf bin barcode and an item is already active:
    if (/^BIN-[A-Z0-9-]+$/i.test(barcode) && self.selectedItem()) {
      if (!self.fromBin()) {
        self.fromBin(barcode);
        self.showFeedback(`Source bin scanned: ${barcode}`, 'info', 2500);
        self.triggerFlash(true);
      } else {
        self.toBin(barcode);
        self.showFeedback(`Destination bin scanned: ${barcode}`, 'info', 2500);
        self.triggerFlash(true);
      }
      return;
    }

    // Otherwise, it is an item or general scan:
    self.scannedBarcode(barcode);
    self.executeLookup();
  };

  self.quickScan = self.scanWarehouseBarcode;

  self.resetForm = function() {
    self.scannedBarcode('');
    self.selectedItem(null);
    self.fromBin('');
    self.toBin('');
    self.transferQty(1);
    self.feedbackMessage('');
    const input = document.getElementById('barcodeInput');
    if (input) input.focus();
  };

  /**
   * Barcode Lookup Handler
   * Calls Express Middleware: GET /api/scanner/lookup?barcode=...
   */
  self.executeLookup = async function() {
    const barcode = self.scannedBarcode().trim();
    if (!barcode || self.isProcessing()) return;

    self.isProcessing(true);
    self.feedbackMessage('');

    try {
      const response = await fetch(`/api/scanner/lookup?barcode=${encodeURIComponent(barcode)}`);
      const result = await response.json();

      if (response.ok && result.success) {
        self.selectedItem(result.data);
        self.triggerFlash(true);

        // Auto-select first source bin if available
        if (result.data.bins && result.data.bins.length > 0) {
          self.fromBin(result.data.bins[0].bin_id);
          const dests = self.destBinOptions();
          self.toBin(dests.includes('BIN-STAGE') ? 'BIN-STAGE' : dests[0]);
        }

        // Check if barcode had extracted quantity (e.g. from GS1-128 AI)
        if (result.parsedBarcode && result.parsedBarcode.quantity > 1) {
          self.transferQty(result.parsedBarcode.quantity);
        } else {
          self.transferQty(1);
        }

        self.showFeedback(
          `Scanned: ${result.data.sku} (${result.source} in ${result.latencyMs}ms)`,
          'success'
        );

        // Append to Telemetry log
        self.logTelemetry({
          type: result.source === 'CACHE' ? 'log-cache-hit' : 'log-restlet-hit',
          badge: result.source === 'CACHE' ? 'CACHE HIT' : 'ERP RESTLET',
          badgeClass: result.source === 'CACHE' ? 'badge-green' : 'badge-amber',
          title: `Lookup: ${barcode}`,
          latency: result.latencyMs,
          message: `${result.data.displayName} (${result.data.totalQty} total in WH)`,
          details: result.source === 'CACHE'
            ? `Served from Node.js in-memory buffer in ${result.latencyMs}ms (NetSuite roundtrip avoided)`
            : `Invoked NetSuite RESTlet with Token-Based Authentication:\nSignature: ${result.tbaSignature || 'OK'}\nLatency: ${result.latencyMs}ms`
        });
      } else {
        self.triggerFlash(false);
        const errMsg = result.error || 'Barcode not found';
        self.showFeedback(errMsg, 'error');

        self.logTelemetry({
          type: 'log-error',
          badge: 'ERROR 404',
          badgeClass: 'badge-red',
          title: `Lookup Failed: ${barcode}`,
          latency: result.latencyMs || 0,
          message: errMsg,
          details: result.tbaHeader ? `NetSuite TBA Header Generated:\n${result.tbaHeader}` : null
        });
      }
    } catch (err) {
      self.triggerFlash(false);
      self.showFeedback(`Connection failed: ${err.message}`, 'error');
    } finally {
      self.isProcessing(false);
      self.refreshStats();
    }
  };

  /**
   * Commit Bin Transfer Handler
   * Calls Express Middleware: POST /api/scanner/transfer
   */
  self.commitTransfer = async function() {
    if (!self.canCommitTransfer() || self.isTransferring()) return;

    self.isTransferring(true);
    const item = self.selectedItem();
    const fromBin = self.fromBin();
    const toBin = self.toBin();
    const qty = Number(self.transferQty());

    try {
      const response = await fetch('/api/scanner/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: item.itemId,
          fromBin,
          toBin,
          quantity: qty
        })
      });

      const result = await response.json();

      if (response.ok && result.success) {
        self.triggerFlash(true);
        self.showFeedback(
          `Committed! Tx ID: ${result.transfer.transferId} (${qty} units ${fromBin} &rarr; ${toBin})`,
          'success',
          6000
        );

        self.logTelemetry({
          type: 'log-transfer',
          badge: 'N/record SAVED',
          badgeClass: 'badge-blue',
          title: `Bin Transfer: ${result.transfer.transferId}`,
          latency: result.latencyMs,
          message: `${item.sku}: Moved ${qty} units from ${fromBin} to ${toBin}`,
          details: `NetSuite SuiteScript 2.1 executed:\n- record.create({ type: 'bintransfer', isDynamic: true })\n- commitLine({ sublistId: 'inventory' })\n- save() -> ${result.transfer.transferId}\n- Surgical cache invalidated for itemId ${item.itemId}`
        });

        // Re-fetch item to update bin list in UI
        await self.executeLookup();
        // Refresh live ERP table and audit logs
        self.fetchInventory();
        self.fetchTransfers();
      } else {
        self.triggerFlash(false);
        const errMsg = result.error || 'Transfer failed in NetSuite';
        self.showFeedback(errMsg, 'error', 6000);

        self.logTelemetry({
          type: 'log-error',
          badge: result.errorCode || 'ERP REJECT',
          badgeClass: 'badge-red',
          title: `Transfer Failed`,
          latency: result.latencyMs || 0,
          message: errMsg,
          details: `NetSuite Error Code: ${result.errorCode || 'UNKNOWN'}\nDetails: ${JSON.stringify(result.details || {})}`
        });
      }
    } catch (err) {
      self.triggerFlash(false);
      self.showFeedback(`Network error: ${err.message}`, 'error');
    } finally {
      self.isTransferring(false);
      self.refreshStats();
    }
  };

  self.logTelemetry = function(entry) {
    const formatted = {
      ...entry,
      timestamp: new Date().toLocaleTimeString()
    };
    self.telemetryLogs.unshift(formatted);
    // Keep max 40 entries
    if (self.telemetryLogs().length > 40) {
      self.telemetryLogs.pop();
    }
  };

  self.clearTelemetry = function() {
    self.telemetryLogs.removeAll();
  };

  self.flushCache = async function() {
    await fetch('/api/scanner/cache/clear', { method: 'POST' });
    self.refreshStats();
    self.showFeedback('Middleware in-memory cache flushed', 'info');
  };

  self.refreshStats = async function() {
    try {
      const res = await fetch('/api/scanner/stats');
      const data = await res.json();
      if (data && data.cache) {
        self.cacheStats(data.cache);
      }
    } catch (e) {
      console.warn('Failed to fetch cache stats:', e);
    }
  };

  self.fetchInventory = async function() {
    try {
      const res = await fetch('/api/scanner/inventory');
      const data = await res.json();
      if (data && data.data) {
        self.inventoryList(data.data);
      }
    } catch (e) {
      console.warn('Failed to fetch inventory:', e);
    }
  };

  self.fetchTransfers = async function() {
    try {
      const res = await fetch('/api/scanner/transfers');
      const data = await res.json();
      if (data && data.data) {
        self.transferHistory(data.data);
      }
    } catch (e) {
      console.warn('Failed to fetch transfers:', e);
    }
  };

  // Initialize data on load
  self.init = function() {
    self.refreshStats();
    self.fetchInventory();
    self.fetchTransfers();
  };
}

// Bind Knockout ViewModel when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const vm = new ScannerViewModel();
  ko.applyBindings(vm);
  vm.init();
});
