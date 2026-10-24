import type { IArtifactResolver }                                    from '@serverlessinbox/artifact-registry-cdk';
import { PositionHash, StackIdentity }                               from '@serverlessinbox/mailbox-cdk-shared';
import * as iam                                                      from 'aws-cdk-lib/aws-iam';
import { IFunction }                                                 from 'aws-cdk-lib/aws-lambda';
import { ArnFormat, Aws, Fn, Stack }                                 from 'aws-cdk-lib';
import { Construct }                                                 from 'constructs';

import { ResourceSweeperStarterLambda }                              from '../../../resources/lambdas/resource-sweeper-starter-lambda';
import { ResourceSweeperWorkerLambda }                               from '../../../resources/lambdas/resource-sweeper-worker-lambda';
import { SweeperPolicyNames, SweeperWorkflow }                       from '../../../resources/workflows/sweeper-workflow';
import { retainOnUpdateOrDelete }                                    from '../../../utils/cfn-resource';

import type { IResourceRemoval }                                     from './removal';
import { SweeperExecutionGrants }                                    from './sweeper-execution-grants';
import { SWEEPER_WORKER_ROLE_NAME_PREFIX }                           from './sweeper-worker-role-name';
import { SweeperWorkerRoleRemoval }                                  from './sweeper-worker-role-removal';

export interface SweeperInfraProps {
  readonly artifactResolver: IArtifactResolver;
  /**
   * Removals to sweep. Each contributes the IAM grants its own resources need onto the shared
   * worker role, and its own steps (including any waiting) to the state machine — see
   * `IResourceRemoval`.
   */
  readonly removals: IResourceRemoval[];
}

/** The deterministic physical names of the sweeper's state machine and roles. */
interface SweeperResourceNames {
  readonly stateMachine:  string;
  readonly executionRole: string;
  readonly workerRole:    string;
}

/**
 * Core sweeper infrastructure: execution role, worker Lambda, state machine, and starter Lambda.
 *
 * The worker, state machine and execution role are RETAIN'd to survive stack deletion and continue running
 * the sweeper execution asynchronously. The self-cleanup tail deletes them after targets are gone.
 *
 * Circular-dependency mitigation: the state machine, the execution role and the worker role carry
 * deterministic names ending in a position hash and a GUID prefix. Their ARNs are built via
 * Stack.formatArn() (plain strings, no GetAtt tokens) and used everywhere self-referential ARNs are
 * needed (inline policies, permissions boundary, starter env vars). This removes all CloudFormation
 * dependency edges that would otherwise form a cycle. The position hash changes when the construct
 * moves and the GUID prefix differs per install and after destroy+redeploy, so RETAIN'd stubs never
 * collide.
 */
export class SweeperInfra extends Construct {
  readonly starter: IFunction;
  readonly workerRoleRemoval: IResourceRemoval;

  constructor(scope: Construct, id: string, props: SweeperInfraProps) {
    super(scope, id);

    const names            = this.resourceNames();
    const executionRoleArn = this.roleArn(names.executionRole);
    const workerRoleArn    = this.roleArn(names.workerRole);
    const stateMachineArn  = this.stateMachineArnOf(names.stateMachine);

    const executionRole = this.createExecutionRole(names.executionRole);
    const workerRole    = this.createWorkerRole(names.workerRole);

    // Registered last, so its chain runs after the chains of every other removal.
    this.workerRoleRemoval = new SweeperWorkerRoleRemoval(this, 'worker-role-removal', {
      workerRoleArn,
      workerRolePolicyName: SweeperPolicyNames.workerPolicy,
    });
    const removals         = [...props.removals, this.workerRoleRemoval];

    // Worker Lambda (RETAIN'd — invoked by the state machine after the stack is deleted)
    const worker = new ResourceSweeperWorkerLambda(this, 'worker', {
      artifactResolver: props.artifactResolver,
      role:             workerRole,
    });
    retainOnUpdateOrDelete(worker);

    const executionGrants = new SweeperExecutionGrants({
      workerFunctionArn: worker.functionArn,
      workerRoleArn,
      stateMachineArn,
      executionRoleArn,
    });
    const executionPolicy = this.attachExecutionPolicy(executionRole, executionGrants);
    this.applyExecutionPermissionsBoundary(executionRole, executionGrants);

    const workflow = new SweeperWorkflow(this, 'workflow', {
      // The state machine's tasks add their statements to the role they run as, and so would create a second policy on this role.
      executionRole: executionRole.withoutPolicyUpdates(),
      workerRoleArn,
      workerRoleName: names.workerRole,
      worker,
      stateMachineName: names.stateMachine,
      stateMachineArn,
      removals,
    });
    // The starter may start an execution during the deploy, which must not run before the role holds its grants.
    workflow.node.addDependency(executionPolicy);

    // Starter Lambda (NOT retained — CFN deletes normally)
    this.starter = new ResourceSweeperStarterLambda(this, 'starter', {
      artifactResolver: props.artifactResolver,
      stateMachineArn,
    });

    // The starter receives the state machine ARN as a plain string, so only this edge makes a replaced state machine exist before the starter, and the custom resources it serves, update.
    this.starter.node.addDependency(workflow);

    this.attachWorkerPolicy(workerRole, removals);

    workflow.grantStartExecution(this.starter);
    workflow.grantExecutionReaping(this.starter);
  }

