/// <reference types="jest" />

/**
 * SesReceiptForwarderLambda wrapper tests.
 *
 * Pins the environment name the forwarder reads and that its role can only enqueue onto the
 * email-processor queue: it must never receive from it, since consuming is the processor's job.
 */

import { actionsOf }                                 from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { Template }                                  from 'aws-cdk-lib/assertions';

import { EmailProcessingQueue }                      from '../../queues/email-processing-queue';
import { SesReceiptForwarderLambda }                 from '../ses-receipt-forwarder-lambda';

import { arrangeWrapperStack, onlyLambdaOf }         from './lambda-wrapper-helpers';
import type { SynthesizedLambda }                    from './lambda-wrapper-helpers';

function synthesize(): { lambda: SynthesizedLambda; queueUrl: unknown } {
  const { stack, artifactResolver } = arrangeWrapperStack();
  const emailProcessorQueue         = new EmailProcessingQueue(stack, 'email-processing-queue');

  new SesReceiptForwarderLambda(stack, 'ses-receipt-forwarder', { emailProcessorQueue, artifactResolver });

  return {
    lambda:   onlyLambdaOf(Template.fromStack(stack)),
    queueUrl: stack.resolve(emailProcessorQueue.queueUrl),
  };
}

describe('SesReceiptForwarderLambda', () => {
  it('sets EMAIL_PROCESSOR_QUEUE_URL to the URL of the email-processor queue', () => {
    const { lambda, queueUrl } = synthesize();

    expect(lambda.environment.EMAIL_PROCESSOR_QUEUE_URL).toEqual(queueUrl);
  });

  it('sends to the email-processor queue and never receives from it', () => {
    const actions = synthesize().lambda.statements.flatMap(actionsOf);

    expect(actions).toContain('sqs:SendMessage');
    expect(actions).not.toContain('sqs:ReceiveMessage');
  });
});
