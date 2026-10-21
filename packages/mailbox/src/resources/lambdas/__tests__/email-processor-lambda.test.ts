/// <reference types="jest" />

/**
 * EmailProcessorLambda event-source wiring tests.
 *
 * Verifies the Lambda's own SQS event source mapping and consume grant against the
 * email-processing queue it owns the wiring for (grant-concept Phase 2A).
 */

import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin, IArtifactResolver }  from '@serverlessinbox/artifact-registry-cdk';
import { statementsForAction }                  from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { SqsActions }                           from '@serverlessinbox/mailbox-cdk-shared';
import { Match, Template }                      from 'aws-cdk-lib/assertions';
import { Table, AttributeType }                 from 'aws-cdk-lib/aws-dynamodb';
import { Bucket }                               from 'aws-cdk-lib/aws-s3';
import * as cdk                                 from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }        from 'aws-cdk-lib';

import { DataBlobStore }                        from '../../../data/data-blob-store';
import { DataTable }                            from '../../tables/data-tables';
import { EmailProcessingQueue }                 from '../../../email/receiving/email-processing-queue';
import { EmailProcessorLambda }                 from '../email-processor-lambda';

describe('EmailProcessorLambda event-source wiring', () => {
  let stack: cdk.Stack;
  let template: Template;
  let emailProcessingQueue: EmailProcessingQueue;

  beforeEach(() => {
    const app = new App();

    stack = new cdk.Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    const packages: Record<string, ArtifactPin> = {
      'mailbox-go': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
    };
    const artifactResolver: IArtifactResolver   = new PinnedArtifactResolver({
      packages,
      location: { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
      deploymentRegion: stack.region,
    });

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

    new EmailProcessorLambda(stack, 'email-processor', {
      configTable,
      itemTable,
      changelogTable,
      blobStore,
      emailProcessingQueue,
      artifactResolver,
    });

    template = Template.fromStack(stack);
  });

  it('creates exactly one event source mapping sourced from the email-processing queue with the unit\'s own batch settings', () => {
    template.resourceCountIs('AWS::Lambda::EventSourceMapping', 1);

    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      EventSourceArn: stack.resolve(emailProcessingQueue.queueArn),
      BatchSize: 10,
      FunctionResponseTypes: Match.arrayEquals(['ReportBatchItemFailures']),
      MaximumBatchingWindowInSeconds: 15,
    });
  });

  it('grants the role exactly the SqsActions.consume statement on the email-processing queue', () => {
    const consumeStatements = statementsForAction(template, 'sqs:ReceiveMessage');

    expect(consumeStatements).toHaveLength(1);
    const [statement] = consumeStatements;

    expect(statement.Effect).toBe('Allow');
    const actionMatch = Match.arrayEquals([...SqsActions.consume]).test(statement.Action);
    expect(actionMatch.hasFailed()).toBe(false);
    const resourceMatch = Match.objectEquals(stack.resolve(emailProcessingQueue.queueArn)).test(statement.Resource);
    expect(resourceMatch.hasFailed()).toBe(false);
  });
});
