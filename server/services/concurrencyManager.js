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

    const currentPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`LOCK_TIMEOUT: Failed to acquire lock for key "${key}" within ${timeoutMs}ms`));
      }, timeoutMs);

      releaseLock = () => {
        clearTimeout(timer);
        resolve();
      };
    });

    const tailPromise = prev.then(() => currentPromise);
    this.queues.set(key, tailPromise);

    tailPromise.finally(() => {
      if (this.queues.get(key) === tailPromise) {
        this.queues.delete(key);
      }
    });

    await prev;
    return releaseLock;
  }

  getActiveLocksCount() {
    return this.queues.size;
  }
}

export const concurrencyMutex = new AsyncKeyedMutex();
