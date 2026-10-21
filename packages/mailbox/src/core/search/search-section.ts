import type { IArtifactResolver }            from '@serverlessinbox/artifact-registry-cdk';
import type { BaseQueueProps }               from '@serverlessinbox/mailbox-cdk-shared';
import { applyServerlessInboxComponentTag }  from '@serverlessinbox/mailbox-cdk-shared';
import { Construct }                         from 'constructs';

import type { IDataBlobStore }               from '../../resources/buckets/data-blob-store';
import type { IDataTable }                   from '../../resources/tables/data-tables';

import { TantivySearch }                     from './tantivy-search';

/** Props of {@link SearchSection}. */
export interface SearchSectionProps {
  readonly artifactResolver: IArtifactResolver;
  readonly configTable: IDataTable;
  readonly itemTable: IDataTable;
  readonly changelogTable: IDataTable;
  /** The store the search index is kept in. */
  readonly blobStore: IDataBlobStore;
  readonly queueProps?: Partial<BaseQueueProps>;
}

/** Full-text search over the mailbox items. */
export class SearchSection extends Construct {
  constructor(scope: Construct, id: string, props: SearchSectionProps) {
    super(scope, id);
    applyServerlessInboxComponentTag(this, 'search');

    new TantivySearch(this, 'tantivy-search', {
      indexBucket: props.blobStore,
      itemTable: props.itemTable,
      configTable: props.configTable,
      changelogTable: props.changelogTable,
      artifactResolver: props.artifactResolver,
      queueProps: props.queueProps,
    });
  }
}
