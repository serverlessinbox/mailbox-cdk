import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { IRole } from 'aws-cdk-lib/aws-iam';
import { GoLambda } from '../utils/go-lambda';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';

export interface StackFailureDetectorLambdaProps {
  /** Artifact resolver (engine) for Lambda code resolution. */
  readonly artifactResolver: ICdkArtifactEngine;
  /** Pre-created, deterministically-named execution role (see stack-failure-detection-infra.ts for why). */
  readonly role: IRole;
  /** Deterministic, GUID-suffixed function name (see stack-failure-detection-infra.ts for why). */
  readonly functionName: string;
}

/**
 * Stack-failure detector Lambda.
 *
 * Invoked by the retained EventBridge rule on a root-stack `CloudFormation Stack Status Change` event
 * matching one of the five terminal failure statuses. The matched event already is the terminal
 * state, so no `DescribeStacks` re-confirmation is needed. Collects `DescribeStackEvents` plus the
 * shared `infra` log group, and (when consent is enabled) SigV4-uploads the raw payload to the
 * vendor.
 *
 * This Lambda has no knowledge of, and no permissions on, the resource sweeper: it is just another
 * Lambda in the stack. Its own rule/function/role are retained so they survive stack deletion (see
 * `stack-failure-detection-infra.ts`), and are registered as sweep targets on the shared sweeper by the
 * composing stack (`mailbox.ts`) at synth time — a one-way reference from the sweeper's side only.
 */
export class StackFailureDetectorLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: StackFailureDetectorLambdaProps) {
    super(scope, id, {
      lambdaId: 'stack-failure-detector',
      pipeline: 'infra',
      artifactResolver: props.artifactResolver,
      role: props.role,
      functionName: props.functionName,
      timeout: Duration.minutes(2),
      memorySize: 256,
    });
  }
}
