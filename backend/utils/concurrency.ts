type Mapper<T, R> = (item: T, index: number) => Promise<R> | R;

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: Mapper<T, R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function mapSettledWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: Mapper<T, R>
): Promise<PromiseSettledResult<R>[]> {
  return mapWithConcurrency(items, concurrency, async (item, index) => {
    try {
      return {
        status: 'fulfilled',
        value: await mapper(item, index)
      };
    } catch (reason) {
      return {
        status: 'rejected',
        reason
      };
    }
  });
}

function createConcurrencyLimiter(concurrency = 1) {
  const limit = Math.max(1, Math.floor(Number(concurrency) || 1));
  interface QueueEntry {
    abort?: () => void;
    reject: (reason?: unknown) => void;
    resolve: (value: unknown) => void;
    signal?: AbortSignal;
    task: () => unknown | Promise<unknown>;
  }

  const queue: QueueEntry[] = [];
  let activeCount = 0;

  function runNext() {
    while (activeCount < limit && queue.length > 0) {
      const entry = queue.shift();
      if (!entry) {
        continue;
      }
      if (entry.abort) {
        entry.signal?.removeEventListener('abort', entry.abort);
      }
      try {
        entry.signal?.throwIfAborted();
      } catch (error) {
        entry.reject(error);
        continue;
      }
      activeCount += 1;
      Promise.resolve()
        .then(entry.task)
        .then(entry.resolve, entry.reject)
        .finally(() => {
          activeCount -= 1;
          runNext();
        });
    }
  }

  return <T>(task: () => T | Promise<T>, options: { signal?: AbortSignal } = {}) => new Promise<T>((resolve, reject) => {
    const entry: QueueEntry = {
      task,
      signal: options.signal,
      resolve: (value) => resolve(value as T),
      reject
    };
    if (entry.signal) {
      const signal = entry.signal;
      entry.abort = () => {
        const index = queue.indexOf(entry);
        if (index >= 0) {
          queue.splice(index, 1);
          reject(signal.reason);
        }
      };
      entry.signal.addEventListener('abort', entry.abort, { once: true });
    }
    queue.push(entry);
    runNext();
  });
}

export = {
  createConcurrencyLimiter,
  mapWithConcurrency,
  mapSettledWithConcurrency
};
