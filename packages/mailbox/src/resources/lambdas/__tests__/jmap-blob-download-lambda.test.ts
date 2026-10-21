/// <reference types="jest" />

/**
 * JmapBlobDownloadLambda tests: the function resource the class renders from its props.
 */

import { Template }                      from 'aws-cdk-lib/assertions';
import * as iam                          from 'aws-cdk-lib/aws-iam';
import * as logs                         from 'aws-cdk-lib/aws-logs';
import * as s3                           from 'aws-cdk-lib/aws-s3';
import * as cdk                          from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';

import { JmapBlobDownloadLambda }        from '../jmap-blob-download-lambda';

const ROLE_ARN = 'arn:aws:iam::123456789012:role/jmap-blob-download';

function synthesizeFunction(versionId: string | undefined): Record<string, unknown> {
  const stack = new cdk.Stack(new App(), 'TestStack', {
    env: { account: '123456789012', region: 'us-east-1' },
    synthesizer: new BootstraplessSynthesizer(),
  });

  new JmapBlobDownloadLambda(stack, 'jmap-blob-download', {
    artifactBucket: s3.Bucket.fromBucketName(stack, 'artifact-bucket', 'test-artifacts'),
    artifact: { bucket: 'test-artifacts', key:'prefix/lambdas/jmap-blob-download.zip', versionId },
    role: iam.Role.fromRoleArn(stack, 'role', ROLE_ARN, { mutable: false }),
    logGroup: logs.LogGroup.fromLogGroupName(stack, 'log-group', 'jmap-pipeline'),
  });

  const functions = Template.fromStack(stack).findResources('AWS::Lambda::Function');
  return Object.values(functions)[0].Properties as Record<string, unknown>;
}

describe('JmapBlobDownloadLambda', () => {
  it('renders the function from the resolved artifact, the given role and the given log group', () => {
    const properties = synthesizeFunction('abc123');

    expect(properties).toEqual({
      Code: { S3Bucket: 'test-artifacts', S3Key: 'prefix/lambdas/jmap-blob-download.zip', S3ObjectVersion: 'abc123' },
      Handler: 'index.handler',
      Runtime: 'nodejs24.x',
      MemorySize: 512,
      Role: ROLE_ARN,
      Description: { 'Fn::Join': ['', ['Serverless Inbox Mailbox: jmap-blob-download Lambda@Edge (', { Ref: 'AWS::StackName' }, ')']] },
      LoggingConfig: { LogGroup: 'jmap-pipeline' },
    });
  });

  it('omits the object version when the artifact has none', () => {
    const properties = synthesizeFunction(undefined);

    expect(properties.Code).toEqual({ S3Bucket: 'test-artifacts', S3Key: 'prefix/lambdas/jmap-blob-download.zip' });
  });
});
