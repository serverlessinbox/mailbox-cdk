import { TypeScriptLambda } from '../utils/ts-lambda';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface ScheduledUpdaterLambdaProps {
  artifactResolver: ICdkArtifactEngine;

  /** Dist-tag to follow ('stable', 'beta', etc.). */
  distTag: string;

  /** Literal Granularity OR a CFN-parameter token; used for the updater's env and IsTracking. Typed `string`. */
  granularity: string;

  /** Root stack name (Aws.STACK_NAME). */
  rootStackTagValue: string;
}

/**
 * Scheduled updater Lambda wrapper.
 * Runs on a schedule to scan deployed resources and advance their code within a granularity bound.
 */
export class ScheduledUpdaterLambda extends TypeScriptLambda {
  constructor(scope: Construct, id: string, props: ScheduledUpdaterLambdaProps) {
    super(scope, id, {
      lambdaId: 'scheduled-updater',
      artifactResolver: props.artifactResolver,
      packageName: 'mailbox-cdk',
      timeout: Duration.minutes(5),
      memorySize: 256,
      environment: {
        DIST_TAG: props.distTag,
        GRANULARITY: props.granularity,
        PROJECT: 'serverlessinbox',
        ROOT_STACK_TAG_VALUE: props.rootStackTagValue,
      },
    });
  }
}
