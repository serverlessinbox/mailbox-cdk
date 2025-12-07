import { RemovalPolicy } from 'aws-cdk-lib';
import { BillingMode, GlobalSecondaryIndexProps, Table, TableProps } from 'aws-cdk-lib/aws-dynamodb';
import { Effect, Grant, IGrantable, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

/**
 * Base DynamoDB table construct with on-demand billing by default
 * All new DynamoDB tables should extend this class to ensure consistent configuration
 */
export class BaseTable extends Table {
  gsiIndexNames: string[] = [];

  constructor(
    scope: Construct,
    id: string,
    props: TableProps
  ) {
    super(scope, id, {
      ...props,
      // Default to on-demand billing
      billingMode: props.billingMode ?? BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });
  }

  addGlobalSecondaryIndex(props: GlobalSecondaryIndexProps) {
    this.gsiIndexNames.push(props.indexName);
    super.addGlobalSecondaryIndex(props);
  }

  grantReadData(grantee: IGrantable): Grant {
    const grant = super.grantReadData(grantee);
    
    // Also grant read access to all GSI indexes
    grantee.grantPrincipal.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'dynamodb:GetItem',
          'dynamodb:Query',
          'dynamodb:Scan',
          'dynamodb:BatchGetItem',
        ],
        resources: this.gsiIndexNames.map(
          (indexName) => `${this.tableArn}/index/${indexName}`
        ),
      })
    );
    
    return grant;
  }

  grantWriteData(grantee: IGrantable): Grant {
    const grant = super.grantWriteData(grantee);
    
    // Also grant write access to all GSI indexes
    grantee.grantPrincipal.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:DeleteItem',
          'dynamodb:BatchWriteItem',
        ],
        resources: this.gsiIndexNames.map(
          (indexName) => `${this.tableArn}/index/${indexName}`
        ),
      })
    );
    
    return grant;
  }

}
