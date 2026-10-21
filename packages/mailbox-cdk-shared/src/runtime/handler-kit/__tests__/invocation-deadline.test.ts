/**
 * Pins the margin a custom resource keeps for answering CloudFormation: with a minute or less left the
 * invocation has no time left, so the Lambda is never killed in the middle of work with an answer unsent.
 */

import { hasTimeLeft } from '../invocation-deadline';

describe('hasTimeLeft', () => {
  it('has no time left when exactly the answer margin remains', () => {
    expect(hasTimeLeft({ getRemainingTimeInMillis: () => 60_000 })).toBe(false);
  });

  it('has time left when more than the answer margin remains', () => {
    expect(hasTimeLeft({ getRemainingTimeInMillis: () => 60_001 })).toBe(true);
  });
});
