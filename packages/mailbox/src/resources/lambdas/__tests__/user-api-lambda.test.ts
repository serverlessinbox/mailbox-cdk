/// <reference types="jest" />

/**
 * UserApiLambda tests: the environment the user-api Lambda is given and the grants it gives itself.
 * The function is the only Lambda in its stack, so both are read from the synthesized template. A
 * grant that drifts from what the handler calls, or an extra environment name, stays green in tsc
 * and synth, so these assertions are the only guard.
 */

import { ArtifactZone, PinnedArtifactResolver }                                 from '@serverlessinbox/artifact-registry-cdk';
import { Match, Template }                                                      from 'aws-cdk-lib/assertions';
import { AttributeType, Table }                                                 from 'aws-cdk-lib/aws-dynamodb';
import * as cdk                                                                 from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }                                        from 'aws-cdk-lib';

import type { IStateChangeFanout }                                              from '../../../contracts/state-change-fanout';
import { Permission }                                                           from '../../../core/auth/jmap-scopes';
import type { ScopeMap }                                                        from '../../../core/auth/jmap-scopes';
import { AuditEventsQueue }                                                     from '../../queues/audit-events-queue';
import { ImportJobsQueue }                                                      from '../../queues/import-jobs-queue';
import { AuthKeyStoreTable }                                                    from '../../tables/auth-key-store-table';
import { DataTable }                                                            from '../../tables/data-tables';
import { UserApiLambda }                                                        from '../user-api-lambda';

import { expectGrantedOnceTo, fakeDataBlobStore, fakeDataTable,
  fakeMailImportRunner, fakePatTable }                                          from './lambda-wrapper-fakes';

