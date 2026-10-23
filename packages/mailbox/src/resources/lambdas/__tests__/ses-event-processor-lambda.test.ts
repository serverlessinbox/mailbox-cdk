/// <reference types="jest" />

/**
 * SesEventProcessorLambda event-source wiring: its SQS event source mapping on the SES-event queue, and the SQS
 * consume statement its role is granted on that queue.
 */

import { statementsForAction }                  from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { Match, Template }                      from 'aws-cdk-lib/assertions';
import { Table, AttributeType }                 from 'aws-cdk-lib/aws-dynamodb';
import { Bucket }                               from 'aws-cdk-lib/aws-s3';
import { Topic }                                from 'aws-cdk-lib/aws-sns';
import type * as cdk                            from 'aws-cdk-lib';

import { DataBlobStore }                        from '../../buckets/data-blob-store';
import { AuditEventsQueue }                     from '../../queues/audit-events-queue';
import { SesEventQueue }                        from '../../queues/ses-event-queue';
import { DataTable }                            from '../../tables/data-tables';
import { SesEventProcessorLambda }              from '../ses-event-processor-lambda';

import { arrangeWrapperStack }                  from './lambda-wrapper-helpers';

describe('SesEventProcessorLambda event-source wiring', () => {
  let stack: cdk.Stack;
  let template: Template;
  let sesEventQueue: SesEventQueue;

  beforeEach(() => {
    const arrangement = arrangeWrapperStack();
    stack             = arrangement.stack;

    const itemTable         = new DataTable(new Table(stack, 'item-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    }));
    const changelogTable    = new DataTable(new Table(stack, 'changelog-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    }));
    const mailFeedbackTable = new DataTable(new Table(stack, 'mail-feedback-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    }));
    const configTable       = new DataTable(new Table(stack, 'config-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    }));
    const blobStore         = new DataBlobStore(new Bucket(stack, 'blob-store'));
    const auditEventsQueue  = new AuditEventsQueue(stack, 'audit-events-queue');
    const topic             = new Topic(stack, 'ses-notifications-topic');
    sesEventQueue           = new SesEventQueue(stack, 'ses-event-queue', { topic });

    new SesEventProcessorLambda(stack, 'ses-event-processor', {
      itemTable,
      changelogTable,
      mailFeedbackTable,
      configTable,
      blobStore,
      auditEventsQueue,
      sesEventQueue,
      artifactResolver: arrangement.artifactResolver,
    });

    template = Template.fromStack(stack);
  });

  it('instantiates exactly one queue event, sourced from the SES-event queue', () => {
    const queueArn: unknown = stack.resolve(sesEventQueue.queueArn);

    template.resourceCountIs('AWS::Lambda::EventSourceMapping', 1);

    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      EventSourceArn: Match.exact(queueArn),
    });
  });

  it('grants the role exactly the SQS consume statement on the SES-event queue', () => {
    const consumeStatements = statementsForAction(template, 'sqs:ReceiveMessage');

    expect(consumeStatements).toHaveLength(1);
    const [statement] = consumeStatements;

    expect(statement.Effect).toBe('Allow');
    const actionMatch = Match.arrayEquals(['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes']).test(statement.Action);
    expect(actionMatch.hasFailed()).toBe(false);
    const resourceMatch = Match.exact(stack.resolve(sesEventQueue.queueArn)).test(statement.Resource);
    expect(resourceMatch.hasFailed()).toBe(false);
  });
});
