/// <reference types="jest" />

/**
 * EmailSenderLambda IAM Scoping Tests
 *
 * Verifies:
 * - ses:SendRawEmail is scoped to specific SES resource ARNs (email identities and configuration set),
 *   rather than granted on an unconditioned wildcard resource.
 * - The Lambda's own SQS event source mapping and consume grant against the email-submissions
 *   queue it owns the wiring for (grant-concept Phase 2A).
 */

import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin, IArtifactResolver }  from '@serverlessinbox/artifact-registry-cdk';
import { resourcesOf, statementsForAction }     from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { SqsActions }                           from '@serverlessinbox/mailbox-cdk-shared';
import { Match, Template }                      from 'aws-cdk-lib/assertions';
import { Table, AttributeType }                 from 'aws-cdk-lib/aws-dynamodb';
import { Bucket }                               from 'aws-cdk-lib/aws-s3';
import * as cdk                                 from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }        from 'aws-cdk-lib';

import { DataBlobStore }                        from '../../buckets/data-blob-store';
import { EmailSendingQueue }                    from '../../queues/email-sending-queue';
import { DataTable }                            from '../../tables/data-tables';
import { EmailSenderLambda }                    from '../email-sender-lambda';

describe('EmailSenderLambda IAM scoping', () => {
  let app: App;
  let stack: cdk.Stack;
  let artifactResolver: IArtifactResolver;
  let submissionQueue: EmailSendingQueue;

  beforeEach(() => {
    app = new App();

    stack = new cdk.Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    const packages: Record<string, ArtifactPin> = {
      'mailbox-go': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
    };
    artifactResolver                            = new PinnedArtifactResolver({
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
    submissionQueue      = new EmailSendingQueue(stack, 'email-submissions-queue');

    new EmailSenderLambda(stack, 'email-sender', {
      configTable,
      itemTable,
      changelogTable,
      blobStore,
      sesConfigSetName: 'test-config-set',
      submissionQueue,
      artifactResolver,
    });
  });

  it('scopes ses:SendRawEmail to identity and configuration-set ARNs without condition', () => {
    const template = Template.fromStack(stack);

    // Find the statement that grants ses:SendRawEmail
    const sendRawEmailStatements = statementsForAction(template, 'ses:SendRawEmail');
    for (const statement of sendRawEmailStatements) {
      // Verify there is no Condition block
      expect(statement.Condition).toBeUndefined();

      // Verify the resources are an array with two elements
      expect(Array.isArray(statement.Resource)).toBe(true);
      expect(statement.Resource).toHaveLength(2);

      // Verify both resources are properly formed with account/region tokens
      const [identityArn, configSetArn] = resourcesOf(statement);

      // Check identity ARN contains the partition and region tokens
      expect(JSON.stringify(identityArn)).toContain('AWS::Partition');
      expect(JSON.stringify(identityArn)).toContain('AWS::Region');
      expect(JSON.stringify(identityArn)).toContain('AWS::AccountId');
      expect(JSON.stringify(identityArn)).toContain('identity/*');

      // Check config-set ARN contains the partition, region, and config-set name
      expect(JSON.stringify(configSetArn)).toContain('AWS::Partition');
      expect(JSON.stringify(configSetArn)).toContain('AWS::Region');
      expect(JSON.stringify(configSetArn)).toContain('AWS::AccountId');
      expect(JSON.stringify(configSetArn)).toContain('test-config-set');
    }

    expect(sendRawEmailStatements.length).toBeGreaterThan(0);
  });

  it('does not grant ses:SendRawEmail on wildcard resources', () => {
    const template = Template.fromStack(stack);
    for (const statement of statementsForAction(template, 'ses:SendRawEmail')) {
      // Ensure resources are not a bare wildcard
      expect(statement.Resource).not.toEqual('*');
      // Resources should be an array of specific ARNs
      expect(Array.isArray(statement.Resource)).toBe(true);
      expect(resourcesOf(statement).length).toBeGreaterThan(0);
    }
  });

  it('instantiates exactly one queue event, sourced from the email-submissions queue', () => {
    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::Lambda::EventSourceMapping', 1);

    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      EventSourceArn: stack.resolve(submissionQueue.queueArn),
    });
  });

  it('grants the role exactly the SqsActions.consume statement on the email-submissions queue', () => {
    const template          = Template.fromStack(stack);
    const consumeStatements = statementsForAction(template, 'sqs:ReceiveMessage');

    expect(consumeStatements).toHaveLength(1);
    const [statement] = consumeStatements;

    expect(statement.Effect).toBe('Allow');
    const actionMatch = Match.arrayEquals([...SqsActions.consume]).test(statement.Action);
    expect(actionMatch.hasFailed()).toBe(false);
    const resourceMatch = Match.objectEquals(stack.resolve(submissionQueue.queueArn)).test(statement.Resource);
    expect(resourceMatch.hasFailed()).toBe(false);
  });
});
