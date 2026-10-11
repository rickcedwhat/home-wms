/**
 * Concurrency Manager & Mutex Locking
 * 
 * Prevents race conditions and ERP record collisions when multiple warehouse
 * operators scan and transfer items from the same bin simultaneously.
 */

class AsyncKeyedMutex {
  constructor() {
    this.queues = new Map();
  }

  /**
   * Acquires a lock for a specific key (e.g. `item:1001:bin:BIN-A01`).
   * Returns an unlock function to be called in a finally block.
   */
  async acquire(key, timeoutMs = 5000) {
    const prev = this.queues.get(key) || Promise.resolve();
    let releaseLock;

    const currentPromise = new Promise((resolve) => {
      releaseLock = resolve;
    });

    const tailPromise = prev.then(() => currentPromise);
    this.queues.set(key, tailPromise);

    tailPromise.then(() => {
      if (this.queues.get(key) === tailPromise) {
        this.queues.delete(key);
      }
    });

    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`LOCK_TIMEOUT: Failed to acquire lock for key "${key}" within ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      await Promise.race([prev, timeoutPromise]);
    } catch (err) {
      // Release our queued slot once prev finishes so subsequent waiters are not blocked
      prev.then(() => releaseLock());
      throw err;
    } finally {
      clearTimeout(timer);
    }

    return releaseLock;
  }

  getActiveLocksCount() {
    return this.queues.size;
  }
}

export const concurrencyMutex = new AsyncKeyedMutex();
