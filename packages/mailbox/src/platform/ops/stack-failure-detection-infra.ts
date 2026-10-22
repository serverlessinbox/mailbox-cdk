import type { IArtifactResolver }                        from '@serverlessinbox/artifact-registry-cdk';
import { PipelineLogGroup, PositionHash, StackIdentity } from '@serverlessinbox/mailbox-cdk-shared';
import * as iam                                          from 'aws-cdk-lib/aws-iam';
import * as lambda                                       from 'aws-cdk-lib/aws-lambda';
import { Fn, Aws, RemovalPolicy, CfnResource }           from 'aws-cdk-lib';
import { Construct }                                     from 'constructs';
import type { IConstruct }                               from 'constructs';

import type { IStackFailedEvent }                        from '../../resources/events/stack-failed-event';
import { StackFailureDetectorLambda }                    from '../../resources/lambdas/stack-failure-detector-lambda';

/** Inputs of the stack-failure detection resources. */
export interface StackFailureDetectionInfraProps {
  readonly artifactResolver: IArtifactResolver;
  /** AWS account IDs hosting the vendor license API. Scopes the execute-api:Invoke grant on the detector. */
  readonly vendorAccountIds: string[];
}

const DETECTOR_POLICY_NAME = 'stack-failure-detector-policy';

/**
 * The detector Lambda, its execution role and inline policy. The detector's trigger is the retained
 * stack-failed rule the Lambda creates for itself. Every resource is retained on update, on delete and
 * when its creating operation is rolled back, so the detector still exists to report that rollback.
 *
 * The role and function names are explicit: `mailbox-diag-role-<position hash>-<guid prefix>` and
 * `mailbox-diag-fn-<position hash>-<guid prefix>`. The position hash is that of this construct, so a
 * move changes both names; the guid prefix differs per install.
 * `iam:DeleteRole`/`iam:DeleteRolePolicy` don't support the `aws:ResourceTag` condition key at all
 * (verified against the IAM service reference), so the grants that delete this role are scoped to the
 * role's own ARN, taken from `role`.
 * `detectorFunctionName` stays pinned because `StackFailureDetectorLambda`'s `functionName` prop is
 * required.
 */
export class StackFailureDetectionInfra extends Construct {
  readonly detector: lambda.IFunction;
  readonly stackFailedEvent: IStackFailedEvent;
  readonly role: iam.IRole;
  readonly detectorRolePolicyName: string;

  constructor(scope: Construct, id: string, props: StackFailureDetectionInfraProps) {
    super(scope, id);

    // Differs after destroy+redeploy, keeping RETAIN'd orphans from colliding with a freshly
    // (re)created stack's resources.
    const guidPrefix = StackIdentity.guidPrefix;

    // Makes names unique per construct position, so a future move doesn't collide with the old name.
    const positionHash = PositionHash.of(this);

    const detectorFunctionName = Fn.join('', ['mailbox-diag-fn-', positionHash, '-', guidPrefix]);
    const detectorRoleName     = Fn.join('', ['mailbox-diag-role-', positionHash, '-', guidPrefix]);

    const detectorRole = new iam.Role(this, 'detector-role', {
      roleName:  detectorRoleName,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    this.retainOnEveryOperation(detectorRole, 'detector-role');

    // Reused below for the grant, so the env var and the grant ARN can never
    // come from two independent lookups.
    const infraLogGroup = PipelineLogGroup.getOrCreate(this, 'infra');

    const detector = new StackFailureDetectorLambda(this, 'detector', {
      artifactResolver:  props.artifactResolver,
      role:              detectorRole,
      functionName:      detectorFunctionName,
      infraLogGroupName: infraLogGroup.logGroupName,
    });
    this.retainOnEveryOperation(detector, 'detector');

    this.createDetectorPolicy(detectorRole, infraLogGroup.logGroupArn, props.vendorAccountIds);

    this.detector               = detector;
    this.stackFailedEvent       = detector.stackFailedEvent;
    this.role                   = detectorRole;
    this.detectorRolePolicyName = DETECTOR_POLICY_NAME;
  }

  private createDetectorPolicy(detectorRole: iam.IRole, infraLogGroupArn: string, vendorAccountIds: string[]): void {
    // The log grants live on this policy rather than on the role through grant methods, so the role
    // never gets an implicit DefaultPolicy. CreateLogStream/PutLogEvents is needed because the explicit
    // `role:` passed to the Lambda skips the AWSLambdaBasicExecutionRole attachment `Function` would add.
    const detectorPolicy = new iam.Policy(this, 'detector-policy', {
      policyName: DETECTOR_POLICY_NAME,
      statements: [
        new iam.PolicyStatement({
          actions:   ['cloudformation:DescribeStackEvents', 'cloudformation:DescribeStacks'],
          resources: [Aws.STACK_ID],
        }),
        new iam.PolicyStatement({
          actions:   ['logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: [infraLogGroupArn],
        }),
        // FilterLogEvents is for recovery and troubleshooting.
        new iam.PolicyStatement({
          actions:   ['logs:FilterLogEvents'],
          resources: [infraLogGroupArn],
        }),
        // Cross-account SigV4 calls to the vendor API need an identity-side allow in addition to its resource policy.
        new iam.PolicyStatement({
          actions:   ['execute-api:Invoke'],
          resources: vendorAccountIds.map(
            (accountId) => `arn:aws:execute-api:*:${accountId}:*/*/POST/issue-stack-failure-upload`,
          ),
        }),
      ],
    });
    detectorPolicy.attachToRole(detectorRole);
    this.retainOnEveryOperation(detectorPolicy, 'detector-policy');
  }

  /**
   * Applies RETAIN to a construct's underlying CFN resource, so it is kept on update, on delete and when
   * its creating operation is rolled back. RETAIN_ON_UPDATE_OR_DELETE is not used: CloudFormation deletes
   * those resources when a create rolls back, and the detector reports that rollback, so it must still
   * exist afterwards. Throws at synth when the construct has no CFN resource to retain.
   */
  private retainOnEveryOperation(construct: IConstruct, description: string): void {
    const defaultChild = construct.node.defaultChild;
    if (!(defaultChild instanceof CfnResource)) {
      throw new Error(
        `${description}: expected defaultChild to be a CfnResource, got ${defaultChild?.constructor?.name ?? String(defaultChild)}`,
      );
    }
    defaultChild.applyRemovalPolicy(RemovalPolicy.RETAIN);
  }
}
