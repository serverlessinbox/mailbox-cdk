/// <reference types="jest" />

/**
 * AuthorizerLambda: the environment it hands the Go handler (tables, auth policy, anonymous routes,
 * principal lookup) and the read grants it requests on the key store and config tables. The
 * statement each grant renders is pinned by the table that owns it.
 */

import { Template }                                                             from 'aws-cdk-lib/assertions';

import { AuthPolicyName }                                                       from '../../../contracts/auth-names';
import { Permission }                                                           from '../../../core/auth/jmap-scopes';
import { AuthorizerLambda }                                                     from '../authorizer-lambda';
import type { AuthorizerLambdaProps }                                           from '../authorizer-lambda';

import { expectGrantedOnceTo, fakeAuthKeyStoreTable, fakeDataTable,
  fakePatTable, fakeQueue }                                                     from './lambda-wrapper-fakes';
import { arrangeWrapperStack, onlyLambdaOf }                                    from './lambda-wrapper-helpers';

type OptionalProps = Partial<Pick<AuthorizerLambdaProps, 'anonymousRoutes' | 'principalLookup' | 'scopeMap' | 'personalAccessTokens'>>;

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
    scopeMap:       {},
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

  it('passes the provider scope map to the handler as OAUTH_SCOPE_MAP', () => {
    const scopeMap = { 'mail.read': [Permission.MAIL_READ_ITEMS] };

    expect(synthesize({ scopeMap }).environment).toMatchObject({ OAUTH_SCOPE_MAP: JSON.stringify(scopeMap) });
  });

  it('requests read on the key store table for itself', () => {
    const { lambda, authKeyStoreTable } = synthesize();

    expectGrantedOnceTo(authKeyStoreTable.grantReadJwks, lambda);
  });

  it('requests read on the config table for itself', () => {
    const { lambda, configTable } = synthesize();

    expectGrantedOnceTo(configTable.grantRead, lambda);
  });

  describe('personal access tokens', () => {
    function withTokens() {
      const patTable         = fakePatTable('pat-table');
      const auditEventsQueue = fakeQueue('audit-events');

      return { patTable, auditEventsQueue, ...synthesize({ personalAccessTokens: { patTable, auditEventsQueue } }) };
    }

    it('passes the token table name and the audit queue URL when tokens are accepted', () => {
      expect(withTokens().environment).toMatchObject({
        PAT_TABLE_NAME:         'pat-table',
        AUDIT_EVENTS_QUEUE_URL: 'https://sqs.fake/audit-events',
      });
    });

    it('requests the token lookup grant and the audit queue send grant for itself', () => {
      const { lambda, patTable, auditEventsQueue } = withTokens();

      expectGrantedOnceTo(patTable.grantPatLookup, lambda);
      expectGrantedOnceTo(auditEventsQueue.grantSend, lambda);
    });

    it('sets neither variable when tokens are not accepted', () => {
      const { environment } = synthesize();

      expect(environment).not.toHaveProperty('PAT_TABLE_NAME');
      expect(environment).not.toHaveProperty('AUDIT_EVENTS_QUEUE_URL');
    });
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
