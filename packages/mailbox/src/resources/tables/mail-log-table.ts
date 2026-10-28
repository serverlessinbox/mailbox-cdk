import { AttributeType, BillingMode, ProjectionType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Grant, IGrantable }                                 from 'aws-cdk-lib/aws-iam';
import { RemovalPolicy }                                     from 'aws-cdk-lib';
import { Construct }                                         from 'constructs';

import type { DynamoTableEncryptionProps }                   from './data-table-props';

/**
 * Narrow handle to the mail-log table: the table name, and grant methods that are the only access it
 * offers. Nothing here reads or scans the table.
 */
export interface IMailLogTable {
  /** The table's physical name. */
  readonly tableName: string;

  /** Grants `dynamodb:PutItem` on the table, and the KMS write actions on its key when one is set. */
  grantWrite(grantee: IGrantable): void;

  /** Grants `dynamodb:GetItem` and `dynamodb:Query` on the table and its indexes, and the KMS read actions on its key when one is set. */
  grantRead(grantee: IGrantable): void;
}

/**
 * The mail-log table: one row per recipient of each inbound message, expiring through the `ttl`
 * attribute. Auto-named, removed with its stack, without point-in-time recovery.
 */
export class MailLogTable extends Table implements IMailLogTable {
  constructor(scope: Construct, id: string, props: DynamoTableEncryptionProps) {
    super(scope, id, {
      partitionKey:        { name: 'pk', type: AttributeType.STRING },
      sortKey:             { name: 'sk', type: AttributeType.STRING },
      billingMode:         BillingMode.PAY_PER_REQUEST,
      encryption:          props.encryption,
      encryptionKey:       props.encryptionKey,
      timeToLiveAttribute: 'ttl',
      removalPolicy:       RemovalPolicy.DESTROY,
    });

    this.addGlobalSecondaryIndex({
      indexName:      'gsi1',
      partitionKey:   { name: 'gsi1pk', type: AttributeType.STRING },
      sortKey:        { name: 'gsi1sk', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    this.addGlobalSecondaryIndex({
      indexName:      'gsi2',
      partitionKey:   { name: 'gsi2pk', type: AttributeType.STRING },
      sortKey:        { name: 'gsi2sk', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });
  }

  public grantWrite(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions:      ['dynamodb:PutItem'],
      resourceArns: [this.tableArn],
    });

    if (this.encryptionKey) {
      Grant.addToPrincipal({
        grantee,
        actions:      ['kms:Decrypt', 'kms:DescribeKey', 'kms:Encrypt', 'kms:GenerateDataKey'],
        resourceArns: [this.encryptionKey.keyArn],
      });
    }
  }

  public grantRead(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions:      ['dynamodb:GetItem', 'dynamodb:Query'],
      resourceArns: [this.tableArn, `${this.tableArn}/index/*`],
    });

    if (this.encryptionKey) {
      Grant.addToPrincipal({
        grantee,
        actions:      ['kms:Decrypt', 'kms:DescribeKey'],
        resourceArns: [this.encryptionKey.keyArn],
      });
    }
  }
}
