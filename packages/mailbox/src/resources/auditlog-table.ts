import { Construct } from 'constructs';
import { StackNamedTable } from '../utils/named-table';
import { AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import { IGrantable, PolicyStatement } from 'aws-cdk-lib/aws-iam';

/**
 * DynamoDB table for audit log
 * 
 * Structure:
 * PK: AUDIT#{entityType}#{entityId}
 * SK: TIMESTAMP#{timestamp}
 * GSI1PK: ACTOR#{userId}
 * GSI1SK: TIMESTAMP#{timestamp}
 * 
 */
export class AuditLogTable extends StackNamedTable {

  constructor(scope: Construct) {
    super(scope, 'auditlog-table', {
      partitionKey: {
        name: 'pk',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'sk',
        type: AttributeType.STRING,
      },
    });

    this.addGlobalSecondaryIndex({
      indexName: 'gsi1',
      partitionKey: { name: 'gsi1pk', type: AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: AttributeType.STRING },
    });

    this.addGlobalSecondaryIndex({
      indexName: 'gsi2',
      partitionKey: { name: 'gsi2pk', type: AttributeType.STRING },
      sortKey: { name: 'gsi2sk', type: AttributeType.STRING },
    });    

    this.addGlobalSecondaryIndex({
      indexName: 'gsi3',
      partitionKey: { name: 'gsi3pk', type: AttributeType.STRING },
      sortKey: { name: 'gsi3sk', type: AttributeType.STRING },
    });    
  }

  public grantReadAccess(grantee: IGrantable) {
    grantee.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: [
        "dynamodb:GetItem",
        "dynamodb:Query",
        // "dynamodb:Scan", // Scan is expensive, avoid using it
        "dynamodb:PutItem",
      ],
      resources: [this.tableArn, `${this.tableArn}/index/*`],
    }));
  }
}
