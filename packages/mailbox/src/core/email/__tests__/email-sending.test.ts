/**
 * EmailSending wires the email-submissions queue to the `email-sender` Lambda. These tests pin the
 * wiring this construct owns: the exposed queue is the one the Lambda consumes, the encryption the
 * caller passes reaches that queue, and the WebSocket capability reaches the Lambda. A break here leaves
 * submissions enqueued that nothing sends, or a sender that never publishes WebSocket updates.
 */
import { ArtifactZone, PinnedArtifactResolver }    from '@serverlessinbox/artifact-registry-cdk';
import type { IArtifactResolver }                  from '@serverlessinbox/artifact-registry-cdk';
import type { QueueEncryptionChoice }              from '@serverlessinbox/mailbox-cdk-shared';
import { Match, Template }                         from 'aws-cdk-lib/assertions';
import { Table, AttributeType }                    from 'aws-cdk-lib/aws-dynamodb';
import { Bucket }                                  from 'aws-cdk-lib/aws-s3';
import * as cdk                                    from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }           from 'aws-cdk-lib';

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

const AWS_MANAGED: QueueEncryptionChoice = { kind: 'aws-managed' };

function createProps(stack: cdk.Stack, queueEncryption: QueueEncryptionChoice): EmailSendingProps {
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
    queueEncryption,
  };
}

describe('EmailSending', () => {
  it('feeds the Lambda from the queue it exposes as submissionQueue', () => {
    const stack = createStack();
    const sut   = new EmailSending(stack, 'email-sending', createProps(stack, AWS_MANAGED));

    const template                    = Template.fromStack(stack);
    const submissionQueueArn: unknown = stack.resolve(sut.submissionQueue.queueArn);

    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      EventSourceArn: submissionQueueArn,
    });
  });

  it('applies the encryption it is given to the submissions queue and its dead-letter queue', () => {
    const stack = createStack();
    new EmailSending(stack, 'email-sending', createProps(stack, { kind: 'unencrypted' }));

    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::SQS::Queue', 2);
    template.allResourcesProperties('AWS::SQS::Queue', { SqsManagedSseEnabled: false });
  });

  it('enableWebSocketPublishing sets the broadcaster function name on the sender Lambda', () => {
    const stack                                     = createStack();
    const sut                                       = new EmailSending(stack, 'email-sending', createProps(stack, AWS_MANAGED));
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
