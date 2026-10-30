/// <reference types="jest" />

/**
 * MailImportRunnerLambda tests: the environment the runner is given, the grants it gives itself and its reserved
 * concurrency and timeout. The grants are read from the synthesized template with the real resources, so the blob
 * statements are the real `grantEmailBlobWrite` ones, not a fake. Each assertion here is the only guard for its rule.
 */

import { ArtifactZone, PinnedArtifactResolver }          from '@serverlessinbox/artifact-registry-cdk';
import { Match, Template }                               from 'aws-cdk-lib/assertions';
import { AttributeType, Table }                          from 'aws-cdk-lib/aws-dynamodb';
import * as kms                                          from 'aws-cdk-lib/aws-kms';
import { Bucket }                                        from 'aws-cdk-lib/aws-s3';
import * as cdk                                          from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }                 from 'aws-cdk-lib';

import { resourcesOfType }                               from '../../../__tests__/iam-test-helpers';
import type { IWebSocketBroadcastPublisher }             from '../../../contracts/websocket-push';
import { DataBlobStore }                                 from '../../buckets/data-blob-store';
import { ImportJobsQueue }                               from '../../queues/import-jobs-queue';
import { AuthKeyStoreTable }                             from '../../tables/auth-key-store-table';
import { DataTable }                                     from '../../tables/data-tables';
import { MailImportRunnerLambda }                        from '../mail-import-runner-lambda';

