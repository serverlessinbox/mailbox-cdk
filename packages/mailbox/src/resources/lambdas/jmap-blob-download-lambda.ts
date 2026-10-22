import type { ResolvedArtifact } from '@serverlessinbox/artifact-registry';
import type * as iam             from 'aws-cdk-lib/aws-iam';
import * as lambda               from 'aws-cdk-lib/aws-lambda';
import type * as logs            from 'aws-cdk-lib/aws-logs';
import type * as s3              from 'aws-cdk-lib/aws-s3';
import { Aws }                   from 'aws-cdk-lib';
import { Construct }             from 'constructs';

export interface JmapBlobDownloadLambdaProps {
  /** Bucket holding the artifact. */
  artifactBucket: s3.IBucket;

  /** The deployer-resolved artifact: full key (artifact prefix included) and optional S3 version ID. */
  artifact: ResolvedArtifact;

  /** Pre-created execution role; its trust and policies are configured in the root stack. */
  role: iam.IRole;

  /** Log group the function logs into, referenced by name. */
  logGroup: logs.ILogGroup;
}

/**
 * The Lambda@Edge function that serves JMAP blob downloads.
 *
 * Not a `TypeScriptLambda`: the code comes from a deployer-resolved S3 key rather than the artifact
 * resolver, and Lambda@Edge cannot carry environment variables.
 */
export class JmapBlobDownloadLambda extends lambda.Function {
  constructor(scope: Construct, id: string, props: JmapBlobDownloadLambdaProps) {
    super(scope, id, {
      runtime:     lambda.Runtime.NODEJS_24_X,
      handler:     'index.handler',
      code:        lambda.Code.fromBucket(props.artifactBucket, props.artifact.key, props.artifact.versionId),
      role:        props.role,
      memorySize:  512,
      description: `Serverless Inbox Mailbox: jmap-blob-download Lambda@Edge (${Aws.STACK_NAME})`,
      logGroup:    props.logGroup,
    });
  }
}
