/**
 * SESEventProcessing wires the SES configuration set, the notifications topic and queue, and the
 * `ses-event-processor` Lambda. These tests pin the wiring this construct owns: SES publishes to the
 * topic through the configuration set, the exposed queue is the one the Lambda consumes, and the
 * WebSocket capability reaches the Lambda. A break here silently drops bounce and complaint feedback.
 */
import { ArtifactZone, PinnedArtifactResolver }             from '@serverlessinbox/artifact-registry-cdk';
import type { IArtifactResolver }                           from '@serverlessinbox/artifact-registry-cdk';
import { Match, Template }                                  from 'aws-cdk-lib/assertions';
import { Table, AttributeType }                             from 'aws-cdk-lib/aws-dynamodb';
import { Bucket }                                           from 'aws-cdk-lib/aws-s3';
import * as cdk                                             from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }                    from 'aws-cdk-lib';

import type { IWebSocketBroadcastPublisher }                from '../../apis/websocket';
import { DataBlobStore }                                    from '../../../resources/buckets/data-blob-store';
import { DataTable }                                        from '../../../resources/tables/data-tables';
import { AuditEventsQueue }                                 from '../../../resources/queues/audit-events-queue';
import { SESEventProcessing, type SESEventProcessingProps } from '../ses-event-processing';

function createStack(): cdk.Stack {
  return new cdk.Stack(new App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

function createProps(stack: cdk.Stack): SESEventProcessingProps {
  const artifactResolver: IArtifactResolver = new PinnedArtifactResolver({
    packages:         { 'mailbox-go': { version: '1.0.0', zone: ArtifactZone.REGIONAL } },
    location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
    deploymentRegion: stack.region,
  });
  const dataTable                           = (id: string) => new DataTable(new Table(stack, id, {
    partitionKey: { name: 'pk', type: AttributeType.STRING },
  }));

  return {
    itemTable:         dataTable('item-table'),
    changelogTable:    dataTable('changelog-table'),
    mailFeedbackTable: dataTable('mail-feedback-table'),
    configTable:       dataTable('config-table'),
    blobStore:         new DataBlobStore(new Bucket(stack, 'blob-store')),
    auditEventsQueue:  new AuditEventsQueue(stack, 'audit-events-queue'),
    artifactResolver,
  };
}

describe('SESEventProcessing', () => {
  it('publishes the configuration set\'s events to the notifications topic', () => {
    const stack = createStack();
    const sut   = new SESEventProcessing(stack, 'ses-event-processing', createProps(stack));

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::SES::ConfigurationSetEventDestination', {
      ConfigurationSetName: stack.resolve(sut.sesConfigSetName),
      EventDestination:     Match.objectLike({
        Enabled:        true,
        SnsDestination: { TopicARN: stack.resolve(sut.sesEventTopic.topicArn) },
      }),
    });
  });

  it('exposes the name of the configuration set it creates', () => {
    const stack = createStack();
    const sut   = new SESEventProcessing(stack, 'ses-event-processing', createProps(stack));

    const template = Template.fromStack(stack);

    const [configSetId] = Object.keys(template.findResources('AWS::SES::ConfigurationSet'));
    expect(stack.resolve(sut.sesConfigSetName)).toEqual({ Ref: configSetId });
  });

  it('feeds the Lambda from the queue it exposes as sesEventQueue', () => {
    const stack = createStack();
    const sut   = new SESEventProcessing(stack, 'ses-event-processing', createProps(stack));

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      EventSourceArn: stack.resolve(sut.sesEventQueue.queueArn),
    });
  });

  it('enableWebSocketPublishing sets the broadcaster function name on the processor Lambda', () => {
    const stack                                     = createStack();
    const sut                                       = new SESEventProcessing(stack, 'ses-event-processing', createProps(stack));
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
