/**
 * Pins the identity a personal access token session carries. The edge recognises a token session by this value, and
 * the Go issuer must write the same literal; a change to either side alone would turn every token session into a
 * refused one.
 */

import { PAT_SESSION_IDENTITY } from '../auth-identifiers';

describe('PAT_SESSION_IDENTITY', () => {
  it('is the literal pat', () => {
    expect(PAT_SESSION_IDENTITY).toBe('pat');
  });
});
