/**
 * Coverage for `ExpectedFailure`: a handler tells an expected failure from an unexpected error with
 * `instanceof`, and answers the caller with the message as the reason. If the check did not hold on
 * a thrown and caught instance, every expected failure would be flushed as an unexpected error.
 */

import { ExpectedFailure } from '../expected-failure';

describe('ExpectedFailure', () => {
  it('carries the reason as its message and is named ExpectedFailure', () => {
    const failure = new ExpectedFailure('ownership mismatch');

    expect(failure.message).toBe('ownership mismatch');
    expect(failure.name).toBe('ExpectedFailure');
  });

  it('is recognised by instanceof after being thrown and caught, and is an Error', () => {
    let caught: unknown;
    try {
      throw new ExpectedFailure('not found');
    } catch (thrown) {
      caught = thrown;
    }

    expect(caught instanceof ExpectedFailure).toBe(true);
    expect(caught instanceof Error).toBe(true);
  });
});
