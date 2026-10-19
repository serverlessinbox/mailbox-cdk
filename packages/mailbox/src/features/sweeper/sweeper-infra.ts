import * as iam from 'aws-cdk-lib/aws-iam';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { ArnFormat, Aws, Fn, Stack } from 'aws-cdk-lib';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { StackIdentity } from '@serverlessinbox/mailbox-cdk-shared';
import { ResourceSweeperStarterLambda, ResourceSweeperWorkerLambda } from '../../lambdas';
import { retainOnUpdateOrDelete } from '../../utils/cfn-resource';
import type { IResourceRemoval } from './removal';
import { SweeperExecutionGrants } from './sweeper-execution-grants';
import { SweeperPolicyNames } from './sweeper-names';
import { SweeperWorkflow } from './sweeper-workflow';

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
  readonly stateMachine: string;
  readonly executionRole: string;
  readonly workerRole: string;
}

/**
 * Core sweeper infrastructure: execution role, worker Lambda, state machine, and starter Lambda.
 *
 * The worker, state machine and execution role are RETAIN'd to survive stack deletion and continue running
 * the sweeper execution asynchronously. The self-cleanup tail deletes them after targets are gone.
 *
 * Circular-dependency mitigation: both the execution role and the worker role carry GUID-suffixed
 * deterministic names. Their ARNs are built via Stack.formatArn() (plain strings, no GetAtt tokens)
 * and used everywhere self-referential ARNs are needed (inline policies, permissions boundary,
 * starter env vars). This removes all CloudFormation dependency edges that would otherwise form a
 * cycle. The GUID suffix ensures the names are unique per stack lifetime but differ after
 * destroy+redeploy, so RETAIN'd role stubs never collide.
 */
export class SweeperInfra extends Construct {
  readonly starter: IFunction;

  constructor(scope: Construct, id: string, props: SweeperInfraProps) {
    super(scope, id);

    const names = this.resourceNames();
    const executionRoleArn = this.roleArn(names.executionRole);
    const workerRoleArn = this.roleArn(names.workerRole);
    const stateMachineArn = this.stateMachineArnOf(names.stateMachine);

    const executionRole = this.createExecutionRole(names.executionRole);
    const workerRole = this.createWorkerRole(names.workerRole);

    // Worker Lambda (RETAIN'd — invoked by the state machine after the stack is deleted)
    const worker = new ResourceSweeperWorkerLambda(this, 'worker', {
      artifactResolver: props.artifactResolver,
      role: workerRole,
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
      removals: props.removals,
    });
    // The starter may start an execution during the deploy, which must not run before the role holds its grants.
    workflow.node.addDependency(executionPolicy);
    workflow.markForRetention();

    // Starter Lambda (NOT retained — CFN deletes normally)
    this.starter = new ResourceSweeperStarterLambda(this, 'starter', {
      artifactResolver: props.artifactResolver,
      stateMachineArn,
    });

    this.attachWorkerPolicy(workerRole, worker, props.removals);

    workflow.grantStartExecution(this.starter);
    workflow.grantExecutionReaping(this.starter);
  }

  /**
   * The names are deterministic so ARNs can be plain strings. They carry the id of the group the
   * sweeper sits in, so moving it to another group changes them and the retained resources of the old
   * position never collide with the new ones, and the stack's GUID, which differs after destroy+redeploy.
   */
  private resourceNames(): SweeperResourceNames {
    const stackGuid = StackIdentity.guid;
    const parentGroupId = this.node.scope?.node.id ?? 'default';

    return {
      stateMachine: Fn.join('', ['mailbox-sweeper-', parentGroupId, '-', stackGuid]),
      executionRole: Fn.join('', ['mailbox-sweeper-exec-', parentGroupId, '-', stackGuid]),
      workerRole: Fn.join('', ['mailbox-sweeper-worker-', parentGroupId, '-', stackGuid]),
    };
  }

  private roleArn(roleName: string): string {
    return Stack.of(this).formatArn({
      service: 'iam',
      region: '',
      resource: 'role',
      resourceName: roleName,
    });
  }

  private stateMachineArnOf(stateMachineName: string): string {
    return Stack.of(this).formatArn({
      service: 'states',
      region: Aws.REGION,
      resource: 'stateMachine',
      resourceName: stateMachineName,
      arnFormat: ArnFormat.COLON_RESOURCE_NAME,
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
  private attachWorkerPolicy(workerRole: iam.IRole, worker: ResourceSweeperWorkerLambda, removals: IResourceRemoval[]): void {
    const workerPolicy = new iam.Policy(this, 'worker-policy', {
      policyName: SweeperPolicyNames.workerPolicy,
      statements: removals.flatMap((removal) => removal.grantStatements()),
    });
    worker.grantLogWriting(workerPolicy);
    workerPolicy.attachToRole(workerRole);
    retainOnUpdateOrDelete(workerPolicy);
  }
}
