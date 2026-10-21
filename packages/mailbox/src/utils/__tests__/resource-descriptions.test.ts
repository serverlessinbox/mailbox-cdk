import { ComponentDescription, ServerlessInboxTagKeys }   from '@serverlessinbox/mailbox-cdk-shared';
import { Match, Template }                                from 'aws-cdk-lib/assertions';
import * as sqs                                           from 'aws-cdk-lib/aws-sqs';
import { App, Aspects, Stack }                            from 'aws-cdk-lib';
import { Construct }                                      from 'constructs';

import { MailboxResourceDescriptions }                    from '../resource-descriptions';
import type { MailboxResourceDescriptionsOptions }        from '../resource-descriptions';

/** Synthesizes `Stack/Mailbox/ops/license-refresh` holding one queue, optionally describing the component first. */
function synthesizeQueue(
  options: MailboxResourceDescriptionsOptions = {},
  describeComponent?: (component: Construct) => void,
): Template {
  const stack     = new Stack(new App(), 'Stack');
  const mailbox   = new Construct(stack, 'Mailbox');
  const component = new Construct(new Construct(mailbox, 'ops'), 'license-refresh');
  new sqs.CfnQueue(component, 'queue');
  describeComponent?.(component);
  Aspects.of(stack).add(new MailboxResourceDescriptions('Mailbox', options));
  return Template.fromStack(stack);
}

function queueHasDescriptionTag(template: Template, value: string): void {
  template.hasResourceProperties('AWS::SQS::Queue', {
    Tags: Match.arrayWith([{ Key: ServerlessInboxTagKeys.description, Value: value }]),
  });
}

describe('MailboxResourceDescriptions', () => {
  it('describes a resource by the sentence of its described component', () => {
    const template = synthesizeQueue({}, (component) => ComponentDescription.describe(component, 'Own sentence'));

    queueHasDescriptionTag(template, 'Own sentence - queue');
  });

  it('prefers a described component over the fallbackDescription option', () => {
    const template = synthesizeQueue(
      { fallbackDescription: 'Fallback sentence' },
      (component) => ComponentDescription.describe(component, 'Own sentence'),
    );

    queueHasDescriptionTag(template, 'Own sentence - queue');
  });

  it('uses the fallbackDescription option when no component on the path is described', () => {
    queueHasDescriptionTag(synthesizeQueue({ fallbackDescription: 'Fallback sentence' }), 'Fallback sentence - queue');
  });

  it('derives a description from the group and path when nothing else applies', () => {
    queueHasDescriptionTag(synthesizeQueue(), 'ServerlessInbox ops ops/license-refresh/queue - queue');
  });
});