const RUNNER_ENVIRONMENT_NAMES = ['AUTH_KEY_STORE_TABLE_NAME', 'BLOB_STORE_NAME', 'CHANGELOG_TABLE_NAME', 'CONFIG_TABLE_NAME', 'IMPORT_JOBS_QUEUE_URL', 'IMPORT_MESSAGES_PER_SECOND', 'ITEM_TABLE_NAME', 'SERVICE_NAME'];
const ITEM_TABLE_ACTIONS       = ['dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:Query', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'];

interface FunctionProperties {
  readonly Environment:                   { readonly Variables: Record<string, string> };
  readonly Timeout:                       number;
  readonly MemorySize:                    number;
  readonly ReservedConcurrentExecutions?: number;
}

interface PolicyStatement {
  readonly Action:     string | string[];
  readonly Condition?: Record<string, Record<string, unknown>>;
}

interface PolicyProperties {
  readonly PolicyDocument: { readonly Statement: PolicyStatement[] };
}

function createStack(): cdk.Stack {
  return new cdk.Stack(new App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

function resolverFor(stack: cdk.Stack): PinnedArtifactResolver {
  return new PinnedArtifactResolver({
    packages:         {
      'mailbox-cdk': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
      'mailbox-go':  { version: '1.0.0', zone: ArtifactZone.REGIONAL },
    },
    location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
    deploymentRegion: stack.region,
  });
}

function dataTable(stack: cdk.Stack, id: string): DataTable {
  return new DataTable(new Table(stack, id, {
    partitionKey: { name: 'pk', type: AttributeType.STRING },
    sortKey:      { name: 'sk', type: AttributeType.STRING },
  }));
}

/**
 * Synthesizes the runner with the real tables, blob bucket, queue and auth key store, encrypted with a customer key when asked.
 * When a broadcaster is given, the runner is pointed at it before the template is taken.
 */
function arrangeRunner(encrypted: boolean, broadcaster?: IWebSocketBroadcastPublisher) {
  const stack     = createStack();
  const itemTable = dataTable(stack, 'item-table');
  const key       = encrypted ? new kms.Key(stack, 'AuthKey') : undefined;
  const runner    = new MailImportRunnerLambda(stack, 'mail-import-runner', {
    artifactResolver: resolverFor(stack),
    itemTable,
    configTable:       dataTable(stack, 'config-table'),
    changelogTable:    dataTable(stack, 'changelog-table'),
    blobStore:         new DataBlobStore(new Bucket(stack, 'blob-bucket')),
    importJobsQueue:   new ImportJobsQueue(stack, 'import-jobs-queue', { encryption: { kind: 'aws-managed' } }),
    authKeyStoreTable: new AuthKeyStoreTable(stack, 'auth-key-store', key),
  });
  if (broadcaster) {
    runner.enableWebSocketPush(broadcaster);
  }

  return { stack, runner, template: Template.fromStack(stack), itemTable };
}

function allStatements(template: Template): PolicyStatement[] {
  return resourcesOfType<PolicyProperties>(template, 'AWS::IAM::Policy').flatMap((policy) => policy.PolicyDocument.Statement);
}

function actionsOf(statement: PolicyStatement): string[] {
  return [statement.Action].flat();
}

function runnerProperties(template: Template): FunctionProperties {
  const runners = resourcesOfType<FunctionProperties>(template, 'AWS::Lambda::Function')
    .filter((properties) => 'IMPORT_MESSAGES_PER_SECOND' in properties.Environment.Variables);
  expect(runners).toHaveLength(1);
  return runners[0];
}

describe('MailImportRunnerLambda', () => {
  it('gives the function exactly the environment names its Go config reads', () => {
    const { template } = arrangeRunner(false);

    const variables = runnerProperties(template).Environment.Variables;
    expect(Object.keys(variables).sort()).toEqual([...RUNNER_ENVIRONMENT_NAMES].sort());
    expect(variables.IMPORT_MESSAGES_PER_SECOND).toBe('5');
  });

  it('runs with reserved concurrency 3, a 5 minute timeout and 1024 MB of memory', () => {
    const { template } = arrangeRunner(false);

    const runner = runnerProperties(template);
    expect(runner.ReservedConcurrentExecutions).toBe(3);
    expect(runner.Timeout).toBe(300);
    expect(runner.MemorySize).toBe(1024);
  });

  it('writes blobs with s3:PutObject only, so the runner reads no mail blob (C18)', () => {
    const { template } = arrangeRunner(false);

    const s3Actions = new Set(allStatements(template).flatMap(actionsOf).filter((action) => action.startsWith('s3:')));
    expect([...s3Actions]).toEqual(['s3:PutObject']);
  });

  it('reads the connection private key with GetItem only, by its partition key condition', () => {
    const { template } = arrangeRunner(false);

    const privateKeyActions = allStatements(template)
      .filter((statement) => JSON.stringify(statement.Condition ?? {}).includes('connection-key-private'))
      .flatMap(actionsOf);
    expect(privateKeyActions).toEqual(['dynamodb:GetItem']);
  });

  it('grants the item table the actions the runner calls', () => {
    const { template, stack, itemTable } = arrangeRunner(false);
    const itemTableArn: unknown          = stack.resolve(itemTable.tableArn);

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([Match.objectLike({ Action: ITEM_TABLE_ACTIONS, Resource: Match.arrayWith([itemTableArn]) })]),
      },
    });
  });

  it('adds KMS statements for the auth key store only when it is encrypted with a customer key', () => {
    const kmsStatementCount = (template: Template) => allStatements(template)
      .filter((statement) => actionsOf(statement).some((action) => action.startsWith('kms:')))
      .length;

    expect(kmsStatementCount(arrangeRunner(false).template)).toBe(0);
    expect(kmsStatementCount(arrangeRunner(true).template)).toBeGreaterThan(0);
  });

  it('pushes over the WebSocket once enabled: the broadcaster name is in its environment and the runner is granted the invoke', () => {
    const grantInvoke          = jest.fn();
    const { runner, template } = arrangeRunner(false, { functionName: 'broadcaster-function', grantInvoke });

    expect(runnerProperties(template).Environment.Variables.WEBSOCKET_BROADCAST_FUNCTION_NAME).toBe('broadcaster-function');
    expect(grantInvoke).toHaveBeenCalledTimes(1);
    expect(grantInvoke).toHaveBeenCalledWith(runner);
  });
});
