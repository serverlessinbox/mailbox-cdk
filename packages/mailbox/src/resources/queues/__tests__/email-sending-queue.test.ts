/**
 * EmailSendingQueue pins what it adds to a base queue: the 6 minute visibility timeout of the main queue and
 * the dead-letter queue beside it. A shorter timeout would redeliver submissions that are still being
 * processed; a dead-letter queue that is missing or kept for less than 14 days would lose the submissions that
 * failed.
 */
import { Match, Template }    from 'aws-cdk-lib/assertions';

import { defaultCfnResource } from '../../../utils/cfn-resource';
import { EmailSendingQueue }  from '../email-sending-queue';

import { createStack }        from './queue-helpers';

describe('EmailSendingQueue', () => {
  it('sets the visibility timeout to 6 minutes on the main queue, not only its dead-letter queue', () => {
    const stack = createStack();
    new EmailSendingQueue(stack, 'email-sending-queue');

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::SQS::Queue', {
      VisibilityTimeout: 360,
      RedrivePolicy:     Match.anyValue(),
    });
  });

  it('moves a message to the 14 day dead-letter queue created beside it after 5 receives', () => {
    const stack = createStack();
    new EmailSendingQueue(stack, 'email-sending-queue');

    const template = Template.fromStack(stack);
    const dlqId    = stack.getLogicalId(defaultCfnResource(stack.node.findChild('email-sending-queue-dlq')));

    template.hasResourceProperties('AWS::SQS::Queue', {
      RedrivePolicy: { deadLetterTargetArn: { 'Fn::GetAtt': [dlqId, 'Arn'] }, maxReceiveCount: 5 },
    });
    template.hasResourceProperties('AWS::SQS::Queue', {
      MessageRetentionPeriod: 14 * 24 * 60 * 60,
    });
  });
});
