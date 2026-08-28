import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { Fn, Aws, Stack, Duration } from 'aws-cdk-lib';

/**
 * Support Access IAM roles infrastructure.
 *
 * Creates two support roles with:
 * - Explicit deterministic names (folded in parent-group id + stackGuid)
 * - Empty/deny default trust policy
 * - MaxSessionDuration: 3600 (1 hour, AWS documented minimum for safe session control)
 * - NO permissions policy at creation — PutRolePolicy writes tier-specific permissions only when a case opens
 */
export class SupportAccessRolesInfra extends Construct {
  readonly supportDiagRole: iam.Role;
  readonly supportDiagRoleArn: string;
  readonly supportConfigReadRole: iam.Role;
  readonly supportConfigReadRoleArn: string;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    const stack = Stack.of(this);

    // Derive stack GUID for uniqueness — fixed for a stack's lifetime, differs after destroy+redeploy.
    const stackGuid = Fn.select(2, Fn.split('/', Aws.STACK_ID));

    // Derive parent group id (e.g., 'ops') to make names unique per construct position.
    const parentGroupId = (this.node.scope as any)?.node?.id ?? 'default';

    // Deterministic role names with group id and stack GUID to ensure uniqueness if construct moves.
    const supportDiagRoleName = Fn.join('', ['support-diag-', parentGroupId, '-', stackGuid]);
    const supportConfigReadRoleName = Fn.join('', ['support-config-read-', parentGroupId, '-', stackGuid]);

    // Pre-built ARN strings using formatArn — required for trust-writer policy scoping.
    this.supportDiagRoleArn = stack.formatArn({
      service: 'iam',
      region: '',
      resource: 'role',
      resourceName: supportDiagRoleName,
    });

    this.supportConfigReadRoleArn = stack.formatArn({
      service: 'iam',
      region: '',
      resource: 'role',
      resourceName: supportConfigReadRoleName,
    });

    // support-diag role: CloudWatch Logs/metrics + Lambda/Step Functions/DynamoDB/SQS introspection.
    // Empty/deny default trust — no principal can assume until a case opens and trust-writer writes the policy.
    // CDK requires an assumedBy principal; to achieve a non-assumable default, we use a service principal
    // for a non-existent AWS service. An AssumeRolePolicyDocument that names only a non-existent service
    // will never match any real assume attempt, effectively denying all assumes until the trust-writer
    // lambda (invoked by admin-api) calls UpdateAssumeRolePolicy to overwrite this with a real trust policy
    // scoped to the vendor role + ExternalId for each open case.
    this.supportDiagRole = new iam.Role(this, 'support-diag', {
      roleName: supportDiagRoleName,
      assumedBy: new iam.ServicePrincipal('empty-deny-placeholder.amazonaws.com'),
      maxSessionDuration: Duration.seconds(3600),
      description: 'Support access role for diagnostics (CloudWatch, Lambda, Step Functions, DynamoDB, SQS introspection). Permissions written per-case at runtime.',
    });

    // support-config-read role: Read-only access to config table and stack parameters.
    // Empty/deny default trust — no principal can assume until a case opens and trust-writer writes the policy.
    // CDK requires an assumedBy principal; to achieve a non-assumable default, we use a service principal
    // for a non-existent AWS service. An AssumeRolePolicyDocument that names only a non-existent service
    // will never match any real assume attempt, effectively denying all assumes until the trust-writer
    // lambda (invoked by admin-api) calls UpdateAssumeRolePolicy to overwrite this with a real trust policy
    // scoped to the vendor role + ExternalId for each open case.
    this.supportConfigReadRole = new iam.Role(this, 'support-config-read', {
      roleName: supportConfigReadRoleName,
      assumedBy: new iam.ServicePrincipal('empty-deny-placeholder.amazonaws.com'),
      maxSessionDuration: Duration.seconds(3600),
      description: 'Support access role for config reading (DynamoDB config table, stack parameters). Permissions written per-case at runtime.',
    });

    // No permissions policy is attached at creation. D15 specifies that tier-specific permissions
    // (the allowlists) are written by the trust-writer lambda at case-open via PutRolePolicy,
    // and stripped via DeleteRolePolicy at case-close.
  }
}
