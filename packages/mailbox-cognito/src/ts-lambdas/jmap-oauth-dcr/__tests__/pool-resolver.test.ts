/// <reference types="jest" />

import './set-test-env';

import { resolvePoolId } from '../pool-resolver';

// Cold-start validation of USER_POOL_ID itself now lives in `config.ts` (see `config.test.ts`);
// `resolvePoolId`'s own contract is just "return the provided user pool id regardless of tenantId".
describe('resolvePoolId', () => {
  it('returns the provided userPoolId regardless of the tenantId argument (today: single deployment-wide pool)', () => {
    expect(resolvePoolId('tenant-a', 'pool-1')).toBe('pool-1');
    expect(resolvePoolId('tenant-b', 'pool-1')).toBe('pool-1');
  });
});
