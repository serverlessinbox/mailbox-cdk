/// <reference types="jest" />

/**
 * AuditWriterLambda event-source wiring tests.
 *
 * Verifies the Lambda's own SQS event source mapping and consume grant against the audit-events
 * queue it owns the wiring for (grant-concept Phase 2A).
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Table, AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import { PinnedResolver, CdkArtifactEngine, SqsActions } from '@serverlessinbox/mailbox-cdk-shared';
import type { ArtifactVersionsEntry } from '@serverlessinbox/artifact-registry';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { AuditWriterLambda } from '../audit-writer';
import { AuditEventsQueue } from '../../features/audit-writing/audit-events-queue';
import { DataTable } from '../../data/data-tables';

describe('AuditWriterLambda event-source wiring', () => {
  let stack: cdk.Stack;
  let template: Template;
  let auditEventsQueue: AuditEventsQueue;

  beforeEach(() => {
    const app = new App({
      context: {
        'serverlessinbox:artifacts': {
          bucketBase: 'test-artifacts',
          packages: {
            'mailbox-go': { kind: 'release', version: '1.0.0' },
          },
        },
      },
    });

    stack = new cdk.Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    const packages: Record<string, ArtifactVersionsEntry> = {
      'mailbox-go': { version: '1.0.0', zone: 'regional' },
    };
    const pinnedResolver = new PinnedResolver(stack, packages, 'test-artifacts', {});
    pinnedResolver.registerPackages(['mailbox-go']);
    const artifactResolver: ICdkArtifactEngine = new CdkArtifactEngine(stack, pinnedResolver);

    const auditLogTable = new DataTable(new Table(stack, 'audit-log-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    }));
    auditEventsQueue = new AuditEventsQueue(stack, 'audit-events-queue');

    new AuditWriterLambda(stack, 'audit-writer', {
      auditLogTable,
      auditEventsQueue,
      artifactResolver,
    });

    template = Template.fromStack(stack);
  });

  it('creates exactly one event source mapping sourced from the audit-events queue with the unit\'s own batch settings', () => {
    template.resourceCountIs('AWS::Lambda::EventSourceMapping', 1);

    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      EventSourceArn: stack.resolve(auditEventsQueue.queueArn),
      BatchSize: 100,
      MaximumBatchingWindowInSeconds: 30,
      FunctionResponseTypes: Match.arrayEquals(['ReportBatchItemFailures']),
    });
  });

  it('grants the role exactly the SqsActions.consume statement on the audit-events queue', () => {
    const policies = template.findResources('AWS::IAM::Policy');

    const consumeStatements = Object.values(policies).flatMap((policy) => {
      const statements = policy.Properties?.PolicyDocument?.Statement ?? [];
      return statements.filter((statement: { Action?: unknown }) => {
        const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
        return actions.includes('sqs:ReceiveMessage');
      });
    });

    expect(consumeStatements).toHaveLength(1);
    const [statement] = consumeStatements;

    expect(statement.Effect).toBe('Allow');
    const actionMatch = Match.arrayEquals([...SqsActions.consume]).test(statement.Action);
    expect(actionMatch.hasFailed()).toBe(false);
    const resourceMatch = Match.objectEquals(stack.resolve(auditEventsQueue.queueArn)).test(statement.Resource);
    expect(resourceMatch.hasFailed()).toBe(false);
  });
});
