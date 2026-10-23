import type { ResolvedArtifact } from '@serverlessinbox/artifact-registry';
import { applyArtifactTags }     from '@serverlessinbox/mailbox-cdk-shared';
import type * as iam             from 'aws-cdk-lib/aws-iam';
import * as lambda               from 'aws-cdk-lib/aws-lambda';
import type * as logs            from 'aws-cdk-lib/aws-logs';
import type * as s3              from 'aws-cdk-lib/aws-s3';
import { Aws, CfnCondition, Fn } from 'aws-cdk-lib';
import { Construct }             from 'constructs';

import { defaultCfnResource }    from '../../utils/cfn-resource';

/**
 * The artifact bucket and resolved artifact the Lambda@Edge code is loaded from, its pre-created
 * execution role and log group, and the product version it reports. The edge stack does not create
 * the role or the log group; it only references them.
 */
export interface JmapBlobDownloadLambdaProps {
  /** Bucket holding the artifact. */
  readonly artifactBucket: s3.IBucket;

  /** The deployer-resolved artifact: full key (artifact prefix included) and optional S3 version ID. */
  readonly artifact: ResolvedArtifact;

  /** Pre-created execution role; its trust and policies are configured in the root stack. */
  readonly role: iam.IRole;

  /** Log group the function logs into, referenced by name. */
  readonly logGroup: logs.ILogGroup;

  /** Product version the scheduled updater tracks this function by. */
  readonly productVersion: string;
}

/**
 * The Lambda@Edge function that serves JMAP blob downloads. It tags itself for the scheduled
 * updater, and it keeps its published version and its code object version in step with the
 * resolved artifact.
 *
 * Not a `TypeScriptLambda`: the code comes from a deployer-resolved S3 key rather than the artifact
 * resolver, and Lambda@Edge cannot carry environment variables.
 */
export class JmapBlobDownloadLambda extends lambda.Function {
  /** The artifact package that holds this function's code and the edge stack template. */
  public static readonly ARTIFACT_PACKAGE = 'mailbox-cdk-edge';
  /** The artifact name of this function inside {@link JmapBlobDownloadLambda.ARTIFACT_PACKAGE}. */
  public static readonly ARTIFACT_NAME = 'jmap-blob-download';

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

    applyArtifactTags(this, JmapBlobDownloadLambda.ARTIFACT_PACKAGE, JmapBlobDownloadLambda.ARTIFACT_NAME, props.productVersion, 'edge');

    this.describeVersionByArtifactVersion(props.artifact);
    this.omitCodeObjectVersionWhenEmpty(scope, props.artifact);
  }

  /** A new artifact version replaces the published Lambda version; without this CloudFormation updates `$LATEST` and the immutable version stays. */
  private describeVersionByArtifactVersion(artifact: ResolvedArtifact): void {
    defaultCfnResource(this.currentVersion).addPropertyOverride('Description', artifact.versionId ?? '');
  }

  /** Lambda rejects an empty `S3ObjectVersion`, so the property must be absent, not empty, when the artifact has no version. */
  private omitCodeObjectVersionWhenEmpty(scope: Construct, artifact: ResolvedArtifact): void {
    const hasArtifactVersion = new CfnCondition(scope, 'has-jmap-blob-download-version', {
      expression: Fn.conditionNot(Fn.conditionEquals(artifact.versionId ?? '', '')),
    });

    defaultCfnResource(this).addPropertyOverride(
      'Code.S3ObjectVersion',
      Fn.conditionIf(hasArtifactVersion.logicalId, artifact.versionId ?? '', Aws.NO_VALUE),
    );
  }
}
