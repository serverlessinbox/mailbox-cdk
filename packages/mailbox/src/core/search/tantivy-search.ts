import type { IArtifactResolver }                    from '@serverlessinbox/artifact-registry-cdk';
import { ComponentDescription, type BaseQueueProps } from '@serverlessinbox/mailbox-cdk-shared';
import * as lambda                                   from 'aws-cdk-lib/aws-lambda';
import { Construct }                                 from 'constructs';

import type { IDataBlobStore }                       from '../../resources/buckets/data-blob-store';
import { TantivyIndexerLambda }                      from '../../resources/lambdas/tantivy-indexer-lambda';
import { TantivyIndexingScheduleDlq }                from '../../resources/queues/tantivy-indexing-schedule-dlq';
import type { IDataTable }                           from '../../resources/tables/data-tables';

export interface TantivySearchProps {
  /**
   * Blob store bucket where indexed emails are stored (shared with incoming emails)
   */
  readonly indexBucket: IDataBlobStore;

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
  readonly artifactResolver: IArtifactResolver;

  /** Optional default props applied to queues created by this construct (e.g. encryption). */
  readonly queueProps?: Partial<BaseQueueProps>;
}

/**
 * Tantivy search infrastructure:
 * - S3 bucket structure: accounts/{accountId}/search-indexes/account-index.tar.gz
 * - Tantivy Indexer Lambda: triggered by EventBridge every 6 hours per stack
 * - Search is performed in-process by api-handler using tantivysearch Go package
 */
export class TantivySearch extends Construct {
  public readonly indexer: lambda.IFunction;

  constructor(scope: Construct, id: string, props: TantivySearchProps) {
    super(scope, id);
    ComponentDescription.describe(this, 'Full-text search — Tantivy (Rust) indexer Lambdas maintaining a search index in S3.');

    // Create Tantivy Indexer Lambda
    // Queries DynamoDB for all emails in an account, builds Tantivy index, uploads to S3
    // Triggered by EventBridge every 6 hours
    // Note: Uses Go with CGO bridge to Rust Tantivy library
    // Rust library is pre-built by build-lambdas.sh before deployment
    const indexingScheduleDlq = new TantivyIndexingScheduleDlq(this, 'tantivy-indexing-schedule-dlq', {
      queueProps: props.queueProps,
    });
    this.indexer              = new TantivyIndexerLambda(this, 'tantivy-indexer', {
      indexBucket:         props.indexBucket,
      itemTable:           props.itemTable,
      configTable:         props.configTable,
      changelogTable:      props.changelogTable,
      artifactResolver:    props.artifactResolver,
      indexingScheduleDlq: indexingScheduleDlq.queue,
    });
  }

  /**
   * Get the indexer Lambda ARN
   */
  get indexerArn(): string {
    return this.indexer.functionArn;
  }
}
