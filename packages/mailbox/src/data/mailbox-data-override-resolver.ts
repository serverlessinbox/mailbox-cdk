import * as cdk from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { DataOverrideResolverLambda } from '../lambdas/data-override-resolver';

/** Incoming data table ARNs from the data stack deployer. */
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
  private readonly fn: DataOverrideResolverLambda;
  private readonly resource: cdk.CustomResource;

  constructor(scope: Construct, id: string, props: MailboxDataOverrideResolverProps) {
    super(scope, id);

    this.fn = new DataOverrideResolverLambda(this, 'handler', {
      artifactResolver: props.artifactResolver,
    });

    // Stack-owned override parameters, one per table role, initialised with the stack's own table ARN.
    // simpleName: false because the name is a token that starts with "/".
    const parameterName = (role: string): string => `/serverlessinbox/${cdk.Aws.STACK_NAME}/data-override/${role}`;

    const overrideParameters = {
      configTable: new ssm.StringParameter(this, 'config-table-override', {
        parameterName: parameterName('configTable'),
        stringValue: props.configTableArn,
        description: 'Operator-overridable ARN for the config table. Replace with a restored table ARN to redirect this role.',
        simpleName: false,
      }),
      itemTable: new ssm.StringParameter(this, 'item-table-override', {
        parameterName: parameterName('itemTable'),
        stringValue: props.itemTableArn,
        description: 'Operator-overridable ARN for the item table. Replace with a restored table ARN to redirect this role.',
        simpleName: false,
      }),
      changelogTable: new ssm.StringParameter(this, 'changelog-table-override', {
        parameterName: parameterName('changelogTable'),
        stringValue: props.changelogTableArn,
        description: 'Operator-overridable ARN for the changelog table. Replace with a restored table ARN to redirect this role.',
        simpleName: false,
      }),
      auditLogTable: new ssm.StringParameter(this, 'auditlog-table-override', {
        parameterName: parameterName('auditLogTable'),
        stringValue: props.auditLogTableArn,
        description: 'Operator-overridable ARN for the audit log table. Replace with a restored table ARN to redirect this role.',
        simpleName: false,
      }),
      mailFeedbackTable: new ssm.StringParameter(this, 'mailfeedback-table-override', {
        parameterName: parameterName('mailFeedbackTable'),
        stringValue: props.mailFeedbackTableArn,
        description: 'Operator-overridable ARN for the mail feedback table. Replace with a restored table ARN to redirect this role.',
        simpleName: false,
      }),
    };

    // Build the resolver properties with incoming ARNs and dynamic references to the override parameters.
    // The dynamic references allow the resolver to see the operator's current override choice (if any)
    // without making an SSM call itself.
    const resolverProps: Record<string, string | cdk.IResolvable> = {
      configTableIncomingArn: props.configTableArn,
      configTableOverrideArn: cdk.Fn.join('', ['{{resolve:ssm:', overrideParameters.configTable.parameterName, '}}']),
      itemTableIncomingArn: props.itemTableArn,
      itemTableOverrideArn: cdk.Fn.join('', ['{{resolve:ssm:', overrideParameters.itemTable.parameterName, '}}']),
      changelogTableIncomingArn: props.changelogTableArn,
      changelogTableOverrideArn: cdk.Fn.join('', ['{{resolve:ssm:', overrideParameters.changelogTable.parameterName, '}}']),
      auditLogTableIncomingArn: props.auditLogTableArn,
      auditLogTableOverrideArn: cdk.Fn.join('', ['{{resolve:ssm:', overrideParameters.auditLogTable.parameterName, '}}']),
      mailFeedbackTableIncomingArn: props.mailFeedbackTableArn,
      mailFeedbackTableOverrideArn: cdk.Fn.join('', ['{{resolve:ssm:', overrideParameters.mailFeedbackTable.parameterName, '}}']),
    };

    this.resource = new cdk.CustomResource(this, 'resource', {
      serviceToken: this.fn.functionArn,
      resourceType: 'Custom::MailboxDataOverrideResolver',
      serviceTimeout: cdk.Duration.seconds(120),
      properties: resolverProps,
    });
  }

  getConfigTableArn(): string {
    return this.resource.getAttString('configTableArn');
  }

  getItemTableArn(): string {
    return this.resource.getAttString('itemTableArn');
  }

  getChangelogTableArn(): string {
    return this.resource.getAttString('changelogTableArn');
  }

  getAuditLogTableArn(): string {
    return this.resource.getAttString('auditLogTableArn');
  }

  getMailFeedbackTableArn(): string {
    return this.resource.getAttString('mailFeedbackTableArn');
  }
}
