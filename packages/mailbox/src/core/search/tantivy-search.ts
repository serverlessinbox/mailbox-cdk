import type { IArtifactResolver }                    from '@serverlessinbox/artifact-registry-cdk';
import { ComponentDescription, type BaseQueueProps } from '@serverlessinbox/mailbox-cdk-shared';
import { Construct }                                 from 'constructs';

import type { IDataBlobStore }                       from '../../resources/buckets/data-blob-store';
import { TantivyIndexerLambda }                      from '../../resources/lambdas/tantivy-indexer-lambda';
import { TantivyIndexingScheduleDlq }                from '../../resources/queues/tantivy-indexing-schedule-dlq';
import type { IDataTable }                           from '../../resources/tables/data-tables';

/** Props of {@link TantivySearch}: the stores the indexer reads and writes, and the code of its Lambda. */
export interface TantivySearchProps {
  readonly indexBucket:      IDataBlobStore;
  readonly itemTable:        IDataTable;
  readonly configTable:      IDataTable;
  readonly changelogTable:   IDataTable;
  readonly artifactResolver: IArtifactResolver;

  /** Optional default props applied to queues created by this construct (e.g. encryption). */
  readonly queueProps?: Partial<BaseQueueProps>;
}

/** The full-text search infrastructure: the Lambda that builds the search index, and the dead-letter queue of its schedule. */
export class TantivySearch extends Construct {
  constructor(scope: Construct, id: string, props: TantivySearchProps) {
    super(scope, id);
    ComponentDescription.describe(this, 'Full-text search — Tantivy (Rust) indexer Lambdas maintaining a search index in S3.');

    const indexingScheduleDlq = new TantivyIndexingScheduleDlq(this, 'tantivy-indexing-schedule-dlq', {
      queueProps: props.queueProps,
    });

    new TantivyIndexerLambda(this, 'tantivy-indexer', {
      indexBucket:         props.indexBucket,
      itemTable:           props.itemTable,
      configTable:         props.configTable,
      changelogTable:      props.changelogTable,
      artifactResolver:    props.artifactResolver,
      indexingScheduleDlq: indexingScheduleDlq.queue,
    });
  }
}
