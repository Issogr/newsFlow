async function mapWithConcurrency(items = [], concurrency = 1, mapper = async (item) => item) {
  const results = new Array(items.length);
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

async function mapSettledWithConcurrency(items = [], concurrency = 1, mapper = async (item) => item) {
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

module.exports = {
  mapWithConcurrency,
  mapSettledWithConcurrency
};
