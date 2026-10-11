/**
 * In-Memory High-Speed Cache for Warehouse Scans
 * 
 * Protects NetSuite ERP from rate-limit throttles (429 errors) and cuts
 * barcode scan latency from ~300ms down to <5ms.
 */

class MemoryCache {
  constructor(defaultTtlMs = 60 * 1000) {
    this.store = new Map();
    this.defaultTtlMs = defaultTtlMs;
    this.metrics = {
      hits: 0,
      misses: 0,
      savedLatencyMs: 0,
      totalLookups: 0
    };
  }

  get(key) {
    this.metrics.totalLookups++;
    const entry = this.store.get(key);

    if (!entry) {
      this.metrics.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.metrics.misses++;
      return null;
    }

    this.metrics.hits++;
    // Assume average NetSuite roundtrip avoided is ~300ms
    this.metrics.savedLatencyMs += 300;
    return entry.value;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
      cachedAt: Date.now()
    });
  }

  invalidate(key) {
    return this.store.delete(key);
  }

  /**
   * Surgical cache invalidation when inventory balances change
   */
  invalidateByPattern(predicate) {
    let count = 0;
    for (const [key, entry] of this.store.entries()) {
      if (predicate(key, entry.value)) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }

  clear() {
    this.store.clear();
  }

  getStats() {
    const total = this.metrics.hits + this.metrics.misses;
    const hitRatio = total > 0 ? ((this.metrics.hits / total) * 100).toFixed(1) : '0.0';
    return {
      size: this.store.size,
      hits: this.metrics.hits,
      misses: this.metrics.misses,
      hitRatio: `${hitRatio}%`,
      totalLookups: this.metrics.totalLookups,
      savedLatencyMs: this.metrics.savedLatencyMs
    };
  }
}

export const scanCache = new MemoryCache(2 * 60 * 1000); // 2 minutes TTL
