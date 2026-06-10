import { BillingMode, Table, TableProps } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { removalPolicyForRetainedResources } from './development-mode';

export class BaseTable extends Table {
  constructor(scope: Construct, id: string, props: TableProps) {
    super(scope, id, {
      ...props,
      billingMode: props.billingMode ?? BillingMode.PAY_PER_REQUEST,
      removalPolicy: props.removalPolicy ?? removalPolicyForRetainedResources(scope),
    });
  }
}
