/// <reference types="jest" />

/**
 * AuditWriterLambda event-source wiring tests.
 *
 * Verifies the Lambda's own SQS event source mapping and consume grant against the audit-events
 * queue it owns the wiring for (grant-concept Phase 2A).
 */

import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin, IArtifactResolver }  from '@serverlessinbox/artifact-registry-cdk';
import { statementsForAction }                  from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { SqsActions }                           from '@serverlessinbox/mailbox-cdk-shared';
import { Match, Template }                      from 'aws-cdk-lib/assertions';
import { Table, AttributeType }                 from 'aws-cdk-lib/aws-dynamodb';
import * as cdk                                 from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }        from 'aws-cdk-lib';

import { AuditEventsQueue }                     from '../../queues/audit-events-queue';
import { DataTable }                            from '../../tables/data-tables';
import { AuditWriterLambda }                    from '../audit-writer-lambda';

describe('AuditWriterLambda event-source wiring', () => {
  let stack: cdk.Stack;
  let template: Template;
  let auditEventsQueue: AuditEventsQueue;

  beforeEach(() => {
    const app = new App();

    stack = new cdk.Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    const packages: Record<string, ArtifactPin> = {
      'mailbox-go': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
    };
    const artifactResolver: IArtifactResolver   = new PinnedArtifactResolver({
      packages,
      location: { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
      deploymentRegion: stack.region,
    });

    const auditLogTable = new DataTable(new Table(stack, 'audit-log-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    }));
    auditEventsQueue    = new AuditEventsQueue(stack, 'audit-events-queue');

    new AuditWriterLambda(stack, 'audit-writer', {
      auditLogTable,
      auditEventsQueue,
      artifactResolver,
    });

    template = Template.fromStack(stack);
  });

  it('instantiates exactly one queue event, sourced from the audit-events queue', () => {
    template.resourceCountIs('AWS::Lambda::EventSourceMapping', 1);

    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      EventSourceArn: stack.resolve(auditEventsQueue.queueArn),
    });
  });

  it('grants the role exactly the SqsActions.consume statement on the audit-events queue', () => {
    const consumeStatements = statementsForAction(template, 'sqs:ReceiveMessage');

    expect(consumeStatements).toHaveLength(1);
    const [statement] = consumeStatements;

    expect(statement.Effect).toBe('Allow');
    const actionMatch = Match.arrayEquals([...SqsActions.consume]).test(statement.Action);
    expect(actionMatch.hasFailed()).toBe(false);
    const resourceMatch = Match.objectEquals(stack.resolve(auditEventsQueue.queueArn)).test(statement.Resource);
    expect(resourceMatch.hasFailed()).toBe(false);
  });
});
