/// <reference types="jest" />

/**
 * EmailProcessorLambda: its SQS event source mapping on the email-processing queue, the SQS consume statement its
 * role is granted on that queue, and the websocket push wiring it takes through enableWebSocketPush.
 */

import { statementsForAction }                  from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { Match, Template }                      from 'aws-cdk-lib/assertions';
import { Table, AttributeType }                 from 'aws-cdk-lib/aws-dynamodb';
import { Bucket }                               from 'aws-cdk-lib/aws-s3';
import type * as cdk                            from 'aws-cdk-lib';

import type { IWebSocketBroadcastPublisher }    from '../../../contracts/websocket-push';
import { DataBlobStore }                        from '../../buckets/data-blob-store';
import { EmailProcessingQueue }                 from '../../queues/email-processing-queue';
import { DataTable }                            from '../../tables/data-tables';
import { EmailProcessorLambda }                 from '../email-processor-lambda';

import { arrangeWrapperStack }                  from './lambda-wrapper-helpers';

describe('EmailProcessorLambda event-source wiring', () => {
  let stack: cdk.Stack;
  let emailProcessingQueue: EmailProcessingQueue;
  let processor: EmailProcessorLambda;

  beforeEach(() => {
    const arrangement = arrangeWrapperStack();
    stack             = arrangement.stack;

    const configTable    = new DataTable(new Table(stack, 'config-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    }));
    const itemTable      = new DataTable(new Table(stack, 'item-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    }));
    const changelogTable = new DataTable(new Table(stack, 'changelog-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    }));
    const blobStore      = new DataBlobStore(new Bucket(stack, 'blob-store'));
    emailProcessingQueue = new EmailProcessingQueue(stack, 'email-processing-queue');

    processor = new EmailProcessorLambda(stack, 'email-processor', {
      configTable,
      itemTable,
      changelogTable,
      blobStore,
      emailProcessingQueue,
      artifactResolver: arrangement.artifactResolver,
    });
  });

  it('instantiates exactly one queue event, sourced from the email-processing queue', () => {
    const template          = Template.fromStack(stack);
    const queueArn: unknown = stack.resolve(emailProcessingQueue.queueArn);
    template.resourceCountIs('AWS::Lambda::EventSourceMapping', 1);

    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      EventSourceArn: queueArn,
    });
  });

  it('grants the role exactly the SQS consume statement on the email-processing queue', () => {
    const consumeStatements = statementsForAction(Template.fromStack(stack), 'sqs:ReceiveMessage');

    expect(consumeStatements).toHaveLength(1);
    const [statement] = consumeStatements;

    expect(statement.Effect).toBe('Allow');
    const actionMatch = Match.arrayEquals(['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes']).test(statement.Action);
    expect(actionMatch.hasFailed()).toBe(false);
    const resourceMatch = Match.exact(stack.resolve(emailProcessingQueue.queueArn)).test(statement.Resource);
    expect(resourceMatch.hasFailed()).toBe(false);
  });

  it('enableWebSocketPush sets WEBSOCKET_BROADCAST_FUNCTION_NAME and lets the broadcaster grant itself invokable', () => {
    const broadcaster: IWebSocketBroadcastPublisher = { functionName: 'broadcast-fn', grantInvoke: jest.fn() };

    processor.enableWebSocketPush(broadcaster);

    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ WEBSOCKET_BROADCAST_FUNCTION_NAME: 'broadcast-fn' }) },
    });
    expect(broadcaster.grantInvoke).toHaveBeenCalledWith(processor);
  });
});
