/**
 * Pins the concurrency contract of the shared helper: the cap on calls in flight, item-ordered results, every
 * item running even after a rejection, and the rejection the caller sees. Work is held open by deferred
 * promises, so each assertion is about the moment it is made, not about timing.
 */

import { runConcurrently } from '../run-concurrently';

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
  readonly reject:  (reason: unknown) => void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve: (value: Value) => void   = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise                         = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject  = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  for (let tick = 0; tick < 10; tick += 1) {
    await Promise.resolve();
  }
}

describe('runConcurrently', () => {
  it('never has more calls in flight than the limit, and completes every item', async () => {
    const items             = [0, 1, 2, 3, 4, 5];
    const gates             = items.map(() => deferred<number>());
    const started: number[] = [];
    let inFlight            = 0;
    let peak                = 0;
    const work              = (item: number): Promise<number> => {
      started.push(item);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return gates[item].promise.then((value) => {
        inFlight -= 1;
        return value;
      });
    };

    const done = runConcurrently(2, items, work);
    await flushMicrotasks();
    expect(started).toEqual([0, 1]);

    for (const item of items) {
      gates[item].resolve(item);
      await flushMicrotasks();
    }

    expect(await done).toEqual(items);
    expect(peak).toBe(2);
  });

  it('returns results in item order when items finish out of order', async () => {
    const items = [0, 1, 2];
    const gates = items.map(() => deferred<number>());

    const done = runConcurrently(items.length, items, (item) => gates[item].promise);
    for (const item of [...items].reverse()) {
      gates[item].resolve(item * 10);
      await flushMicrotasks();
    }

    expect(await done).toEqual([0, 10, 20]);
  });

  it('runs every item when the limit is above the item count', async () => {
    const results = await runConcurrently(10, [1, 2, 3], async (item) => item * 2);

    expect(results).toEqual([2, 4, 6]);
  });

  it('resolves empty input to an empty list without calling the work', async () => {
    let calls = 0;

    const results = await runConcurrently(3, [], async () => {
      calls += 1;
      return 'never';
    });

    expect(results).toEqual([]);
    expect(calls).toBe(0);
  });

  it('still runs the other items when one rejects, then rejects with that error', async () => {
    const failure       = new Error('item 1 failed');
    const ran: number[] = [];

    const done = runConcurrently(1, [0, 1, 2], async (item) => {
      ran.push(item);
      if (item === 1) {
        throw failure;
      }
      return item;
    });

    await expect(done).rejects.toBe(failure);
    expect(ran).toEqual([0, 1, 2]);
  });

  it('rejects with the first rejection in time when several items reject', async () => {
    const gates   = [deferred<number>(), deferred<number>()];
    const earlier = new Error('item 1 failed first');
    const later   = new Error('item 0 failed second');

    const done = runConcurrently(2, [0, 1], (item) => gates[item].promise);
    gates[1].reject(earlier);
    await flushMicrotasks();
    gates[0].reject(later);

    await expect(done).rejects.toBe(earlier);
  });

  it('throws a RangeError naming the value when the limit is 0, before any work starts', async () => {
    let calls = 0;

    await expect(
      runConcurrently(0, [1], async () => {
        calls += 1;
        return calls;
      }),
    ).rejects.toThrow(RangeError);
    expect(calls).toBe(0);
  });

  it('throws a RangeError naming the value when the limit is not an integer', async () => {
    await expect(runConcurrently(1.5, [1], async (item) => item)).rejects.toThrow('got 1.5');
  });
});
