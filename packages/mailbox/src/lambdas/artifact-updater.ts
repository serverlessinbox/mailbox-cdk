import { TypeScriptLambda } from '@serverlessinbox/mailbox-cdk-shared';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { Duration, Lazy } from 'aws-cdk-lib';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface ArtifactUpdaterLambdaProps {
  artifactResolver: ICdkArtifactEngine;

  /** Dist-tag to follow ('stable', 'beta', etc.). */
  distTag: string;

  /** Literal Granularity OR a CFN-parameter token; used for the updater's env and IsTracking. Typed `string`. */
  granularity: string;

  /** Root stack name (Aws.STACK_NAME). */
  rootStackTagValue: string;

  /** Base name for artifact S3 buckets (e.g., 'mailbox-artifacts'). */
  artifactBucketBase: string;

  /** DynamoDB lock table for update concurrency control. */
  readonly lockTable: ITable;

  /** Set of registered package names to track for updates (captured at synth time). */
  readonly registeredPackagesSet: Set<string>;
}

/**
 * Artifact updater Lambda wrapper.
 * Handles artifact updates via three trigger paths (deploy-end CR, EventBridge schedule, admin API invoke).
 * Runs tag-scan discovery and swaps deployed artifacts out-of-band, bounded by granularity.
 */
export class ArtifactUpdaterLambda extends TypeScriptLambda {
  constructor(scope: Construct, id: string, props: ArtifactUpdaterLambdaProps) {
    super(scope, id, {
      lambdaId: 'artifact-updater',
      pipeline: 'infra',
      artifactResolver: props.artifactResolver,
      packageName: 'mailbox-cdk',
      timeout: Duration.minutes(5),
      memorySize: 256,
      environment: {
        ARTIFACT_BUCKET_BASE: props.artifactBucketBase,
        DIST_TAG: props.distTag,
        GRANULARITY: props.granularity,
        PROJECT: 'serverlessinbox',
        ROOT_STACK_TAG_VALUE: props.rootStackTagValue,
        LOCK_TABLE_NAME: props.lockTable.tableName,
        REGISTERED_PACKAGES: Lazy.string({ produce: () => JSON.stringify([...props.registeredPackagesSet]) }),
      },
    });

    // Grant permissions to read/write the lock table
    props.lockTable.grantReadWriteData(this);
  }
}
