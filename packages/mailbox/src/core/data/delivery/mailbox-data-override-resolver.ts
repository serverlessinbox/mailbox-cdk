import type { IArtifactResolver }             from '@serverlessinbox/artifact-registry-cdk';
import * as ssm                               from 'aws-cdk-lib/aws-ssm';
import * as cdk                               from 'aws-cdk-lib';
import { Construct }                          from 'constructs';

import { DataOverrideResolverLambda }         from '../../../resources/lambdas/data-override-resolver-lambda';
import type { ResourceProperties, TableRole } from '../../../runtime/data-override-resolver/resource-properties-contract';

/** Incoming data table ARNs by table role, and the artifact resolver for the resolver Lambda's code. */
export interface MailboxDataOverrideResolverProps {
  readonly tableArns:        Record<TableRole, string>;
  readonly artifactResolver: IArtifactResolver;
}

/** The child id and the description label of the override parameter of one table role. */
interface TableOverrideParameter {
  readonly id:    string;
  readonly label: string;
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
  private static readonly PARAMETERS: Record<TableRole, TableOverrideParameter> = {
    configTable:       { id: 'config-table-override', label: 'config table' },
    itemTable:         { id: 'item-table-override', label: 'item table' },
    changelogTable:    { id: 'changelog-table-override', label: 'changelog table' },
    auditLogTable:     { id: 'auditlog-table-override', label: 'audit log table' },
    mailFeedbackTable: { id: 'mailfeedback-table-override', label: 'mail feedback table' },
  };

  private readonly resource: cdk.CustomResource;

  constructor(scope: Construct, id: string, props: MailboxDataOverrideResolverProps) {
    super(scope, id);

    const resolverLambda = new DataOverrideResolverLambda(this, 'handler', {
      artifactResolver: props.artifactResolver,
    });

    const arns = props.tableArns;

    const resolverProps: ResourceProperties = {
      configTableIncomingArn:       arns.configTable,
      configTableOverrideArn:       this.createOverrideReference('configTable', arns.configTable),
      itemTableIncomingArn:         arns.itemTable,
      itemTableOverrideArn:         this.createOverrideReference('itemTable', arns.itemTable),
      changelogTableIncomingArn:    arns.changelogTable,
      changelogTableOverrideArn:    this.createOverrideReference('changelogTable', arns.changelogTable),
      auditLogTableIncomingArn:     arns.auditLogTable,
      auditLogTableOverrideArn:     this.createOverrideReference('auditLogTable', arns.auditLogTable),
      mailFeedbackTableIncomingArn: arns.mailFeedbackTable,
      mailFeedbackTableOverrideArn: this.createOverrideReference('mailFeedbackTable', arns.mailFeedbackTable),
    };

    this.resource = new cdk.CustomResource(this, 'resource', {
      serviceToken:   resolverLambda.functionArn,
      resourceType:   'Custom::MailboxDataOverrideResolver',
      serviceTimeout: cdk.Duration.seconds(120),
      properties:     resolverProps,
    });
  }

  /** The effective ARN of the table of `role`: the operator's override when honored, otherwise the stack's own table. */
  public effectiveTableArn(role: TableRole): string {
    return this.resource.getAttString(`${role}Arn`);
  }

  /**
   * Creates the override parameter of `role`, valued with the stack's own table ARN, and returns the
   * dynamic reference to its live value. CloudFormation resolves the reference before invoking the
   * Lambda, so the Lambda sees the operator's current choice without calling SSM itself.
   */
  private createOverrideReference(role: TableRole, incomingArn: string): string {
    const { id, label } = MailboxDataOverrideResolver.PARAMETERS[role];

    const parameter = new ssm.StringParameter(this, id, {
      parameterName: `/serverlessinbox/${cdk.Aws.STACK_NAME}/data-override/${role}`,
      stringValue:   incomingArn,
      description:   `Operator-overridable ARN for the ${label}. Replace with a restored table ARN to redirect this role.`,
      // The name is a token that starts with "/", which CDK rejects for a simple name.
      simpleName: false,
    });

    return cdk.Fn.join('', ['{{resolve:ssm:', parameter.parameterName, '}}']);
  }
}
