/// <reference types="jest" />

/**
 * SesRules tests: the receipt rule that stores each email in S3 and then notifies the forwarder.
 *
 * Pins the rule's actions and their order (store first, so the MIME is safe before anything else
 * runs), that the forwarder is invoked asynchronously (a synchronous invocation lets a transient
 * forwarder failure bounce the email), and the TLS and scan settings. Changing the order or the
 * invocation type stays green in tsc and synth and only shows up as lost or bounced mail.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { SesRules } from '../ses-rules';

describe('SesRules', () => {
  let stack: cdk.Stack;
  let blobStore: Bucket;
  let sut: SesRules;

  beforeEach(() => {
    stack = new cdk.Stack(new App(), 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
    blobStore = new Bucket(stack, 'blob-store');

    sut = new SesRules(stack, 'ses-rules', {
      delivery: {
        blobStore,
        bucketPrefix: 'incoming-emails/',
        artifactResolver: new PinnedArtifactResolver({
          packages: { 'mailbox-go': { version: '1.0.0', zone: ArtifactZone.REGIONAL } },
          location: { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
          deploymentRegion: stack.region,
        }),
      },
    });
  });

  it('stores the email in S3 first, then invokes the forwarder asynchronously', () => {
    Template.fromStack(stack).hasResourceProperties('AWS::SES::ReceiptRule', {
      Rule: Match.objectLike({
        Actions: [
          { S3Action: { BucketName: { Ref: stack.getLogicalId(blobStore.node.defaultChild as cdk.CfnResource) }, ObjectKeyPrefix: 'incoming-emails/' } },
          { LambdaAction: { FunctionArn: Match.anyValue(), InvocationType: 'Event' } },
        ],
      }),
    });
  });

  it('is enabled, requires TLS and scans for spam and viruses', () => {
    Template.fromStack(stack).hasResourceProperties('AWS::SES::ReceiptRule', {
      Rule: Match.objectLike({ Enabled: true, TlsPolicy: 'Require', ScanEnabled: true }),
    });
  });

  it('puts the rule in the rule set it publishes by name', () => {
    const template = Template.fromStack(stack);
    const ruleSetId = Object.keys(template.findResources('AWS::SES::ReceiptRuleSet'))[0];

    expect(stack.resolve(sut.ruleSetName)).toEqual({ Ref: ruleSetId });
    template.hasResourceProperties('AWS::SES::ReceiptRule', { RuleSetName: { Ref: ruleSetId } });
  });

  it('hands out the ARN of an SQS queue as its email-processing queue', () => {
    const queueIds = Object.keys(Template.fromStack(stack).findResources('AWS::SQS::Queue'));

    expect(queueIds.map((id) => ({ 'Fn::GetAtt': [id, 'Arn'] }))).toContainEqual(stack.resolve(sut.emailProcessingQueue.queueArn));
  });
});
