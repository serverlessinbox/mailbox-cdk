/**
 * EmailSending wires the email-submissions queue to the `email-sender` Lambda. These tests pin the
 * wiring this construct owns: the exposed queue is the one the Lambda consumes, the caller's queue
 * props reach that queue, and the WebSocket capability reaches the Lambda. A break here leaves
 * submissions enqueued that nothing sends, or a sender that never publishes WebSocket updates.
 */
import { ArtifactZone, PinnedArtifactResolver }    from '@serverlessinbox/artifact-registry-cdk';
import type { IArtifactResolver }                  from '@serverlessinbox/artifact-registry-cdk';
import { Match, Template }                         from 'aws-cdk-lib/assertions';
import { Table, AttributeType }                    from 'aws-cdk-lib/aws-dynamodb';
import { Bucket }                                  from 'aws-cdk-lib/aws-s3';
import * as cdk                                    from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer, Duration } from 'aws-cdk-lib';

import type { IWebSocketBroadcastPublisher }       from '../../../contracts/websocket-push';
import { DataBlobStore }                           from '../../../resources/buckets/data-blob-store';
import { DataTable }                               from '../../../resources/tables/data-tables';
import { EmailSending, type EmailSendingProps }    from '../email-sending';

function createStack(): cdk.Stack {
  return new cdk.Stack(new App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

function createProps(stack: cdk.Stack, queueProps?: EmailSendingProps['queueProps']): EmailSendingProps {
  const artifactResolver: IArtifactResolver = new PinnedArtifactResolver({
    packages:         { 'mailbox-go': { version: '1.0.0', zone: ArtifactZone.REGIONAL } },
    location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
    deploymentRegion: stack.region,
  });
  const dataTable                           = (id: string) => new DataTable(new Table(stack, id, {
    partitionKey: { name: 'pk', type: AttributeType.STRING },
  }));

  return {
    configTable:    dataTable('config-table'),
    itemTable:      dataTable('item-table'),
    changelogTable: dataTable('changelog-table'),
    blobStore:      new DataBlobStore(new Bucket(stack, 'blob-store')),
    artifactResolver,
    sesConfigSetName: 'test-config-set',
    queueProps,
  };
}

describe('EmailSending', () => {
  it('feeds the Lambda from the queue it exposes as submissionQueue', () => {
    const stack = createStack();
    const sut   = new EmailSending(stack, 'email-sending', createProps(stack));

    const template                    = Template.fromStack(stack);
    const submissionQueueArn: unknown = stack.resolve(sut.submissionQueue.queueArn);

    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      EventSourceArn: submissionQueueArn,
    });
  });

  it('applies the caller\'s queue props to the submissions queue', () => {
    const stack = createStack();
    new EmailSending(stack, 'email-sending', createProps(stack, { retentionPeriod: Duration.days(3) }));

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::SQS::Queue', {
      MessageRetentionPeriod: 259200,
      VisibilityTimeout:      360,
    });
  });

  it('enableWebSocketPublishing sets the broadcaster function name on the sender Lambda', () => {
    const stack                                     = createStack();
    const sut                                       = new EmailSending(stack, 'email-sending', createProps(stack));
    const broadcaster: IWebSocketBroadcastPublisher = {
      functionName: 'broadcaster-function',
      grantInvoke:  () => undefined,
    };

    sut.enableWebSocketPublishing(broadcaster);

    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::Lambda::Function', 1);
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({ WEBSOCKET_BROADCAST_FUNCTION_NAME: 'broadcaster-function' }),
      },
    });
  });
});
