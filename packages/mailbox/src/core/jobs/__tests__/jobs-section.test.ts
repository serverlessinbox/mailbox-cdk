/// <reference types="jest" />

/**
 * JobsSection tests: the composition of the mail-import plane. The section applies the queue encryption it receives
 * to the import-jobs queue and its dead-letter queue, builds the runner and the sweeper beside the queue under their
 * own ids, wires the auth key store and queue into the runner, and holds the timing relations between queue, runner
 * and sweeper. The runner's and the sweeper's own settings are tested in their own files.
 */

import { ArtifactZone, PinnedArtifactResolver }       from '@serverlessinbox/artifact-registry-cdk';
import type { QueueEncryptionChoice }                 from '@serverlessinbox/mailbox-cdk-shared';
import { Template }                                   from 'aws-cdk-lib/assertions';
import { AttributeType, Table }                       from 'aws-cdk-lib/aws-dynamodb';
import * as kms                                       from 'aws-cdk-lib/aws-kms';
import * as cdk                                       from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }              from 'aws-cdk-lib';

import { resourcesOfType }                            from '../../../__tests__/iam-test-helpers';
import { fakeDataBlobStore, fakePatTable, fakeQueue } from '../../../resources/lambdas/__tests__/lambda-wrapper-fakes';
import { AuthKeyStoreTable }                          from '../../../resources/tables/auth-key-store-table';
import { DataTable }                                  from '../../../resources/tables/data-tables';
import { defaultCfnResource }                         from '../../../utils/cfn-resource';
import { JobsSection, type JobsSectionProps }         from '../jobs-section';

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

const AWS_MANAGED: QueueEncryptionChoice = { kind: 'aws-managed' };

