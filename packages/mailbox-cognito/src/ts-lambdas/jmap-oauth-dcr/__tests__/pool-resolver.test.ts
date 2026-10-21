/// <reference types="jest" />

import { toTenantId }   from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { toUserPoolId } from '../../../runtime/shared/cognito-identifiers';
import { PoolResolver } from '../pool-resolver';

describe('PoolResolver', () => {
  it('resolves every tenant to the one user pool of the deployment', () => {
    const resolver = new PoolResolver(toUserPoolId('pool-1'));

    expect(resolver.resolve(toTenantId('tenant-a'))).toBe('pool-1');
    expect(resolver.resolve(toTenantId('tenant-b'))).toBe('pool-1');
  });
});
