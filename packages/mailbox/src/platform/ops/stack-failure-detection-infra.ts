import type { IArtifactResolver }                        from '@serverlessinbox/artifact-registry-cdk';
import { PipelineLogGroup, PositionHash, StackIdentity } from '@serverlessinbox/mailbox-cdk-shared';
import * as iam                                          from 'aws-cdk-lib/aws-iam';
import * as lambda                                       from 'aws-cdk-lib/aws-lambda';
import { Fn, Aws }                                       from 'aws-cdk-lib';
import { Construct }                                     from 'constructs';

import type { IStackFailedEvent }                        from '../../resources/events/stack-failed-event';
import { StackFailureDetectorLambda }                    from '../../resources/lambdas/stack-failure-detector-lambda';
import { retainOnEveryOperation }                        from '../../utils/cfn-resource';

/** Inputs of the stack-failure detection resources. */
export interface StackFailureDetectionInfraProps {
  readonly artifactResolver: IArtifactResolver;
  /** AWS account IDs hosting the vendor license API. Scopes the execute-api:Invoke grant on the detector. */
  readonly vendorAccountIds: string[];
}

const DETECTOR_POLICY_NAME = 'stack-failure-detector-policy';

/** The fixed head of the detector role's physical name; the removal's grants match every name it heads. */
export const DETECTOR_ROLE_NAME_PREFIX = 'mailbox-diag-role-';

/**
 * The detector Lambda, its execution role and inline policy. The detector's trigger is the retained
 * stack-failed rule the Lambda creates for itself. Every resource is retained on update, on delete and
 * when its creating operation is rolled back, so the detector still exists to report that rollback.
 *
 * The role and function names are explicit: `mailbox-diag-role-<position hash>-<guid prefix>` and
 * `mailbox-diag-fn-<position hash>-<guid prefix>`. The position hash is that of the named role or
 * function itself, so a move or a new construct id changes that name; the guid prefix differs per install.
 * `iam:DeleteRole`/`iam:DeleteRolePolicy` don't support the `aws:ResourceTag` condition key at all
 * (verified against the IAM service reference), so the grants that delete this role are scoped by the
 * role name pattern built from `DETECTOR_ROLE_NAME_PREFIX` and the guid prefix, in the sweeper's removal.
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

    // Each name carries the position hash of the resource it names, so a resource created under a new
    // construct id never shares a name with the retained resource of the old id. The role and the
    // function are not constructed yet, hence `ofChild`.
    const detectorRoleHash     = PositionHash.ofChild(this, 'detector-role-v2');
    const detectorFunctionHash = PositionHash.ofChild(this, 'detector-v2');

    const detectorFunctionName = Fn.join('', ['mailbox-diag-fn-', detectorFunctionHash, '-', guidPrefix]);
    const detectorRoleName     = Fn.join('', [DETECTOR_ROLE_NAME_PREFIX, detectorRoleHash, '-', guidPrefix]);

    const detectorRole = new iam.Role(this, 'detector-role-v2', {
      roleName:  detectorRoleName,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    retainOnEveryOperation(detectorRole);

    // Reused below for the grant, so the env var and the grant ARN can never
    // come from two independent lookups.
    const infraLogGroup = PipelineLogGroup.getOrCreate(this, 'infra');

    const detector = new StackFailureDetectorLambda(this, 'detector-v2', {
      artifactResolver:  props.artifactResolver,
      role:              detectorRole,
      functionName:      detectorFunctionName,
      infraLogGroupName: infraLogGroup.logGroupName,
    });
    retainOnEveryOperation(detector);

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
    const detectorPolicy = new iam.Policy(this, 'detector-policy-v2', {
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
            (accountId) => `arn:${Aws.PARTITION}:execute-api:*:${accountId}:*/*/POST/issue-stack-failure-upload`,
          ),
        }),
      ],
    });
    detectorPolicy.attachToRole(detectorRole);
    retainOnEveryOperation(detectorPolicy);
  }
}
