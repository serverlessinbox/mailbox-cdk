/// <reference types="jest" />

/**
 * JmapBlobDownloadLambda tests: the function, its published version and the condition the wrapper
 * renders from its props.
 *
 * The scheduled updater finds this Lambda@Edge function by its artifact tags, CloudFront serves the
 * published version, and Lambda rejects an empty `S3ObjectVersion`; loosening any of these ships a
 * function that is never updated, never replaced, or never created.
 */

import { ServerlessInboxTagKeys }            from '@serverlessinbox/mailbox-cdk-shared';
import { Match, Template }                   from 'aws-cdk-lib/assertions';
import * as iam                              from 'aws-cdk-lib/aws-iam';
import * as logs                             from 'aws-cdk-lib/aws-logs';
import * as s3                               from 'aws-cdk-lib/aws-s3';
import * as cdk                              from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }     from 'aws-cdk-lib';

import { JmapBlobDownloadLambda }            from '../jmap-blob-download-lambda';

const ROLE_ARN = 'arn:aws:iam::123456789012:role/jmap-blob-download';

function synthesizeFunction(versionId: string | undefined): Template {
  const stack = new cdk.Stack(new App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-east-1' },
    synthesizer: new BootstraplessSynthesizer(),
  });

  new JmapBlobDownloadLambda(stack, 'jmap-blob-download', {
    artifactBucket: s3.Bucket.fromBucketName(stack, 'artifact-bucket', 'test-artifacts'),
    artifact:       { bucket: 'test-artifacts', key: 'prefix/lambdas/jmap-blob-download.zip', versionId },
    role:           iam.Role.fromRoleArn(stack, 'role', ROLE_ARN, { mutable: false }),
    logGroup:       logs.LogGroup.fromLogGroupName(stack, 'log-group', 'jmap-pipeline'),
    productVersion: '1.2.3',
  });

  return Template.fromStack(stack);
}

describe('JmapBlobDownloadLambda', () => {
  it('renders the function from the resolved artifact, the given role and the given log group', () => {
    const template = synthesizeFunction('abc123');

    template.hasResourceProperties('AWS::Lambda::Function', {
      Code:          Match.objectLike({ S3Bucket: 'test-artifacts', S3Key: 'prefix/lambdas/jmap-blob-download.zip' }),
      Handler:       'index.handler',
      Runtime:       'nodejs24.x',
      MemorySize:    512,
      Description:   { 'Fn::Join': ['', ['Serverless Inbox Mailbox: jmap-blob-download Lambda@Edge (', { Ref: 'AWS::StackName' }, ')']] },
      Role:          ROLE_ARN,
      LoggingConfig: { LogGroup: 'jmap-pipeline' },
    });
  });

  it('tags the function with its artifact and the product version for the scheduled updater', () => {
    const template = synthesizeFunction('abc123');

    template.hasResourceProperties('AWS::Lambda::Function', {
      Tags: Match.arrayWith([
        { Key: ServerlessInboxTagKeys.artifactName, Value: 'jmap-blob-download' },
        { Key: ServerlessInboxTagKeys.artifactPackage, Value: 'mailbox-cdk-edge' },
        { Key: ServerlessInboxTagKeys.artifactVersion, Value: '1.2.3' },
        { Key: ServerlessInboxTagKeys.autoUpdateType, Value: 'edge' },
      ]),
    });
  });

  it('describes the published version by the artifact version, so a new artifact version publishes a new Lambda version', () => {
    const template = synthesizeFunction('abc123');

    template.hasResourceProperties('AWS::Lambda::Version', { Description: 'abc123' });
  });

  it('gives the published version an empty description when the artifact has no version', () => {
    const template = synthesizeFunction(undefined);

    template.hasResourceProperties('AWS::Lambda::Version', { Description: '' });
  });

  it('sets the code object version only under a condition that holds when the artifact has a version', () => {
    const template = synthesizeFunction('abc123');

    const [conditionName] = Object.keys(template.findConditions('*'));
    template.hasCondition(conditionName, { 'Fn::Not': [{ 'Fn::Equals': ['abc123', ''] }] });
    template.hasResourceProperties('AWS::Lambda::Function', {
      Code: Match.objectLike({ S3ObjectVersion: { 'Fn::If': [conditionName, 'abc123', { Ref: 'AWS::NoValue' }] } }),
    });
  });
});
