import type { IArtifactResolver }            from '@serverlessinbox/artifact-registry-cdk';
import type { BaseQueueProps }               from '@serverlessinbox/mailbox-cdk-shared';
import { applyServerlessInboxComponentTag }  from '@serverlessinbox/mailbox-cdk-shared';
import { Construct }                         from 'constructs';

import type { IDataBlobStore }               from '../../resources/buckets/data-blob-store';
import type { IDataTable }                   from '../../resources/tables/data-tables';

import { TantivySearch }                     from './tantivy-search';

/** What {@link SearchSection} uses of the data section. */
export interface ISearchDataInputs {
  readonly configTable:    IDataTable;
  readonly itemTable:      IDataTable;
  readonly changelogTable: IDataTable;
  /** The store the search index is kept in. */
  readonly blobStore: IDataBlobStore;
}

/** Props of {@link SearchSection}. */
export interface SearchSectionProps {
  readonly artifactResolver: IArtifactResolver;
  readonly data:             ISearchDataInputs;
  readonly queueProps?:      Partial<BaseQueueProps>;
}

/** Full-text search over the mailbox items. */
export class SearchSection extends Construct {
  constructor(scope: Construct, id: string, props: SearchSectionProps) {
    super(scope, id);
    applyServerlessInboxComponentTag(this, 'search');

    new TantivySearch(this, 'tantivy-search', {
      indexBucket:      props.data.blobStore,
      itemTable:        props.data.itemTable,
      configTable:      props.data.configTable,
      changelogTable:   props.data.changelogTable,
      artifactResolver: props.artifactResolver,
      queueProps:       props.queueProps,
    });
  }
}
