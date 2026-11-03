interface FirstFailure {
  readonly reason: unknown;
}

/**
 * Runs `work` over every item with at most `limit` calls in flight, and returns the results in item order.
 * Every item runs even when one rejects; once all have settled, the promise rejects with the first rejection
 * in time. A `limit` that is not a positive integer is rejected before any work starts.
 */
export async function runConcurrently<Item, Result>(
  limit: number,
  items: readonly Item[],
  work: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`runConcurrently limit must be a positive integer, got ${limit}`);
  }
  const results = new Array<Result>(items.length);
  let nextIndex = 0;
  let firstFailure: FirstFailure | undefined;

  const runWorker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await work(items[index]);
      } catch (error) {
        firstFailure ??= { reason: error };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runWorker));
  if (firstFailure !== undefined) {
    throw firstFailure.reason;
  }
  return results;
}