const ITEM_TABLE_ACTIONS: string[]   = ['dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:Query', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'];
const CONFIG_TABLE_ACTIONS: string[] = ['dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:Query'];
const AUDIT_QUEUE_ACTION             = 'sqs:SendMessage';

describe('UserApiLambda', () => {
  let stack: cdk.Stack;
  let itemTableArnOf: unknown;
  let configTableArnOf: unknown;
  let mailImportRunner: ReturnType<typeof fakeMailImportRunner>;
  let patTable: ReturnType<typeof fakePatTable>;
  let blobStore: ReturnType<typeof fakeDataBlobStore>;
  let changelogTable: ReturnType<typeof fakeDataTable>;
  let lambda: UserApiLambda;

  function dataTable(id: string): DataTable {
    return new DataTable(new Table(stack, id, {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey:      { name: 'sk', type: AttributeType.STRING },
    }));
  }

  function synthesize(stateChangeFanout?: IStateChangeFanout): Template {
    const scopeMap: ScopeMap = { 'mail-reader': [Permission.MAIL_READ_ITEMS] };

    const configTable       = dataTable('config-table');
    const itemTable         = dataTable('item-table');
    const auditEventsQueue  = new AuditEventsQueue(stack, 'audit-events-queue', { encryption: { kind: 'aws-managed' } });
    const authKeyStoreTable = new AuthKeyStoreTable(stack, 'auth-key-store-table');
    const importJobsQueue   = new ImportJobsQueue(stack, 'import-jobs-queue', { encryption: { kind: 'aws-managed' } });
    mailImportRunner        = fakeMailImportRunner('mail-import-runner');
    const artifactResolver  = new PinnedArtifactResolver({
      packages:         {
        'mailbox-cdk': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
        'mailbox-go':  { version: '1.0.0', zone: ArtifactZone.REGIONAL },
      },
      location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
      deploymentRegion: stack.region,
    });

    patTable       = fakePatTable('pat-table');
    blobStore      = fakeDataBlobStore('blob-store');
    changelogTable = fakeDataTable('changelog-table');

    lambda = new UserApiLambda(stack, 'user-api', {
      configTable,
      itemTable,
      auditEventsQueue,
      authKeyStoreTable,
      importJobsQueue,
      mailImportRunner,
      artifactResolver,
      patTable,
      blobStore,
      changelogTable,
      systemSenderAddress: 'noreply@example.com',
      scopeMap,
    });

    itemTableArnOf   = stack.resolve(itemTable.tableArn);
    configTableArnOf = stack.resolve(configTable.tableArn);

    if (stateChangeFanout) {
      lambda.enableWebSocketPush(stateChangeFanout);
    }

    return Template.fromStack(stack);
  }

  beforeEach(() => {
    stack = new cdk.Stack(new App(), 'TestStack', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
  });

  it('gives the function exactly the environment names its config reads', () => {
    const template = synthesize();

    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectEquals({
          CONFIG_TABLE_NAME:                Match.anyValue(),
          ITEM_TABLE_NAME:                  Match.anyValue(),
          AUDIT_EVENTS_QUEUE_URL:           Match.anyValue(),
          AUTH_KEY_STORE_TABLE_NAME:        Match.anyValue(),
          IMPORT_JOBS_QUEUE_URL:            Match.anyValue(),
          MAIL_IMPORT_RUNNER_FUNCTION_NAME: 'mail-import-runner',
          OAUTH_HANDLER_CONFIG:             Match.anyValue(),
          PAT_TABLE_NAME:                   'pat-table',
          BLOB_STORAGE_NAME:                'blob-store',
          CHANGELOG_TABLE_NAME:             'changelog-table',
          SYSTEM_SENDER_ADDRESS:            'noreply@example.com',
          SERVICE_NAME:                     'user-api',
        }),
      },
    });
  });

  it('hands the function the auth provider scope map as the OAUTH_HANDLER_CONFIG JSON', () => {
    const template = synthesize();

    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          OAUTH_HANDLER_CONFIG: '{"scopeMap":{"mail-reader":["mail/readItems"]}}',
        }),
      },
    });
  });

  it('grants read and write on the item table with exactly the actions the handler uses', () => {
    const template = synthesize();

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([Match.objectLike({ Action: ITEM_TABLE_ACTIONS, Resource: Match.arrayWith([itemTableArnOf]) })]),
      },
    });
  });

  it('grants read only on the config table', () => {
    const template = synthesize();

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([Match.objectLike({ Action: CONFIG_TABLE_ACTIONS, Resource: Match.arrayWith([configTableArnOf]) })]),
      },
    });
  });

  it('grants send only on the audit-events queue', () => {
    const template = synthesize();

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([Match.objectLike({ Action: AUDIT_QUEUE_ACTION })]),
      },
    });
  });

  it('grants a condition check on the item table ARN only', () => {
    const template = synthesize();

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([Match.objectLike({ Action: 'dynamodb:ConditionCheckItem', Resource: itemTableArnOf })]),
      },
    });
  });

  it('reads the connection public key only, by its partition key condition', () => {
    const template = synthesize();

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([Match.objectLike({
          Action:    'dynamodb:GetItem',
          Condition: { 'ForAllValues:StringEquals': { 'dynamodb:LeadingKeys': ['connection-key-public'] } },
        })]),
      },
    });
  });

  it('requests the token management, email blob write and changelog read-write grants for itself', () => {
    synthesize();

    expectGrantedOnceTo(patTable.grantPatManage, lambda);
    expectGrantedOnceTo(blobStore.grantEmailBlobWrite, lambda);
    expectGrantedOnceTo(changelogTable.grantReadWrite, lambda);
  });

  it('grants invoke on the mail-import runner', () => {
    synthesize();

    expect(mailImportRunner.grantInvoke).toHaveBeenCalledTimes(1);
  });

  it('enableWebSocketPush sets WEBSOCKET_BROADCAST_FUNCTION_NAME and lets the state-change fan-out grant itself invokable', () => {
    const stateChangeFanout: IStateChangeFanout = { functionName: 'fanout-function', grantInvoke: jest.fn() };

    const template = synthesize(stateChangeFanout);

    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ WEBSOCKET_BROADCAST_FUNCTION_NAME: 'fanout-function' }) },
    });
    expect(stateChangeFanout.grantInvoke).toHaveBeenCalledWith(lambda);
  });
});
