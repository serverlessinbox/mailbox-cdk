import { BillingMode, Table, TableProps }    from 'aws-cdk-lib/aws-dynamodb';
import { Construct }                         from 'constructs';

import { removalPolicyForRetainedResources } from '../../context/development-mode';

/**
 * A DynamoDB table with pay-per-request billing and the `removalPolicyForRetainedResources` removal
 * policy unless the props say otherwise.
 *
 * Not responsible for the table's name; a subclass or the caller supplies it.
 */
export class BaseTable extends Table {
  constructor(scope: Construct, id: string, props: TableProps) {
    super(scope, id, {
      ...props,
      billingMode:   props.billingMode ?? BillingMode.PAY_PER_REQUEST,
      removalPolicy: props.removalPolicy ?? removalPolicyForRetainedResources(scope),
    });
  }
}
