/// <reference types="jest" />

/**
 * AuthKeyStoreUpdaterLambda: the issuers and table name it hands the Go handler, the read-write
 * grant it requests on the key store, and the two triggers it registers for itself: the refresh
 * schedule and the stack-deployed event. The statement the grant renders and the rule each trigger
 * renders are pinned by the table and the triggers, not here.
 */

import { Template }                                         from 'aws-cdk-lib/assertions';

import { AuthKeyRefreshSchedule }                           from '../../events/auth-key-refresh-schedule';
import { AuthKeyStoreUpdaterLambda }                        from '../auth-key-store-updater-lambda';

import { expectGrantedOnceTo, fakeAuthKeyStoreTable }       from './lambda-wrapper-fakes';
import { arrangeWrapperStack, onlyLambdaOf }                from './lambda-wrapper-helpers';

jest.mock('../../events/auth-key-refresh-schedule');

function synthesize() {
  const { stack, artifactResolver } = arrangeWrapperStack();
  const authKeyStoreTable           = fakeAuthKeyStoreTable('auth-key-store');
  const lambda                      = new AuthKeyStoreUpdaterLambda(stack, 'auth-key-store-updater', {
    issuers: ['https://issuer-a.example.com', 'https://issuer-b.example.com'],
    authKeyStoreTable,
    artifactResolver,
  });
  const template                    = Template.fromStack(stack);

  return { lambda, authKeyStoreTable, template, ...onlyLambdaOf(template) };
}

describe('AuthKeyStoreUpdaterLambda', () => {
  beforeEach(() => {
    jest.mocked(AuthKeyRefreshSchedule).mockClear();
  });

  it('passes the issuers comma-separated and the key store table name to the handler', () => {
    expect(synthesize().environment).toMatchObject({
      ISSUERS:                   'https://issuer-a.example.com,https://issuer-b.example.com',
      AUTH_KEY_STORE_TABLE_NAME: 'auth-key-store',
    });
  });

  it('requests read-write on the key store table for itself', () => {
    const { lambda, authKeyStoreTable } = synthesize();

    expectGrantedOnceTo(authKeyStoreTable.grantReadWrite, lambda);
  });

  it('registers the refresh schedule with itself as the target', () => {
    const { lambda } = synthesize();

    expect(AuthKeyRefreshSchedule).toHaveBeenCalledTimes(1);
    expect(AuthKeyRefreshSchedule).toHaveBeenCalledWith(lambda, 'refresh-schedule', { target: lambda });
  });

  it('registers a stack-deployed event that invokes itself', () => {
    const { template, logicalId } = synthesize();

    template.resourceCountIs('AWS::Events::Rule', 1);
    template.hasResourceProperties('AWS::Events::Rule', {
      Targets: [{ Arn: { 'Fn::GetAtt': [logicalId, 'Arn'] }, Id: 'Target0' }],
    });
  });
});
