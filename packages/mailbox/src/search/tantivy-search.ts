import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { TantivyIndexerLambda } from '../lambdas';
import { type BaseQueueProps } from '@serverlessinbox/mailbox-cdk-shared';
import { TantivyIndexingScheduleDlq } from './tantivy-indexing-schedule-dlq';
import type { IDataTable } from '../data/data-tables';

export interface TantivySearchProps {
  /**
   * S3 bucket where indexed emails are stored (shared with incoming emails)
   */
  readonly indexBucket: s3.IBucket;

  /**
   * DynamoDB ItemTable for querying emails
   */
  readonly itemTable: IDataTable;

  /**
   * DynamoDB ConfigTable for account and mailbox configuration
   */
  readonly configTable: IDataTable;

  /**
   * DynamoDB ChangelogTable for tracking state changes
   */
  readonly changelogTable: IDataTable;

  /**
   * Lambda code provider for building/downloading lambdas
   */
  readonly artifactResolver: ICdkArtifactEngine;

  /** Optional default props applied to queues created by this construct (e.g. encryption). */
  readonly queueProps?: Partial<BaseQueueProps>;
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

    // Create Tantivy Indexer Lambda
    // Queries DynamoDB for all emails in an account, builds Tantivy index, uploads to S3
    // Triggered by EventBridge every hour
    // Note: Uses Go with CGO bridge to Rust Tantivy library
    // Rust library is pre-built by build-lambdas.sh before deployment
    this.indexer = new TantivyIndexerLambda(this, 'tantivy-indexer', {
      indexBucket: props.indexBucket,
      itemTable: props.itemTable,
      configTable: props.configTable,
      changelogTable: props.changelogTable,
      artifactResolver: props.artifactResolver,
    });

    // EventBridge rule to trigger indexer every hour
    // In production, this would be per-account with a DynamoDB table tracking accounts
    // For now, we trigger once per stack
    const indexingSchedule = new events.Rule(this, 'tantivy-indexing-schedule', {
      schedule: events.Schedule.rate(cdk.Duration.hours(1)),
      description: 'Trigger Tantivy indexing every hour',
    });

    // Add target to EventBridge rule: invoke the indexer Lambda
    const indexingScheduleDlq = new TantivyIndexingScheduleDlq(this, 'tantivy-indexing-schedule-dlq', {
      queueProps: props.queueProps,
    });
    indexingSchedule.addTarget(
      new targets.LambdaFunction(this.indexer, {
        deadLetterQueue: indexingScheduleDlq.queue,
      }),
    );
  }

  /**
   * Get the indexer Lambda ARN
   */
  get indexerArn(): string {
    return this.indexer.functionArn;
  }
}