  /**
   * The names are deterministic so ARNs can be plain strings. They carry a hash of this construct's
   * position in the stack, so moving it changes them and the retained resources of the old position
   * never collide with the new ones, and the first 8 characters of the stack's GUID, which differ per
   * install and after destroy+redeploy.
   */
  private resourceNames(): SweeperResourceNames {
    const positionHash = PositionHash.of(this);
    const guidPrefix   = StackIdentity.guidPrefix;

    return {
      stateMachine:  Fn.join('', ['mailbox-sweeper-', positionHash, '-', guidPrefix]),
      executionRole: Fn.join('', ['mailbox-sweeper-exec-', positionHash, '-', guidPrefix]),
      workerRole:    Fn.join('', [SWEEPER_WORKER_ROLE_NAME_PREFIX, positionHash, '-', guidPrefix]),
    };
  }

  private roleArn(roleName: string): string {
    return Stack.of(this).formatArn({
      service:      'iam',
      region:       '',
      resource:     'role',
      resourceName: roleName,
    });
  }

  private stateMachineArnOf(stateMachineName: string): string {
    return Stack.of(this).formatArn({
      service:      'states',
      region:       Aws.REGION,
      resource:     'stateMachine',
      resourceName: stateMachineName,
      arnFormat:    ArnFormat.COLON_RESOURCE_NAME,
    });
  }

  private createExecutionRole(roleName: string): iam.Role {
    const role = new iam.Role(this, 'execution-role', {
      roleName,
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com', {
        conditions: {
          StringEquals: {
            'aws:SourceAccount': Aws.ACCOUNT_ID,
          },
        },
      }),
    });
    retainOnUpdateOrDelete(role);
    return role;
  }

  private createWorkerRole(roleName: string): iam.Role {
    const role = new iam.Role(this, 'worker-role', {
      roleName,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    retainOnUpdateOrDelete(role);
    return role;
  }

  /** The policy sits on a RETAIN'd role and is needed while the stack is torn down, so it is retained too; the self-cleanup tail deletes it. */
  private attachExecutionPolicy(executionRole: iam.IRole, grants: SweeperExecutionGrants): iam.Policy {
    const executionPolicy = new iam.Policy(this, 'execution-policy', {
      policyName: SweeperPolicyNames.executionPolicy,
      statements: grants.statements(),
    });
    executionPolicy.attachToRole(executionRole);
    retainOnUpdateOrDelete(executionPolicy);
    return executionPolicy;
  }

  /**
   * The boundary is a ceiling, built from the same grants as the inline policy. The role is RETAIN'd
   * and cannot be deleted, so its attached boundary must be retained too, or CloudFormation cannot
   * delete it and the teardown fails with a 409.
   */
  private applyExecutionPermissionsBoundary(executionRole: iam.IRole, grants: SweeperExecutionGrants): void {
    const boundaryPolicy = new iam.ManagedPolicy(this, 'execution-role-boundary', {
      statements: grants.statements(),
    });
    iam.PermissionsBoundary.of(executionRole).apply(boundaryPolicy);
    retainOnUpdateOrDelete(boundaryPolicy);
  }

  /**
   * One inline policy for every registered removal's grants (`IResourceRemoval.grantStatements()`),
   * then the worker's log grants. It sits on a RETAIN'd role and is needed while the stack is torn
   * down, so it is retained too; the self-cleanup tail deletes it.
   */
  private attachWorkerPolicy(workerRole: iam.IRole, removals: IResourceRemoval[]): void {
    const workerPolicy = new iam.Policy(this, 'worker-policy', {
      policyName: SweeperPolicyNames.workerPolicy,
      statements: [
        ...removals.flatMap((removal) => removal.grantStatements()),
        this.grantLogGroupCreation(),
        this.grantLogStreamWriting(),
      ],
    });
    workerPolicy.attachToRole(workerRole);
    retainOnUpdateOrDelete(workerPolicy);
  }

  /** The worker's role exists before its function, whose log group name is generated, so the grants cannot name the group. */
  private grantLogGroupCreation(): iam.PolicyStatement {
    return new iam.PolicyStatement({
      actions:   ['logs:CreateLogGroup'],
      resources: [`arn:${Aws.PARTITION}:logs:${Aws.REGION}:${Aws.ACCOUNT_ID}:*`],
    });
  }

  /** Write-only, with the same effective scope as AWSLambdaBasicExecutionRole. */
  private grantLogStreamWriting(): iam.PolicyStatement {
    return new iam.PolicyStatement({
      actions:   ['logs:CreateLogStream', 'logs:PutLogEvents'],
      resources: [
        `arn:${Aws.PARTITION}:logs:${Aws.REGION}:${Aws.ACCOUNT_ID}:log-group:*`,
        `arn:${Aws.PARTITION}:logs:${Aws.REGION}:${Aws.ACCOUNT_ID}:log-group:*:*`,
      ],
    });
  }
}
