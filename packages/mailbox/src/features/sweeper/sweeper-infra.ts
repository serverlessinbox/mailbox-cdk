import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { ResourceSweeperStarterLambda, ResourceSweeperWorkerLambda } from '../../lambdas';
import type { ICdkArtifactResolver } from '../../artifacts/cdk-artifact-resolver';
import { SweeperWorkflow } from './sweeper-workflow';
import { Fn, Stack, Aws, Duration, RemovalPolicy, ArnFormat } from 'aws-cdk-lib';

export interface SweeperInfraProps {
  readonly artifactResolver: ICdkArtifactResolver;
}

/**
 * Core sweeper infrastructure: execution role, worker Lambda, state machine, and starter Lambda.
 *
 * Creates:
 * - `worker` TypeScriptLambda (RETAIN'd — invoked by SFN for us-east-1 edge Lambda delete)
 * - `workflow` SweeperWorkflow state machine (RETAIN'd)
 * - `starter` TypeScriptLambda (NOT retained — CFN deletes normally)
 * - `executionRole` IAM role for the state machine (RETAIN'd, self-strips policies in cleanup tail)
 *
 * The worker and execution role are RETAIN'd to survive stack deletion and continue running
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
  readonly starter: ResourceSweeperStarterLambda;
  readonly worker: ResourceSweeperWorkerLambda;
  readonly workflow: SweeperWorkflow;
  readonly executionRole: iam.Role;

  constructor(scope: Construct, id: string, props: SweeperInfraProps) {
    super(scope, id);

    const stack = Stack.of(this);

    // Derive stack GUID for uniqueness — fixed for a stack's lifetime, differs after destroy+redeploy.
    const stackGuid = Fn.select(2, Fn.split('/', Aws.STACK_ID));

    // State machine name (GUID-suffixed, same as before)
    const smName = Fn.join('', ['mailbox-sweeper-', stackGuid]);

    // Deterministic GUID-suffixed role names — required so ARNs can be constructed as plain strings
    // (no GetAtt), breaking all self-referential circular CloudFormation dependency edges.
    const execRoleName = Fn.join('', ['mailbox-sweeper-exec-', stackGuid]);
    const workerRoleName = Fn.join('', ['mailbox-sweeper-worker-', stackGuid]);

    // Pre-built ARN strings using formatArn — no GetAtt tokens, no CFN dependency edges.
    const execRoleArn = stack.formatArn({
      service: 'iam',
      region: '',
      resource: 'role',
      resourceName: execRoleName,
    });
    const workerRoleArn = stack.formatArn({
      service: 'iam',
      region: '',
      resource: 'role',
      resourceName: workerRoleName,
    });
    const smArn = stack.formatArn({
      service: 'states',
      region: Aws.REGION,
      resource: 'stateMachine',
      resourceName: smName,
      arnFormat: ArnFormat.COLON_RESOURCE_NAME,
    });

    // SFN execution role — deterministic GUID-suffixed name so its ARN can be built without GetAtt.
    this.executionRole = new iam.Role(this, 'execution-role', {
      roleName: execRoleName,
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com', {
        conditions: {
          StringEquals: {
            'aws:SourceAccount': Aws.ACCOUNT_ID,
          },
        },
      }),
    });
    (this.executionRole.node.defaultChild as any)
      ?.applyRemovalPolicy(RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE);

    // Worker IAM role — pre-created with a deterministic GUID-suffixed name so its ARN can be
    // built without GetAtt and passed to both the Lambda and the workflow without creating cycles.
    const workerRole = new iam.Role(this, 'worker-role', {
      roleName: workerRoleName,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });
    (workerRole.node.defaultChild as any)
      ?.applyRemovalPolicy(RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE);

    // Worker Lambda (RETAIN'd — invoked by SFN Branch B post-stack-delete)
    // Now instantiated via the typed wrapper construct
    this.worker = new ResourceSweeperWorkerLambda(this, 'worker', {
      artifactResolver: props.artifactResolver,
      role: workerRole,
    });
    (this.worker.node.defaultChild as any)
      ?.applyRemovalPolicy(RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE);

    // Execution role: consolidated inline policy for all SFN operations.
    // Self-referential ARNs (worker role, own role) use pre-built formatArn strings — no GetAtt.
    const executionPolicy = new iam.Policy(this, 'execution-policy', {
      policyName: 'sweeper-execution-policy',
      statements: [
        // Invoke and delete worker Lambda
        new iam.PolicyStatement({
          actions: ['lambda:InvokeFunction', 'lambda:DeleteFunction'],
          resources: [this.worker.functionArn],
        }),
        // Delete worker role — uses formatArn string, not roleArn token (no GetAtt edge)
        new iam.PolicyStatement({
          actions: ['iam:DeleteRolePolicy', 'iam:DeleteRole'],
          resources: [workerRoleArn],
        }),
        // Core ACM cert (same-region CallAwsService)
        // Ownership is enforced authoritatively by IAM tag condition on acm:DeleteCertificate.
        // ASL cannot reliably filter tags by value, so we rely on the IAM condition guard.
        new iam.PolicyStatement({
          actions: [
            'acm:DescribeCertificate',
            'acm:DeleteCertificate',
          ],
          resources: [`arn:aws:acm:${Aws.REGION}:${Aws.ACCOUNT_ID}:certificate/*`],
          conditions: {
            'StringEquals': {
              'aws:ResourceTag/serverless-inbox:root-stack': Aws.STACK_NAME,
            },
          },
        }),
        // Delete state machine — smArn is already a formatArn string (no GetAtt)
        new iam.PolicyStatement({
          actions: ['states:DeleteStateMachine'],
          resources: [smArn],
        }),
        // Strip own role policy — uses formatArn string, not executionRole.roleArn token (no GetAtt edge)
        new iam.PolicyStatement({
          actions: ['iam:DeleteRolePolicy'],
          resources: [execRoleArn],
        }),
      ],
    });
    executionPolicy.attachToRole(this.executionRole);

    // Permissions boundary: restrict execution role to the same operations as the inline policy.
    // Self-referential ARNs use formatArn strings — no GetAtt edges (breaks the boundary→role cycle).
    const boundaryPolicy = new iam.ManagedPolicy(this, 'execution-role-boundary', {
      statements: [
        new iam.PolicyStatement({
          actions: ['lambda:InvokeFunction', 'lambda:DeleteFunction'],
          resources: [this.worker.functionArn],
        }),
        // Worker role — formatArn string, not workerRole.roleArn token
        new iam.PolicyStatement({
          actions: ['iam:DeleteRolePolicy', 'iam:DeleteRole'],
          resources: [workerRoleArn],
        }),
        new iam.PolicyStatement({
          actions: ['acm:DescribeCertificate', 'acm:DeleteCertificate'],
          resources: [`arn:aws:acm:${Aws.REGION}:${Aws.ACCOUNT_ID}:certificate/*`],
          conditions: {
            'StringEquals': {
              'aws:ResourceTag/serverless-inbox:root-stack': Aws.STACK_NAME,
            },
          },
        }),
        new iam.PolicyStatement({
          actions: ['states:DeleteStateMachine'],
          resources: [smArn],
        }),
        // Own execution role — formatArn string, not executionRole.roleArn token
        new iam.PolicyStatement({
          actions: ['iam:DeleteRolePolicy'],
          resources: [execRoleArn],
        }),
      ],
    });
    iam.PermissionsBoundary.of(this.executionRole).apply(boundaryPolicy);
    // Exec-role stub is RETAIN'd and cannot be deleted, so its attached permissions-boundary policy must be retained too — otherwise CFN can't delete it (attached to the stub) and teardown fails with a 409.
    (boundaryPolicy.node.defaultChild as any)
      ?.applyRemovalPolicy(RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE);

    // State machine workflow — pass pre-built ARN strings and role names so SweeperWorkflow never needs GetAtt tokens.
    this.workflow = new SweeperWorkflow(this, 'workflow', {
      executionRole: this.executionRole,
      executionRoleArn: execRoleArn,
      executionRoleName: execRoleName,
      workerRole,
      workerRoleArn,
      workerRoleName,
      worker: this.worker,
      workerLambdaArn: this.worker.functionArn,
      workerRolePolicyName: 'sweeper-worker-policy',
      rolePolicyName: 'sweeper-execution-policy',
      checkInterval: Duration.minutes(5),
      timeout: Duration.hours(4),
      stateMachineName: smName,
      stateMachineArn: smArn,
    });
    (this.workflow.stateMachine.node.defaultChild as any)
      ?.applyRemovalPolicy(RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE);

    // Starter Lambda (NOT retained — CFN deletes normally)
    // Now instantiated via the typed wrapper construct with minimal env vars
    this.starter = new ResourceSweeperStarterLambda(this, 'starter', {
      artifactResolver: props.artifactResolver,
      stateMachineArn: smArn,
      rootStackName: Aws.STACK_NAME,
    });

    // Worker role: single consolidated inline policy
    // GetFunction is scoped by ARN prefix + runtime tag guard in the Lambda handler (not IAM condition).
    // DeleteFunction is scoped by both ARN prefix and aws:ResourceTag condition.
    const workerPolicy = new iam.Policy(this, 'worker-policy', {
      policyName: 'sweeper-worker-policy',
      statements: [
        new iam.PolicyStatement({
          actions: ['lambda:GetFunction'],
          resources: [`arn:aws:lambda:us-east-1:${Aws.ACCOUNT_ID}:function:${Aws.STACK_NAME}-edge-*`],
        }),
        new iam.PolicyStatement({
          actions: ['lambda:DeleteFunction'],
          resources: [`arn:aws:lambda:us-east-1:${Aws.ACCOUNT_ID}:function:${Aws.STACK_NAME}-edge-*`],
          conditions: {
            'StringEquals': {
              'aws:ResourceTag/serverless-inbox:root-stack': Aws.STACK_NAME,
            },
          },
        }),
      ],
    });
    workerPolicy.attachToRole(workerRole);

    // Starter can invoke the state machine — smArn is a formatArn string (no GetAtt edge)
    this.starter.addToRolePolicy(new iam.PolicyStatement({
      actions: ['states:StartExecution'],
      resources: [smArn],
    }));
  }
}
