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

/** Inputs of the stack-failure detection resources. */
export interface StackFailureDetectionInfraProps {
  readonly artifactResolver: IArtifactResolver;
  /** AWS account IDs hosting the vendor license API. Scopes the execute-api:Invoke grant on the detector. */
  readonly vendorAccountIds: string[];
}

const DETECTOR_POLICY_NAME = 'stack-failure-detector-policy';
const RULE_TARGET_ID = 'Target0';

/**
 * The detector Lambda, its execution role and inline policy, and the EventBridge rule that fires the
 * detector when the stack ends in a failed or rolled-back state. Every resource is retained on update,
 * on delete and when its creating operation is rolled back, so the detector still exists to report that
 * rollback.
 *
 * `detectorRoleName` must stay pinned rather than auto-named: `iam:DeleteRole`/`iam:DeleteRolePolicy`
 * don't support the `aws:ResourceTag` condition key at all (verified against the IAM service
 * reference), so a grant to delete this role can only be scoped to a deterministic name prefix — an
 * auto-named role would leave that grant unscoped.
 * `detectorFunctionName` stays pinned because `StackFailureDetectorLambda`'s `functionName` prop is
 * required.
 *
 * The EventBridge rule is deliberately NOT given an explicit name, so a construct-tree move can't
 * collide with a RETAIN'd orphan of the old name.
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
    const parentGroupId = this.node.scope?.node.id ?? 'default';

    const detectorFunctionName = Fn.join('', ['mailbox-diag-fn-', parentGroupId, '-', guidPrefix]);
    const detectorRoleName = Fn.join('', ['mailbox-diag-role-', parentGroupId, '-', guidPrefix]);

    const detectorRole = new iam.Role(this, 'detector-role', {
      roleName: detectorRoleName,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    this.retainOnEveryOperation(detectorRole, 'detector-role');

    // Reused below for the grant, so the env var and the grant ARN can never
    // come from two independent lookups.
    const infraLogGroup = PipelineLogGroup.getOrCreate(this, 'infra');

    const detector = new StackFailureDetectorLambda(this, 'detector', {
      artifactResolver: props.artifactResolver,
      role: detectorRole,
      functionName: detectorFunctionName,
      infraLogGroupName: infraLogGroup.logGroupName,
    });
    this.retainOnEveryOperation(detector, 'detector');

    const rule = this.createStackFailureRule(detector);

    this.createDetectorPolicy(detectorRole, infraLogGroup.logGroupArn, props.vendorAccountIds);

    this.detector = detector;
    this.rule = rule;
    this.role = detectorRole;
    this.ruleTargetId = RULE_TARGET_ID;
    this.detectorRolePolicyName = DETECTOR_POLICY_NAME;
  }

  private createStackFailureRule(detector: lambda.IFunction): events.Rule {
    // `CloudFormation Stack Status Change` is a different detail-type from `CloudFormation Resource
    // Status Change` despite overlapping status spellings — do not conflate the two.
    // CREATE_FAILED/UPDATE_FAILED are excluded: they are only terminal when rollback is disabled, which
    // is not the default.
    const rule = new events.Rule(this, 'rule', {
      eventPattern: {
        source: ['aws.cloudformation'],
        detailType: ['CloudFormation Stack Status Change'],
        detail: {
          'stack-id': [Stack.of(this).stackId],
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
    this.retainOnEveryOperation(rule, 'rule');
    this.retainInvokePermission(rule);
    return rule;
  }

  private createDetectorPolicy(detectorRole: iam.IRole, infraLogGroupArn: string, vendorAccountIds: string[]): void {
    // The log grants live on this policy rather than on the role through grant methods, so the role
    // never gets an implicit DefaultPolicy. CreateLogStream/PutLogEvents is needed because the explicit
    // `role:` passed to the Lambda skips the AWSLambdaBasicExecutionRole attachment `Function` would add.
    const detectorPolicy = new iam.Policy(this, 'detector-policy', {
      policyName: DETECTOR_POLICY_NAME,
      statements: [
        new iam.PolicyStatement({
          actions: ['cloudformation:DescribeStackEvents', 'cloudformation:DescribeStacks'],
          resources: [Aws.STACK_ID],
        }),
        new iam.PolicyStatement({
          actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: [infraLogGroupArn],
        }),
        // FilterLogEvents is for recovery and troubleshooting.
        new iam.PolicyStatement({
          actions: ['logs:FilterLogEvents'],
          resources: [infraLogGroupArn],
        }),
        // Cross-account SigV4 calls to the vendor API need an identity-side allow in addition to its resource policy.
        new iam.PolicyStatement({
          actions: ['execute-api:Invoke'],
          resources: vendorAccountIds.map(
            (accountId) => `arn:aws:execute-api:*:${accountId}:*/*/POST/issue-stack-failure-upload`,
          ),
        }),
      ],
    });
    detectorPolicy.attachToRole(detectorRole);    this.retainOnEveryOperation(detectorPolicy, 'detector-policy');
  }

  /**
   * `addTarget` creates the invoke permission under the rule with a generated id, so it is found by
   * type within the rule's subtree. Throws at synth when there is none.
   */
  private retainInvokePermission(rule: events.Rule): void {
    const invokePermission = rule.node
      .findAll()
      .find((c): c is lambda.CfnPermission => c instanceof lambda.CfnPermission);
    if (!invokePermission) {
      throw new Error('rule: expected addTarget to create an invoke permission under the rule');
    }
    invokePermission.applyRemovalPolicy(RemovalPolicy.RETAIN);
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
