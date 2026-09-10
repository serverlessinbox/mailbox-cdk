import { BillingMode, Table, TableProps } from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { removalPolicyForRetainedResources } from '@serverlessinbox/mailbox-cdk-shared';

export class BaseTable extends Table {
  constructor(scope: Construct, id: string, props: TableProps) {
    super(scope, id, {
      ...props,
      billingMode: props.billingMode ?? BillingMode.PAY_PER_REQUEST,
      removalPolicy: props.removalPolicy ?? removalPolicyForRetainedResources(scope),
    });
  }

  /**
   * Apply a Deny statement that blocks table enumeration (Scan and all PartiQL actions).
   * This is applied unconditionally to all grant methods to prevent any access path
   * from enumerating table contents across tenant boundaries.
   *
   * Each BaseTable instance applies its own Deny scoped to that table's ARNs. A role
   * granted on multiple tables accumulates one Deny per table, each with its own resource
   * restriction. This ensures coverage follows the set of tables a principal can access.
   */
  private denyEnumeration(grantee: iam.IGrantable): void {
    grantee.grantPrincipal.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.DENY,
        actions: [
          'dynamodb:Scan',
          'dynamodb:PartiQLSelect',
          'dynamodb:PartiQLInsert',
          'dynamodb:PartiQLUpdate',
          'dynamodb:PartiQLDelete',
        ],
        resources: [this.tableArn, `${this.tableArn}/index/*`],
      })
    );
  }

  override grantReadData(grantee: iam.IGrantable): iam.Grant {
    const grant = super.grantReadData(grantee);
    this.denyEnumeration(grantee);
    return grant;
  }

  override grantWriteData(grantee: iam.IGrantable): iam.Grant {
    const grant = super.grantWriteData(grantee);
    this.denyEnumeration(grantee);
    return grant;
  }

  override grantReadWriteData(grantee: iam.IGrantable): iam.Grant {
    const grant = super.grantReadWriteData(grantee);
    this.denyEnumeration(grantee);
    return grant;
  }

  override grantFullAccess(grantee: iam.IGrantable): iam.Grant {
    const grant = super.grantFullAccess(grantee);
    this.denyEnumeration(grantee);
    return grant;
  }

  override grant(grantee: iam.IGrantable, ...actions: string[]): iam.Grant {
    const grant = super.grant(grantee, ...actions);
    this.denyEnumeration(grantee);
    return grant;
  }
}
