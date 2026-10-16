import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import type { IConstruct } from 'constructs';
import { Fn, Stack, Aws, RemovalPolicy, CfnResource } from 'aws-cdk-lib';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { PipelineLogGroup } from '@serverlessinbox/mailbox-cdk-shared';
import { StackFailureDetectorLambda } from '../../lambdas';

/**
 * Applies RETAIN to a construct's underlying CFN resource, so it is kept on update, on delete and when
 * its creating operation is rolled back. RETAIN_ON_UPDATE_OR_DELETE is not used: CloudFormation deletes
 * those resources when a create rolls back, and the detector reports that rollback, so it must still
 * exist afterwards. Throws at synth when the construct has no CFN resource to retain.
 */
function retainOnEveryOperation(construct: IConstruct, description: string): void {
  const defaultChild = construct.node.defaultChild;
  if (!(defaultChild instanceof CfnResource)) {
    throw new Error(
      `${description}: expected defaultChild to be a CfnResource, got ${defaultChild?.constructor?.name ?? String(defaultChild)}`,
    );
  }
  defaultChild.applyRemovalPolicy(RemovalPolicy.RETAIN);
}

export interface StackFailureDetectionInfraProps {
  readonly artifactResolver: IArtifactResolver;
}

const DETECTOR_POLICY_NAME = 'stack-failure-detector-policy';
const RULE_TARGET_ID = 'Target0';

/**
 * `detectorRoleName` must stay pinned rather than auto-named: `iam:DeleteRole`/`iam:DeleteRolePolicy`
 * don't support the `aws:ResourceTag` condition key at all (verified against the IAM service
 * reference), so the sweeper's worker IAM scopes its delete grant to a deterministic name prefix
 * instead (see `sweeper-infra.ts`) — an auto-named role would leave that grant unscoped.
 * `detectorFunctionName` stays pinned because `StackFailureDetectorLambda`'s `functionName` prop is
 * required.
 *
 * The EventBridge rule is deliberately NOT given an explicit name, so a future construct-tree move
 * can't collide with a RETAIN'd orphan of the old name (see "Explicit physical names + RETAIN" in the
 * CDK construct-pattern skill) — the sweeper's rule-delete grant is scoped by ownership tag, not name.
 */
export class StackFailureDetectionInfra extends Construct {
  readonly detector: lambda.IFunction;
  readonly rule: events.IRule;
  readonly role: iam.IRole;
  readonly ruleTargetId: string;
  readonly detectorRolePolicyName: string;

  constructor(scope: Construct, id: string, props: StackFailureDetectionInfraProps) {
    super(scope, id);

    // Differs after destroy+redeploy, keeping RETAIN'd orphans from colliding with a freshly
    // (re)created stack's resources.
    const stackGuid = Fn.select(2, Fn.split('/', Aws.STACK_ID));
    const guidPrefix = Fn.select(0, Fn.split('-', stackGuid));

    // Makes names unique per construct position, so a future move doesn't collide with the old name.
    const parentGroupId = (this.node.scope as any)?.node?.id ?? 'default';

    const detectorFunctionName = Fn.join('', ['mailbox-diag-fn-', parentGroupId, '-', guidPrefix]);
    const detectorRoleName = Fn.join('', ['mailbox-diag-role-', parentGroupId, '-', guidPrefix]);

    const stack = Stack.of(this);

    // Detector execution role — pinned name (see class doc for why).
    const detectorRole = new iam.Role(this, 'detector-role', {
      roleName: detectorRoleName,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    retainOnEveryOperation(detectorRole, 'detector-role');

    // Reused below for the grant, so the env var and the grant ARN can never
    // come from two independent lookups.
    const infraLogGroup = PipelineLogGroup.getOrCreate(this, 'infra');

    const detector = new StackFailureDetectorLambda(this, 'detector', {
      artifactResolver: props.artifactResolver,
      role: detectorRole,
      functionName: detectorFunctionName,
      infraLogGroupName: infraLogGroup.logGroupName,
    });
    retainOnEveryOperation(detector, 'detector');

    // `CloudFormation Stack Status Change` is a different detail-type from `CloudFormation Resource
    // Status Change` despite overlapping status spellings — do not conflate the two.
    // CREATE_FAILED/UPDATE_FAILED are excluded: they're only terminal when rollback is disabled (not
    // the default), and whether they also fire transiently under default rollback is unconfirmed.
    const rule = new events.Rule(this, 'rule', {
      eventPattern: {
        source: ['aws.cloudformation'],
        detailType: ['CloudFormation Stack Status Change'],
        detail: {
          'stack-id': [stack.stackId],
          'status-details': {
            status: [
              'ROLLBACK_COMPLETE',
              'ROLLBACK_FAILED',
              'UPDATE_ROLLBACK_COMPLETE',
              'UPDATE_ROLLBACK_FAILED',
              'DELETE_FAILED',
            ],
          },
        },
      },
    });
    rule.addTarget(new targets.LambdaFunction(detector));
    retainOnEveryOperation(rule, 'rule');
    // The invoke permission that addTarget creates is a child of the rule, not a construct held here.
    for (const permission of rule.node.findAll().filter((c): c is lambda.CfnPermission => c instanceof lambda.CfnPermission)) {
      permission.applyRemovalPolicy(RemovalPolicy.RETAIN);
    }

    // CreateLogStream/PutLogEvents is needed here because the explicit `role:` passed to the Lambda
    // skips the AWSLambdaBasicExecutionRole managed-policy attachment `Function` would otherwise add.
    const detectorPolicy = new iam.Policy(this, 'detector-policy', {
      policyName: DETECTOR_POLICY_NAME,
      statements: [
        new iam.PolicyStatement({
          actions: ['cloudformation:DescribeStackEvents', 'cloudformation:DescribeStacks'],
          resources: [Aws.STACK_ID],
        }),
      ],
    });
    detectorPolicy.attachToRole(detectorRole);

    // Grant log group write access (CreateLogStream/PutLogEvents) for Lambda exec role
    infraLogGroup.grantWrite(detectorRole);

    // Grant FilterLogEvents access for recovery/troubleshooting
    infraLogGroup.grantFilterEvents(detectorRole);
    retainOnEveryOperation(detectorPolicy, 'detector-policy');

    this.detector = detector;
    this.rule = rule;
    this.role = detectorRole;
    this.ruleTargetId = RULE_TARGET_ID;
    this.detectorRolePolicyName = DETECTOR_POLICY_NAME;
  }
}
