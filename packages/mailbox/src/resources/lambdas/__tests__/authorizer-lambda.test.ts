/// <reference types="jest" />

/**
 * AuthorizerLambda: the environment it hands the Go handler (tables, auth policy, anonymous routes,
 * principal lookup) and the read grants it requests on the key store and config tables. The
 * statement each grant renders is pinned by the table that owns it.
 */

import { Template }                                                  from 'aws-cdk-lib/assertions';

import { AuthPolicyName }                                            from '../../../contracts/auth-names';
import { AuthorizerLambda }                                          from '../authorizer-lambda';
import type { AuthorizerLambdaProps }                                from '../authorizer-lambda';

import { expectGrantedOnceTo, fakeAuthKeyStoreTable, fakeDataTable } from './lambda-wrapper-fakes';
import { arrangeWrapperStack, onlyLambdaOf }                         from './lambda-wrapper-helpers';

type OptionalProps = Pick<AuthorizerLambdaProps, 'anonymousRoutes' | 'principalLookup'>;

function synthesize(optional: OptionalProps = {}) {
  const { stack, artifactResolver } = arrangeWrapperStack();
  const authKeyStoreTable           = fakeAuthKeyStoreTable('auth-key-store');
  const configTable                 = fakeDataTable('config-table');
  const lambda                      = new AuthorizerLambda(stack, 'authorizer', {
    authKeyStoreTable,
    configTable,
    artifactResolver,
    authPolicyName: AuthPolicyName.ADMIN_API,
    serviceName:    'jmap',
    pipeline:       'jmap',
    ...optional,
  });

  return { lambda, authKeyStoreTable, configTable, ...onlyLambdaOf(Template.fromStack(stack)) };
}

describe('AuthorizerLambda', () => {
  it('passes the table names, the auth policy and the anonymous routes comma-separated to the handler', () => {
    const { environment } = synthesize({ anonymousRoutes: ['GET /first', 'GET /second'] });

    expect(environment).toMatchObject({
      AUTH_KEY_STORE_TABLE_NAME: 'auth-key-store',
      CONFIG_TABLE_NAME:         'config-table',
      AUTH_POLICY_NAME:          'ADMIN_API',
      ALLOW_ANONYMOUS_ROUTES:    'GET /first,GET /second',
    });
  });

  it('passes an empty anonymous route list when none is given', () => {
    expect(synthesize().environment).toMatchObject({ ALLOW_ANONYMOUS_ROUTES: '' });
  });

  it('requests read on the key store table for itself', () => {
    const { lambda, authKeyStoreTable } = synthesize();

    expectGrantedOnceTo(authKeyStoreTable.grantRead, lambda);
  });

  it('requests read on the config table for itself', () => {
    const { lambda, configTable } = synthesize();

    expectGrantedOnceTo(configTable.grantRead, lambda);
  });

  describe('principal lookup', () => {
    it('sets PRINCIPAL_LOOKUP to on when the lookup is enabled', () => {
      expect(synthesize({ principalLookup: true }).environment).toMatchObject({ PRINCIPAL_LOOKUP: 'on' });
    });

    it.each([[undefined], [false]])('sets PRINCIPAL_LOOKUP to off when principalLookup is %p', (principalLookup) => {
      expect(synthesize({ principalLookup }).environment).toMatchObject({ PRINCIPAL_LOOKUP: 'off' });
    });
  });
});
