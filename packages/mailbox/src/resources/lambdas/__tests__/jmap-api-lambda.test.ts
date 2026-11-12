/// <reference types="jest" />

/**
 * JmapApiLambda: the environment it hands the Go handler (resource names, hosts, the OAuth scope
 * map and the optional protected-resource URL), the grants it requests for itself on its tables,
 * blob store, queues and identity provisioner, the license API invoke statement it adds itself, and
 * the websocket push wiring it takes through enableWebSocketPush. The statement each requested
 * grant renders is pinned by the resource that owns it.
 */

import { actionsOf, resourcesOf, statementsForAction }                          from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { VENDOR_ACCOUNT_ID }                                                    from '@serverlessinbox/mailbox-cdk-shared';
import { Template }                                                             from 'aws-cdk-lib/assertions';
import { Table }                                                                from 'aws-cdk-lib/aws-dynamodb';

import type { IStateChangeFanout }                                              from '../../../contracts/state-change-fanout';
import { Permission }                                                           from '../../../core/auth/jmap-scopes';
import { DataPatTable }                                                         from '../../tables/data-pat-table';
import { JmapApiLambda }                                                        from '../jmap-api-lambda';

import { expectGrantedOnceTo, fakeAuthKeyStoreTable, fakeDataBlobStore,
  fakeConfigTable, fakeDataTable, fakeIdentityProvisioner, fakeQueue }          from './lambda-wrapper-fakes';
import { arrangeWrapperStack, onlyLambdaOf }                                    from './lambda-wrapper-helpers';

const PAT_TABLE_ARN = 'arn:aws:dynamodb:us-west-2:123456789012:table/pat-table';

function synthesize(oauthProtectedResourceUrl?: string) {
  const { stack, artifactResolver } = arrangeWrapperStack();
  const configTable                 = fakeConfigTable('config-table');
  const itemTable                   = fakeDataTable('item-table');
  const changelogTable              = fakeDataTable('changelog-table');
  const authKeyStoreTable           = fakeAuthKeyStoreTable('auth-key-store');
  const patTable                    = new DataPatTable(Table.fromTableAttributes(stack, 'pat-table', { tableArn: PAT_TABLE_ARN }));
  const blobStore                   = fakeDataBlobStore('blob-store');
  const emailSubmissionQueue        = fakeQueue('email-submission');
  const auditEventsQueue            = fakeQueue('audit-events');
  const identityProvisioner         = fakeIdentityProvisioner('identity-provisioner');
  const lambda                      = new JmapApiLambda(stack, 'jmap-api', {
    configTable,
    itemTable,
    changelogTable,
    authKeyStoreTable,
    patTable,
    blobStore,
    emailSubmissionQueue,
    auditEventsQueue,
    cdnHost:    'cdn.example.com',
    apiBaseUrl: 'https://jmap.example.com',
    artifactResolver,
    identityProvisioner,
    scopeMap:         { 'mail.read': [Permission.MAIL_READ_ITEMS] },
    vendorAccountIds: [VENDOR_ACCOUNT_ID],
    oauthProtectedResourceUrl,
  });

  return { lambda, stack, configTable, itemTable, changelogTable, authKeyStoreTable, blobStore, emailSubmissionQueue, auditEventsQueue, identityProvisioner };
}

function synthesizeTemplate(oauthProtectedResourceUrl?: string) {
  const arrangement = synthesize(oauthProtectedResourceUrl);
  const template    = Template.fromStack(arrangement.stack);

  return { template, ...onlyLambdaOf(template) };
}

