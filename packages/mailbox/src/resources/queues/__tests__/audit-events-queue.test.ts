/**
 * AuditEventsQueue pins what it adds to a base queue: the 5 minute visibility timeout of the main queue and
 * the dead-letter queue beside it. A shorter timeout would redeliver audit events that are still being
 * written; a dead-letter queue that is missing or kept for less than 14 days would lose the events that failed.
 */
import { Match, Template }               from 'aws-cdk-lib/assertions';
import * as cdk                          from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';

import { AuditEventsQueue }              from '../audit-events-queue';

function createStack(): cdk.Stack {
  const app = new App();
  return new cdk.Stack(app, 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

describe('AuditEventsQueue', () => {
  it('sets the visibility timeout to 5 minutes on the main queue, not only its dead-letter queue', () => {
    const stack = createStack();
    new AuditEventsQueue(stack, 'audit-events-queue');

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::SQS::Queue', {
      VisibilityTimeout: 300,
      RedrivePolicy:     Match.anyValue(),
    });
  });

  it('moves a message to the 14 day dead-letter queue created beside it after 5 receives', () => {
    const stack = createStack();
    new AuditEventsQueue(stack, 'audit-events-queue');

    const template = Template.fromStack(stack);
    const dlqId    = stack.getLogicalId(stack.node.findChild('audit-events-queue-dlq').node.defaultChild as cdk.CfnResource);

    template.hasResourceProperties('AWS::SQS::Queue', {
      RedrivePolicy: { deadLetterTargetArn: { 'Fn::GetAtt': [dlqId, 'Arn'] }, maxReceiveCount: 5 },
    });
    template.hasResourceProperties('AWS::SQS::Queue', {
      MessageRetentionPeriod: 14 * 24 * 60 * 60,
    });
  });
});
