import type { IArtifactResolver }             from '@serverlessinbox/artifact-registry-cdk';
import * as ssm                               from 'aws-cdk-lib/aws-ssm';
import * as cdk                               from 'aws-cdk-lib';
import { Construct }                          from 'constructs';

import { DataOverrideResolverLambda }         from '../resources/lambdas/data-override-resolver-lambda';
import type { ResourceProperties, TableRole } from '../runtime/data-override-resolver/resource-properties';

/** Incoming data table ARNs, one per table role, and the artifact resolver for the resolver Lambda's code. */
export interface MailboxDataOverrideResolverProps {
  readonly configTableArn: string;
  readonly itemTableArn: string;
  readonly changelogTableArn: string;
  readonly auditLogTableArn: string;
  readonly mailFeedbackTableArn: string;
  readonly artifactResolver: IArtifactResolver;
}

/**
 * Resolves the effective data table ARNs, letting an operator redirect a table role to a restored table.
 *
 * Each role gets a stack-owned SSM parameter `/serverlessinbox/<stack>/data-override/<role>` whose value is the
 * stack's own table ARN. An operator overwrites it with a restored table's ARN. The resolver receives both the
 * incoming ARN and the parameter's live value (an SSM dynamic reference, resolved by CloudFormation before the
 * request), and returns the override only when it differs and the override table exists and is ACTIVE.
 */
export class MailboxDataOverrideResolver extends Construct {
  private readonly resource: cdk.CustomResource;

  constructor(scope: Construct, id: string, props: MailboxDataOverrideResolverProps) {
    super(scope, id);

    const fn = new DataOverrideResolverLambda(this, 'handler', {
      artifactResolver: props.artifactResolver,
    });

    const configTableOverride       = this.createOverrideParameter('config-table-override', 'configTable', 'config table', props.configTableArn);
    const itemTableOverride         = this.createOverrideParameter('item-table-override', 'itemTable', 'item table', props.itemTableArn);
    const changelogTableOverride    = this.createOverrideParameter('changelog-table-override', 'changelogTable', 'changelog table', props.changelogTableArn);
    const auditLogTableOverride     = this.createOverrideParameter('auditlog-table-override', 'auditLogTable', 'audit log table', props.auditLogTableArn);
    const mailFeedbackTableOverride = this.createOverrideParameter('mailfeedback-table-override', 'mailFeedbackTable', 'mail feedback table', props.mailFeedbackTableArn);

    const resolverProps: ResourceProperties = {
      configTableIncomingArn: props.configTableArn,
      configTableOverrideArn: this.resolveParameterValue(configTableOverride),
      itemTableIncomingArn: props.itemTableArn,
      itemTableOverrideArn: this.resolveParameterValue(itemTableOverride),
      changelogTableIncomingArn: props.changelogTableArn,
      changelogTableOverrideArn: this.resolveParameterValue(changelogTableOverride),
      auditLogTableIncomingArn: props.auditLogTableArn,
      auditLogTableOverrideArn: this.resolveParameterValue(auditLogTableOverride),
      mailFeedbackTableIncomingArn: props.mailFeedbackTableArn,
      mailFeedbackTableOverrideArn: this.resolveParameterValue(mailFeedbackTableOverride),
    };

    this.resource = new cdk.CustomResource(this, 'resource', {
      serviceToken: fn.functionArn,
      resourceType: 'Custom::MailboxDataOverrideResolver',
      serviceTimeout: cdk.Duration.seconds(120),
      properties: resolverProps,
    });
  }

  /** The effective config table ARN: the operator's override when honored, otherwise the stack's own table. */
  public getConfigTableArn(): string {
    return this.resource.getAttString('configTableArn');
  }

  /** The effective item table ARN: the operator's override when honored, otherwise the stack's own table. */
  public getItemTableArn(): string {
    return this.resource.getAttString('itemTableArn');
  }

  /** The effective changelog table ARN: the operator's override when honored, otherwise the stack's own table. */
  public getChangelogTableArn(): string {
    return this.resource.getAttString('changelogTableArn');
  }

  /** The effective audit log table ARN: the operator's override when honored, otherwise the stack's own table. */
  public getAuditLogTableArn(): string {
    return this.resource.getAttString('auditLogTableArn');
  }

  /** The effective mail feedback table ARN: the operator's override when honored, otherwise the stack's own table. */
  public getMailFeedbackTableArn(): string {
    return this.resource.getAttString('mailFeedbackTableArn');
  }

  private createOverrideParameter(id: string, role: TableRole, tableLabel: string, incomingArn: string): ssm.StringParameter {
    return new ssm.StringParameter(this, id, {
      parameterName: `/serverlessinbox/${cdk.Aws.STACK_NAME}/data-override/${role}`,
      stringValue: incomingArn,
      description: `Operator-overridable ARN for the ${tableLabel}. Replace with a restored table ARN to redirect this role.`,
      // The name is a token that starts with "/", which CDK rejects for a simple name.
      simpleName: false,
    });
  }

  // CloudFormation resolves the dynamic reference before invoking the Lambda, so the Lambda sees the
  // operator's current choice without calling SSM itself.
  private resolveParameterValue(parameter: ssm.StringParameter): string {
    return cdk.Fn.join('', ['{{resolve:ssm:', parameter.parameterName, '}}']);
  }
}