describe('JmapApiLambda', () => {
  describe('environment', () => {
    it('passes the resource names, queue URLs, hosts and OAuth scope map to the handler', () => {
      expect(synthesizeTemplate().environment).toMatchObject({
        CONFIG_TABLE_NAME:                  'config-table',
        ITEM_TABLE_NAME:                    'item-table',
        CHANGELOG_TABLE_NAME:               'changelog-table',
        AUTH_KEY_STORE_TABLE_NAME:          'auth-key-store',
        PAT_TABLE_NAME:                     'pat-table',
        BLOB_STORE_NAME:                    'blob-store',
        EMAIL_SUBMISSION_QUEUE_URL:         'https://sqs.fake/email-submission',
        AUDIT_EVENTS_QUEUE_URL:             'https://sqs.fake/audit-events',
        IDENTITY_PROVISIONER_FUNCTION_NAME: 'identity-provisioner',
        CDN_HOST:                           'cdn.example.com',
        API_BASE_URL:                       'https://jmap.example.com',
        OAUTH_HANDLER_CONFIG:               JSON.stringify({ scopeMap: { 'mail.read': [Permission.MAIL_READ_ITEMS] } }),
      });
    });

    it('omits OAUTH_PROTECTED_RESOURCE_URL when no URL is supplied', () => {
      expect(Object.keys(synthesizeTemplate().environment)).not.toContain('OAUTH_PROTECTED_RESOURCE_URL');
    });

    it('sets OAUTH_PROTECTED_RESOURCE_URL to the supplied URL', () => {
      const { environment } = synthesizeTemplate('https://jmap.example.com/.well-known/oauth-protected-resource');

      expect(environment).toMatchObject({ OAUTH_PROTECTED_RESOURCE_URL: 'https://jmap.example.com/.well-known/oauth-protected-resource' });
    });
  });

  describe('grants it requests for itself', () => {
    it('read and active Sieve script pointer update on the config table and read on the auth key store table', () => {
      const { lambda, configTable, authKeyStoreTable } = synthesize();

      expectGrantedOnceTo(configTable.grantRead, lambda);
      expectGrantedOnceTo(configTable.grantActiveSieveScriptUpdate, lambda);
      expectGrantedOnceTo(authKeyStoreTable.grantReadHmac, lambda);
    });

    it('read-write on the item and changelog tables', () => {
      const { lambda, itemTable, changelogTable } = synthesize();

      expectGrantedOnceTo(itemTable.grantReadWrite, lambda);
      expectGrantedOnceTo(changelogTable.grantReadWrite, lambda);
    });

    it('read-write-delete on the email, upload, contact, sieve and principal blobs and read on the search index', () => {
      const { lambda, blobStore } = synthesize();

      expectGrantedOnceTo(blobStore.grantEmailBlobReadWriteDelete, lambda);
      expectGrantedOnceTo(blobStore.grantUploadBlobReadWriteDelete, lambda);
      expectGrantedOnceTo(blobStore.grantContactBlobReadWriteDelete, lambda);
      expectGrantedOnceTo(blobStore.grantSieveBlobReadWriteDelete, lambda);
      expectGrantedOnceTo(blobStore.grantPrincipalBlobReadWriteDelete, lambda);
      expectGrantedOnceTo(blobStore.grantSearchIndexRead, lambda);
    });

    it('send on the email-submission and audit-events queues and invoke on the identity provisioner', () => {
      const { lambda, emailSubmissionQueue, auditEventsQueue, identityProvisioner } = synthesize();

      expectGrantedOnceTo(emailSubmissionQueue.grantSend, lambda);
      expectGrantedOnceTo(auditEventsQueue.grantSend, lambda);
      expectGrantedOnceTo(identityProvisioner.grantInvoke, lambda);
    });
  });

  it('reads owner rows of the PAT table under the tenant key prefix and nothing else', () => {
    const { statements } = synthesizeTemplate();

    expect(statements.filter((statement) => actionsOf(statement).some((action) => action.startsWith('dynamodb:'))).map((statement) => ({
      actions:   actionsOf(statement),
      resources: resourcesOf(statement),
      condition: statement.Condition,
    }))).toEqual([
      {
        actions:   ['dynamodb:GetItem'],
        resources: [PAT_TABLE_ARN],
        condition: { 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['TENANT#*PAT_OWNER#*'] } },
      },
    ]);
  });

  it('scopes execute-api:Invoke to the grant-resource and revoke-resource paths of the vendor account', () => {
    const executeApiArn = (path: string): unknown => ({
      'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, `:execute-api:*:${VENDOR_ACCOUNT_ID}:${path}`]],
    });

    expect(statementsForAction(synthesizeTemplate().template, 'execute-api:Invoke')).toEqual([
      {
        Action:   'execute-api:Invoke',
        Effect:   'Allow',
        Resource: [executeApiArn('*/*/POST/grant-resource'), executeApiArn('*/*/POST/revoke-resource')],
      },
    ]);
  });

  it('enableWebSocketPush sets the websocket URL and state-change fan-out name and lets the state-change fan-out grant itself invokable', () => {
    const { lambda, stack }                     = synthesize();
    const stateChangeFanout: IStateChangeFanout = { functionName: 'fanout-function', grantInvoke: jest.fn() };

    lambda.enableWebSocketPush('wss://ws.example.com', stateChangeFanout);

    expect(onlyLambdaOf(Template.fromStack(stack)).environment).toMatchObject({
      WEBSOCKET_URL:                     'wss://ws.example.com',
      WEBSOCKET_BROADCAST_FUNCTION_NAME: 'fanout-function',
    });
    expect(stateChangeFanout.grantInvoke).toHaveBeenCalledWith(lambda);
  });
});
