/// <reference types="jest" />

/**
 * EmailSenderLambda IAM scoping and queue wiring: ses:SendRawEmail is scoped to the identity and configuration-set
 * ARNs with no condition, and the Lambda's SQS event source mapping and consume grant on the submissions queue.
 */

import { resourcesOf, statementsForAction }     from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { Match, Template }                      from 'aws-cdk-lib/assertions';
import { Table, AttributeType }                 from 'aws-cdk-lib/aws-dynamodb';
import { Bucket }                               from 'aws-cdk-lib/aws-s3';
import type * as cdk                            from 'aws-cdk-lib';

import { DataBlobStore }                        from '../../buckets/data-blob-store';
import { EmailSendingQueue }                    from '../../queues/email-sending-queue';
import { DataTable }                            from '../../tables/data-tables';
import { EmailSenderLambda }                    from '../email-sender-lambda';

import { arrangeWrapperStack }                  from './lambda-wrapper-helpers';

describe('EmailSenderLambda IAM scoping', () => {
  let stack: cdk.Stack;
  let template: Template;
  let submissionQueue: EmailSendingQueue;

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
    submissionQueue      = new EmailSendingQueue(stack, 'email-submissions-queue');

    new EmailSenderLambda(stack, 'email-sender', {
      configTable,
      itemTable,
      changelogTable,
      blobStore,
      sesConfigSetName: 'test-config-set',
      submissionQueue,
      artifactResolver: arrangement.artifactResolver,
    });

    template = Template.fromStack(stack);
  });

  it('scopes ses:SendRawEmail to identity and configuration-set ARNs without condition', () => {
    const sendRawEmailStatements = statementsForAction(template, 'ses:SendRawEmail');
    expect(sendRawEmailStatements).toHaveLength(1);
    const [statement] = sendRawEmailStatements;

    expect(statement.Condition).toBeUndefined();
    expect(Array.isArray(statement.Resource)).toBe(true);
    expect(statement.Resource).toHaveLength(2);

    const [identityArn, configSetArn] = resourcesOf(statement);

    expect(JSON.stringify(identityArn)).toContain('AWS::Partition');
    expect(JSON.stringify(identityArn)).toContain('AWS::Region');
    expect(JSON.stringify(identityArn)).toContain('AWS::AccountId');
    expect(JSON.stringify(identityArn)).toContain('identity/*');

    expect(JSON.stringify(configSetArn)).toContain('AWS::Partition');
    expect(JSON.stringify(configSetArn)).toContain('AWS::Region');
    expect(JSON.stringify(configSetArn)).toContain('AWS::AccountId');
    expect(JSON.stringify(configSetArn)).toContain('test-config-set');
  });

  it('instantiates exactly one queue event, sourced from the email-submissions queue', () => {
    const queueArn: unknown = stack.resolve(submissionQueue.queueArn);
    template.resourceCountIs('AWS::Lambda::EventSourceMapping', 1);

    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      EventSourceArn: queueArn,
    });
  });

  it('grants the role exactly the SQS consume statement on the email-submissions queue', () => {
    const consumeStatements = statementsForAction(template, 'sqs:ReceiveMessage');

    expect(consumeStatements).toHaveLength(1);
    const [statement] = consumeStatements;

    expect(statement.Effect).toBe('Allow');
    const actionMatch = Match.arrayEquals(['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes']).test(statement.Action);
    expect(actionMatch.hasFailed()).toBe(false);
    const resourceMatch = Match.exact(stack.resolve(submissionQueue.queueArn)).test(statement.Resource);
    expect(resourceMatch.hasFailed()).toBe(false);
  });
});
