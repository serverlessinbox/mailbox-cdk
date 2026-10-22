import { WorkerResult } from '../worker-result';

/**
 * Pins what the worker returns to the workflow. The workflow stops polling on `done` and feeds the counters
 * back into the next check, so a result that flips `done` or drops a counter ends or restarts a deployment
 * wrongly.
 */
describe('WorkerResult', () => {
  const retries = { deleteRetryCount: 2, createRetryCount: 1 };

  it('finished ends the polling and carries the retry counters it is given', () => {
    expect(WorkerResult.finished(retries)).toEqual({ done: true, ...retries });
  });

  it('pollAgain keeps the workflow polling and carries the retry counters it is given', () => {
    expect(WorkerResult.pollAgain(retries)).toEqual({ done: false, ...retries });
  });

  it.each([
    { description: 'finished', result: WorkerResult.finished(), done: true },
    { description: 'pollAgain', result: WorkerResult.pollAgain(), done: false },
  ])('leaves the counters out of $description when none are given', ({ result, done }) => {
    expect(result.done).toBe(done);
    expect(JSON.parse(JSON.stringify(result))).toEqual({ done });
  });
});
