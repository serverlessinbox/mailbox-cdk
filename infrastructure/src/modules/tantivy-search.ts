import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { GoLambda } from '../utils/go-lambda';
import { ILambdaCodeProvider } from '../utils/lambda-code-provider';

export interface TantivySearchProps {
  /**
   * S3 bucket where indexed emails are stored (shared with incoming emails)
   */
  indexBucket: s3.IBucket;

  /**
   * DynamoDB ItemTable for querying emails
   */
  itemTable: dynamodb.ITable;

  /**
   * DynamoDB ConfigTable for account and mailbox configuration
   */
  configTable: dynamodb.ITable;

  /**
   * DynamoDB ChangelogTable for tracking state changes
   */
  changelogTable: dynamodb.ITable;

  /**
   * Lambda code provider for building/downloading lambdas
   */
  codeProvider: ILambdaCodeProvider;
}

/**
 * Tantivy search infrastructure:
 * - S3 bucket structure: accounts/{accountId}/search-indexes/account-index.tar.gz
 * - Tantivy Indexer Lambda: triggered by EventBridge every hour per stack
 * - Search is performed in-process by api-handler using tantivysearch Go package
 */
export class TantivySearch extends Construct {
  public readonly indexer: lambda.IFunction;

  constructor(scope: Construct, id: string, props: TantivySearchProps) {
    super(scope, id);

    const itemTableName = props.itemTable.tableName;
    const indexBucketName = props.indexBucket.bucketName;
    const configTableName = props.configTable.tableName;
    const changelogTableName = props.changelogTable.tableName;

    // Create Tantivy Indexer Lambda
    // Queries DynamoDB for all emails in an account, builds Tantivy index, uploads to S3
    // Triggered by EventBridge every hour
    // Note: Uses Go with CGO bridge to Rust Tantivy library
    // Rust library is pre-built by build-lambdas.sh before deployment
    this.indexer = new GoLambda(this, 'TantivyIndexer', {
      lambdaId: 'tantivy-indexer',
      codeProvider: props.codeProvider,
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024, // More memory for faster Tantivy indexing
      environment: {
        INDEX_BUCKET_NAME: indexBucketName,
        ITEM_TABLE_NAME: itemTableName,
        CONFIG_TABLE_NAME: configTableName,
        CHANGELOG_TABLE_NAME: changelogTableName,
      },
    });

    // Grant Indexer Lambda access to S3 (read/write for uploading indexes)
    props.indexBucket.grantReadWrite(this.indexer);

    // Grant Indexer Lambda access to DynamoDB ItemTable (read only for querying emails)
    // This will automatically include GSI permissions
    props.itemTable.grantReadData(this.indexer);

    // Grant Indexer Lambda access to DynamoDB ConfigTable (read only for account config)
    props.configTable.grantReadData(this.indexer);

    // Grant Indexer Lambda access to DynamoDB ChangelogTable (read/write for tracking changes)
    props.changelogTable.grantReadWriteData(this.indexer);

    // EventBridge rule to trigger indexer every hour
    // In production, this would be per-account with a DynamoDB table tracking accounts
    // For now, we trigger once per stack
    const indexingSchedule = new events.Rule(this, 'TantivyIndexingSchedule', {
      schedule: events.Schedule.rate(cdk.Duration.hours(1)),
      description: 'Trigger Tantivy indexing every hour',
    });

    // Add target to EventBridge rule: invoke the indexer Lambda
    indexingSchedule.addTarget(
      new targets.LambdaFunction(this.indexer, {
        deadLetterQueue: new sqs.Queue(this, 'IndexingScheduleDLQ', {
          queueName: 'tantivy-indexing-schedule-dlq',
          retentionPeriod: cdk.Duration.days(14),
        }),
      })
    );
  }

  /**
   * Grant a construct permission to invoke the indexer Lambda
   */
  grantInvokeIndexer(grantable: iam.IGrantable): void {
    this.indexer.grantInvoke(grantable);
  }

  /**
   * Get the indexer Lambda ARN
   */
  get indexerArn(): string {
    return this.indexer.functionArn;
  }
}