function sectionProps(
  stack: cdk.Stack,
  authKeyStoreTable: AuthKeyStoreTable,
  queueEncryption: QueueEncryptionChoice = AWS_MANAGED,
): JobsSectionProps {
  return {
    queueEncryption,
    artifactResolver:    resolverFor(stack),
    data:                {
      itemTable:        dataTable(stack, 'item-table'),
      patTable:         fakePatTable('pat-table'),
      configTable:      dataTable(stack, 'config-table'),
      changelogTable:   dataTable(stack, 'changelog-table'),
      blobStore:        fakeDataBlobStore('blob-store'),
      auditEventsQueue: fakeQueue('audit-events'),
    },
    auth:                { authKeyStoreTable },
    systemSenderAddress: 'noreply@example.com',
  };
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

describe('JobsSection', () => {
  it('applies the queue encryption of the plan to the import-jobs queue and its dead-letter queue', () => {
    const stack = createStack();
    const key   = new kms.Key(stack, 'TestKey');
    new JobsSection(stack, 'jobs', sectionProps(stack, new AuthKeyStoreTable(stack, 'auth-key-store'), {
      kind: 'kms', key,
    }));

    Template.fromStack(stack).resourcePropertiesCountIs('AWS::SQS::Queue', {
      KmsMasterKeyId: { 'Fn::GetAtt': [stack.getLogicalId(defaultCfnResource(key)), 'Arn'] },
    }, 2);
  });

  it('exposes the queue and the runner through their narrow interfaces', () => {
    const stack   = createStack();
    const section = new JobsSection(stack, 'jobs', sectionProps(stack, new AuthKeyStoreTable(stack, 'auth-key-store')));

    expect(section.importJobsQueue.queueArn).toBeDefined();
    expect(section.mailImportRunner.functionName).toBeDefined();
  });

  it('keeps the queue, its dead-letter queue, the runner and the sweeper under the section by their ids', () => {
    const stack   = createStack();
    const section = new JobsSection(stack, 'jobs', sectionProps(stack, new AuthKeyStoreTable(stack, 'auth-key-store')));

    expect(section.node.tryFindChild('import-jobs-queue')).toBeDefined();
    expect(section.node.tryFindChild('import-jobs-queue-dlq')).toBeDefined();
    expect(section.node.tryFindChild('mail-import-runner')).toBeDefined();
    expect(section.node.tryFindChild('job-sweeper')).toBeDefined();
  });

  it('gives the runner the auth key store table and the import-jobs queue it was passed', () => {
    const stack = createStack();
    new JobsSection(stack, 'jobs', sectionProps(stack, new AuthKeyStoreTable(stack, 'auth-key-store')));

    const runner = functionWith(Template.fromStack(stack), 'IMPORT_MESSAGES_PER_SECOND');
    expect(runner.Environment.Variables.AUTH_KEY_STORE_TABLE_NAME).toBeDefined();
    expect(runner.Environment.Variables.IMPORT_JOBS_QUEUE_URL).toBeDefined();
  });

  it('keeps the runner inside the queue visibility timeout and the job max age beyond the redrive window', () => {
    const stack = createStack();
    new JobsSection(stack, 'jobs', sectionProps(stack, new AuthKeyStoreTable(stack, 'auth-key-store')));
    const template = Template.fromStack(stack);

    const visibilityTimeout = mainQueueProperties(template).VisibilityTimeout;
    const runnerTimeout     = functionWith(template, 'IMPORT_MESSAGES_PER_SECOND').Timeout;
    const staleAfter        = Number(functionWith(template, 'JOB_STALE_AFTER').Environment.Variables.JOB_STALE_AFTER.replace('s', ''));

    expect(visibilityTimeout).toBe(360);
    expect(runnerTimeout).toBeLessThan(visibilityTimeout ?? 0);
    expect(staleAfter).toBeGreaterThan((visibilityTimeout ?? 0) * MAX_RECEIVE_COUNT);
  });

  it('gives the sweeper the token table, the audit queue and the system sender it was passed', () => {
    const stack = createStack();
    new JobsSection(stack, 'jobs', sectionProps(stack, new AuthKeyStoreTable(stack, 'auth-key-store')));

    const sweeper = functionWith(Template.fromStack(stack), 'JOB_STALE_AFTER');
    expect(sweeper.Environment.Variables).toMatchObject({
      PAT_TABLE_NAME:         'pat-table',
      AUDIT_EVENTS_QUEUE_URL: 'https://sqs.fake/audit-events',
      SYSTEM_SENDER_ADDRESS:  'noreply@example.com',
    });
  });

  it('keeps the sweeper timeout below the sweep interval', () => {
    const stack = createStack();
    new JobsSection(stack, 'jobs', sectionProps(stack, new AuthKeyStoreTable(stack, 'auth-key-store')));
    const template = Template.fromStack(stack);

    const sweeper       = functionWith(template, 'JOB_STALE_AFTER');
    const sweepInterval = Number(sweeper.Environment.Variables.SWEEP_INTERVAL.replace('s', ''));

    expect(sweeper.Timeout).toBeLessThan(sweepInterval);
  });

  it('enables WebSocket push on the runner and the sweeper: the state-change fan-out is in their environments and each is granted the invoke', () => {
    const stack       = createStack();
    const section     = new JobsSection(stack, 'jobs', sectionProps(stack, new AuthKeyStoreTable(stack, 'auth-key-store')));
    const grantInvoke = jest.fn();

    section.enableWebSocketPublishing({ functionName: 'fanout-function', grantInvoke });

    const template = Template.fromStack(stack);
    const runner   = functionWith(template, 'IMPORT_MESSAGES_PER_SECOND');
    const sweeper  = functionWith(template, 'JOB_STALE_AFTER');
    expect(runner.Environment.Variables.WEBSOCKET_BROADCAST_FUNCTION_NAME).toBe('fanout-function');
    expect(sweeper.Environment.Variables.WEBSOCKET_BROADCAST_FUNCTION_NAME).toBe('fanout-function');
    expect(grantInvoke).toHaveBeenCalledTimes(2);
    expect(grantInvoke).toHaveBeenCalledWith(section.mailImportRunner);
  });
});
