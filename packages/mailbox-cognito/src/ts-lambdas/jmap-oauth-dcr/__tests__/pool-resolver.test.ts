/// <reference types="jest" />

import './set-test-env';

import { resolvePoolId } from '../pool-resolver';

// Cold-start validation of USER_POOL_ID itself now lives in `config.ts` (see `config.test.ts`);
// `resolvePoolId`'s own contract is just "return the configured pool id regardless of tenantId".
describe('resolvePoolId', () => {
  it('returns the configured USER_POOL_ID regardless of the tenantId argument (today: single deployment-wide pool)', () => {
    expect(resolvePoolId('tenant-a')).toBe('pool-1');
    expect(resolvePoolId('tenant-b')).toBe('pool-1');
  });
});
