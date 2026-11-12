/// <reference types="jest" />

/**
 * JobSweeperLambda tests: the environment the sweeper is given, the item-table grant it gives itself, its memory and
 * timeout, and the schedule it registers. Read from the synthesized template with a real item table.
 */

import { ArtifactZone, PinnedArtifactResolver }                                 from '@serverlessinbox/artifact-registry-cdk';
import { Match, Template }                                                      from 'aws-cdk-lib/assertions';
import { AttributeType, Table }                                                 from 'aws-cdk-lib/aws-dynamodb';
import * as cdk                                                                 from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer, Duration }                              from 'aws-cdk-lib';

import { resourcesOfType }                                                      from '../../../__tests__/iam-test-helpers';
import type { IStateChangeFanout }                                              from '../../../contracts/state-change-fanout';
import { DataTable }                                                            from '../../tables/data-tables';
import { JobSweeperLambda }                                                     from '../job-sweeper-lambda';

import { expectGrantedOnceTo, fakeDataBlobStore, fakeDataTable, fakePatTable,
  fakeQueue }                                                                   from './lambda-wrapper-fakes';

const SWEEPER_ENVIRONMENT_NAMES = [
  'AUDIT_EVENTS_QUEUE_URL', 'BLOB_STORAGE_NAME', 'CHANGELOG_TABLE_NAME', 'CONFIG_TABLE_NAME', 'ITEM_TABLE_NAME',
  'JOB_STALE_AFTER', 'PAT_TABLE_NAME', 'SERVICE_NAME', 'SWEEP_INTERVAL', 'SYSTEM_SENDER_ADDRESS',
];
const ITEM_TABLE_ACTIONS        = ['dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:Query', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'];

interface FunctionProperties {
  readonly Environment: { readonly Variables: Record<string, string> };
  readonly Timeout:     number;
  readonly MemorySize:  number;
}

function arrangeSweeper(stateChangeFanout?: IStateChangeFanout) {
  const stack            = new cdk.Stack(new App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
  const itemTable        = new DataTable(new Table(stack, 'item-table', {
    partitionKey: { name: 'pk', type: AttributeType.STRING },
    sortKey:      { name: 'sk', type: AttributeType.STRING },
  }));
  const patTable         = fakePatTable('pat-table');
  const configTable      = fakeDataTable('config-table');
  const changelogTable   = fakeDataTable('changelog-table');
  const blobStore        = fakeDataBlobStore('blob-store');
  const auditEventsQueue = fakeQueue('audit-events');
  const lambda           = new JobSweeperLambda(stack, 'job-sweeper', {
    artifactResolver: new PinnedArtifactResolver({
      packages:         {
        'mailbox-cdk': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
        'mailbox-go':  { version: '1.0.0', zone: ArtifactZone.REGIONAL },
      },
      location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
      deploymentRegion: stack.region,
    }),
    itemTable,
    patTable,
    configTable,
    changelogTable,
    blobStore,
    auditEventsQueue,
    systemSenderAddress: 'noreply@example.com',
    sweepInterval:       Duration.minutes(15),
    staleAfter:          Duration.hours(2),
  });

  if (stateChangeFanout) {
    lambda.enableWebSocketPush(stateChangeFanout);
  }

  return { stack, lambda, template: Template.fromStack(stack), itemTable, patTable, configTable, changelogTable, blobStore, auditEventsQueue };
}

function sweeperProperties(template: Template): FunctionProperties {
  const sweepers = resourcesOfType<FunctionProperties>(template, 'AWS::Lambda::Function')
    .filter((properties) => 'JOB_STALE_AFTER' in properties.Environment.Variables);
  expect(sweepers).toHaveLength(1);
  return sweepers[0];
}

describe('JobSweeperLambda', () => {
  it('gives the function exactly the environment names its Go config reads, with both periods in seconds', () => {
    const { template } = arrangeSweeper();

    const variables = sweeperProperties(template).Environment.Variables;
    expect(Object.keys(variables).sort()).toEqual([...SWEEPER_ENVIRONMENT_NAMES].sort());
    expect(variables.JOB_STALE_AFTER).toBe('7200s');
    expect(variables.SWEEP_INTERVAL).toBe('900s');
  });

  it('hands the function the names of the token, config, changelog and blob resources, the audit queue and the sender', () => {
    const { template } = arrangeSweeper();

    expect(sweeperProperties(template).Environment.Variables).toMatchObject({
      PAT_TABLE_NAME:         'pat-table',
      CONFIG_TABLE_NAME:      'config-table',
      CHANGELOG_TABLE_NAME:   'changelog-table',
      BLOB_STORAGE_NAME:      'blob-store',
      AUDIT_EVENTS_QUEUE_URL: 'https://sqs.fake/audit-events',
      SYSTEM_SENDER_ADDRESS:  'noreply@example.com',
    });
  });

  it('requests the expiry notice, config read, email blob write, changelog read-write and audit send grants for itself', () => {
    const { lambda, patTable, configTable, blobStore, changelogTable, auditEventsQueue } = arrangeSweeper();

    expectGrantedOnceTo(patTable.grantPatExpiryNotify, lambda);
    expectGrantedOnceTo(configTable.grantRead, lambda);
    expectGrantedOnceTo(blobStore.grantEmailBlobWrite, lambda);
    expectGrantedOnceTo(changelogTable.grantReadWrite, lambda);
    expectGrantedOnceTo(auditEventsQueue.grantSend, lambda);
  });

  it('runs with 256 MB of memory and a 5 minute timeout', () => {
    const { template } = arrangeSweeper();

    const sweeper = sweeperProperties(template);
    expect(sweeper.MemorySize).toBe(256);
    expect(sweeper.Timeout).toBe(300);
  });

  it('grants the item table read and write with the actions the sweeper calls', () => {
    const { template, stack, itemTable } = arrangeSweeper();
    const itemTableArn: unknown          = stack.resolve(itemTable.tableArn);

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([Match.objectLike({ Action: ITEM_TABLE_ACTIONS, Resource: Match.arrayWith([itemTableArn]) })]),
      },
    });
  });

  it('enableWebSocketPush sets WEBSOCKET_BROADCAST_FUNCTION_NAME and lets the state-change fan-out grant itself invokable', () => {
    const stateChangeFanout: IStateChangeFanout = { functionName: 'fanout-function', grantInvoke: jest.fn() };

    const { lambda, template } = arrangeSweeper(stateChangeFanout);

    expect(sweeperProperties(template).Environment.Variables).toMatchObject({ WEBSOCKET_BROADCAST_FUNCTION_NAME: 'fanout-function' });
    expect(stateChangeFanout.grantInvoke).toHaveBeenCalledWith(lambda);
  });

  it('registers a schedule that invokes it every 15 minutes', () => {
    const { template } = arrangeSweeper();

    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(15 minutes)',
    });
  });
});
