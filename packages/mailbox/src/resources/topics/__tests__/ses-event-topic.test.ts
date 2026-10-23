/// <reference types="jest" />

/**
 * SesEventTopic: the SNS topic SES publishes its notifications to. The topic's own statements are its
 * display name and its identity as a topic resource; SES authorizes publishing through the configuration
 * set's event destination, so no grant is asserted here.
 */

import { Template }                                          from 'aws-cdk-lib/assertions';
import { App, BootstraplessSynthesizer, CfnResource, Stack } from 'aws-cdk-lib';

import { SesEventTopic }                                     from '../ses-event-topic';

function createStack(): Stack {
  return new Stack(new App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

describe('SesEventTopic', () => {
  it('defines one SNS topic with the mailbox display name', () => {
    const stack = createStack();
    new SesEventTopic(stack, 'ses-event-topic');

    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::SNS::Topic', 1);
    template.hasResourceProperties('AWS::SNS::Topic', { DisplayName: 'Mailbox SES Notifications' });
  });

  it('exposes its topic ARN as a reference to the topic resource', () => {
    const stack = createStack();
    const sut   = new SesEventTopic(stack, 'ses-event-topic');

    expect(stack.resolve(sut.topicArn)).toEqual({ Ref: stack.getLogicalId(sut.node.defaultChild as CfnResource) });
  });
});
