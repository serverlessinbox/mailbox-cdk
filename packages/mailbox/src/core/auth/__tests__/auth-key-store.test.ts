/**
 * AuthKeyStore owns the key-store table and the updater Lambda that fills it. These tests pin what the
 * construct adds: the issuers it passes to the updater, and the table it hands to the updater and
 * exposes to its caller.
 */
import { Template }             from 'aws-cdk-lib/assertions';
import type { Stack }           from 'aws-cdk-lib';

import { newDeployerTestStack } from '../../../__tests__/deployer-test-helpers';
import { AuthKeyStore }         from '../auth-key-store';

const ISSUER_A = 'https://issuer-a.example';
const ISSUER_B = 'https://issuer-b.example';

interface SynthesizedStore {
  readonly stack:          Stack;
  readonly store:          AuthKeyStore;
  readonly template:       Template;
  readonly tableLogicalId: string;
}

function synthStore(): SynthesizedStore {
  const { stack, artifactResolver } = newDeployerTestStack();
  const store                       = new AuthKeyStore(stack, 'auth-key-store', { issuers: [ISSUER_A, ISSUER_B], artifactResolver });
  const template                    = Template.fromStack(stack);
  const tableLogicalIds             = Object.keys(template.findResources('AWS::DynamoDB::Table'));
  expect(tableLogicalIds).toHaveLength(1);
  return { stack, store, template, tableLogicalId: tableLogicalIds[0] ?? '' };
}

describe('AuthKeyStore', () => {
  it('passes its issuers to the updater, comma-joined, in ISSUERS', () => {
    const { template } = synthStore();

    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: { ISSUERS: `${ISSUER_A},${ISSUER_B}` } },
    });
  });

  it('hands the table it creates to the updater as the table the updater writes', () => {
    const { template, tableLogicalId } = synthStore();

    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: { AUTH_KEY_STORE_TABLE_NAME: { Ref: tableLogicalId } } },
    });
  });

  it('exposes the same table to its caller as the one the updater writes', () => {
    const { stack, store, tableLogicalId } = synthStore();

    expect(stack.resolve(store.authKeyStoreTable.tableName)).toEqual({ Ref: tableLogicalId });
  });
});
