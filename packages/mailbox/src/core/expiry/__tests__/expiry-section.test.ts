/// <reference types="jest" />

/**
 * ExpirySection tests: the composition of the expiry plane. The section builds the expiry sweeper under its own id,
 * gives it the tables, queue and sender it is passed, grants its role the config table indexes, hands it the
 * state-change fan-out, and holds the timing relation between its stale-job window and the import queue's redrive
 * window. The sweeper's own environment and grants are tested in its wrapper's file.
 */

import { ArtifactZone, PinnedArtifactResolver }       from '@serverlessinbox/artifact-registry-cdk';
import { Match, Template }                            from 'aws-cdk-lib/assertions';
import { AttributeType, Table }                       from 'aws-cdk-lib/aws-dynamodb';
import * as cdk                                       from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }              from 'aws-cdk-lib';

import { resourcesOfType }                            from '../../../__tests__/iam-test-helpers';
import { fakeDataBlobStore, fakePatTable, fakeQueue } from '../../../resources/lambdas/__tests__/lambda-wrapper-fakes';
import { ImportJobsQueue }                            from '../../../resources/queues/import-jobs-queue';
import { DataTable }                                  from '../../../resources/tables/data-tables';
import { ExpirySection }                              from '../expiry-section';

const MAX_RECEIVE_COUNT = 3;

interface FunctionProperties {
  readonly Environment: { readonly Variables: Record<string, string> };
  readonly Timeout:     number;
}

interface QueueProperties {
  readonly VisibilityTimeout?: number;
  readonly RedrivePolicy?:     unknown;
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

/** A stack holding an expiry section, with the config table returned so the test can name its ARNs. */
function arrangeSection(): { stack: cdk.Stack; section: ExpirySection; configTable: DataTable } {
  const stack       = createStack();
  const configTable = dataTable(stack, 'config-table');
  const section     = new ExpirySection(stack, 'expiry', {
    artifactResolver:    resolverFor(stack),
    data:                {
      itemTable: dataTable(stack, 'item-table'),
      patTable:  fakePatTable('pat-table'),
      configTable,
      changelogTable:   dataTable(stack, 'changelog-table'),
      blobStore:        fakeDataBlobStore('blob-store'),
      auditEventsQueue: fakeQueue('audit-events'),
    },
    systemSenderAddress: 'noreply@example.com',
  });
  return { stack, section, configTable };
}

/** The one Lambda function whose environment carries `marker`, read from the template. */
function functionWith(template: Template, marker: string): FunctionProperties {
  const functions = resourcesOfType<FunctionProperties>(template, 'AWS::Lambda::Function')
    .filter((properties) => marker in properties.Environment.Variables);
  expect(functions).toHaveLength(1);
  return functions[0];
}

/** The queue that carries a redrive policy: the import-jobs queue, as opposed to its dead-letter queue. */
function mainQueueProperties(template: Template): QueueProperties {
  const queues = resourcesOfType<QueueProperties>(template, 'AWS::SQS::Queue')
    .filter((properties) => properties.RedrivePolicy !== undefined);
  expect(queues).toHaveLength(1);
  return queues[0];
}

describe('ExpirySection', () => {
  it('keeps the expiry sweeper under the section by its id', () => {
    const { section } = arrangeSection();

    expect(section.node.tryFindChild('expiry-sweeper')).toBeDefined();
  });

  it('gives the sweeper the token table, the audit queue and the system sender it was passed', () => {
    const { stack } = arrangeSection();

    const sweeper = functionWith(Template.fromStack(stack), 'JOB_STALE_AFTER');
    expect(sweeper.Environment.Variables).toMatchObject({
      PAT_TABLE_NAME:         'pat-table',
      AUDIT_EVENTS_QUEUE_URL: 'https://sqs.fake/audit-events',
      SYSTEM_SENDER_ADDRESS:  'noreply@example.com',
    });
  });

  it('keeps the sweeper timeout below the sweep interval', () => {
    const { stack } = arrangeSection();
    const template  = Template.fromStack(stack);

    const sweeper       = functionWith(template, 'JOB_STALE_AFTER');
    const sweepInterval = Number(sweeper.Environment.Variables.SWEEP_INTERVAL.replace('s', ''));

    expect(sweeper.Timeout).toBeLessThan(sweepInterval);
  });

  it('keeps the sweeper job max age beyond the import queue redrive window', () => {
    const { stack } = arrangeSection();
    new ImportJobsQueue(stack, 'import-jobs-queue', { encryption: { kind: 'aws-managed' } });
    const template = Template.fromStack(stack);

    const visibilityTimeout = mainQueueProperties(template).VisibilityTimeout;
    const staleAfter        = Number(functionWith(template, 'JOB_STALE_AFTER').Environment.Variables.JOB_STALE_AFTER.replace('s', ''));

    expect(visibilityTimeout).toBe(360);
    expect(staleAfter).toBeGreaterThan((visibilityTimeout ?? 0) * MAX_RECEIVE_COUNT);
  });

  it('gives the sweeper role Query on the config table and its indexes', () => {
    const { stack, configTable }  = arrangeSection();
    const configTableArn: unknown = stack.resolve(configTable.tableArn);
    const configIndexArn: unknown = stack.resolve(`${configTable.tableArn}/index/*`);

    Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
      Roles:          [{ Ref: Match.stringLikeRegexp('^expiryexpirysweeperServiceRole') }],
      PolicyDocument: {
        Statement: Match.arrayWith([Match.objectLike({
          Action:   Match.arrayWith(['dynamodb:Query']),
          Resource: [configTableArn, configIndexArn],
        })]),
      },
    });
  });

  it('enables WebSocket push on the sweeper: the state-change fan-out is in its environment and the sweeper is granted the invoke', () => {
    const { stack, section } = arrangeSection();
    const grantInvoke        = jest.fn();

    section.enableStateChangeFanout({ functionName: 'fanout-function', grantInvoke });

    const sweeper = functionWith(Template.fromStack(stack), 'JOB_STALE_AFTER');
    expect(sweeper.Environment.Variables.WEBSOCKET_BROADCAST_FUNCTION_NAME).toBe('fanout-function');
    expect(grantInvoke).toHaveBeenCalledTimes(1);
  });
});
