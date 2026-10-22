import type { IArtifactResolver }                                              from '@serverlessinbox/artifact-registry-cdk';
import type { BaseQueueProps, ServerlessInboxDeployerType }                    from '@serverlessinbox/mailbox-cdk-shared';
import { ComponentDescription, applyServerlessInboxComponentTag }              from '@serverlessinbox/mailbox-cdk-shared';
import type { IBucket }                                                        from 'aws-cdk-lib/aws-s3';
import * as cdk                                                                from 'aws-cdk-lib';
import { Aws }                                                                 from 'aws-cdk-lib';
import { Construct }                                                           from 'constructs';

import type { IDataBlobStore }                                                 from '../../resources/buckets/data-blob-store';
import type { IAuditEventsQueue }                                              from '../../resources/queues/audit-events-queue';
import type { IDataTable }                                                     from '../../resources/tables/data-tables';

import { AuditWriting }                                                        from './audit-writing';
import { MailboxDataDeployer }                                                 from './delivery/mailbox-data-deployer';

/** Derives the S3-safe form of a stack name at deploy time. */
export interface IS3SafeStackNameResolver {
  resolveS3SafeStackName(scope: Construct, id: string, stackName: string): string;
}

/** Props of {@link DataSection}. */
export interface DataSectionProps {
  readonly artifactResolver: IArtifactResolver;
  readonly deployerType:     ServerlessInboxDeployerType;
  readonly stackHelpers:     IS3SafeStackNameResolver;
  readonly queueProps?:      Partial<BaseQueueProps>;
}

/** The retained data resources, the audit writer, and the S3-safe stack names. */
export class DataSection extends Construct {
  /** The S3-safe name of the data stack, a deploy-time token. */
  public readonly nameBase: string;
  /** The S3-safe name of the main stack, a deploy-time token. */
  public readonly mainStackNameBase: string;
  public readonly configTable: IDataTable;
  public readonly itemTable: IDataTable;
  public readonly changelogTable: IDataTable;
  public readonly auditLogTable: IDataTable;
  public readonly mailFeedbackTable: IDataTable;
  public readonly blobStore: IDataBlobStore;
  public readonly blobStoreBucket: IBucket;
  public readonly auditEventsQueue: IAuditEventsQueue;

  constructor(scope: Construct, id: string, props: DataSectionProps) {
    super(scope, id);
    applyServerlessInboxComponentTag(this, 'data');

    const effectiveDataStackName = cdk.Fn.join('', [cdk.Aws.STACK_NAME, '-data']);

    this.nameBase = props.stackHelpers.resolveS3SafeStackName(this, 'stack-helpers', effectiveDataStackName);
    ComponentDescription.describe(
      this.node.findChild('stack-helpers'),
      'Deploy-time helper custom resources (e.g. deriving the S3-safe stack names).',
    );

    this.mainStackNameBase = props.stackHelpers.resolveS3SafeStackName(this, 'stack-helpers-main-stack', Aws.STACK_NAME);

    // Retained data resources come from the auto-deployed data stack. Every field on `dataRef` is
    // an `IDataTable` grant interface; no raw `ITable` reaches this scope.
    const dataRef = new MailboxDataDeployer(this, 'data-deployer', {
      artifactResolver: props.artifactResolver,
      nameBase:         this.nameBase,
      deployerType:     props.deployerType,
    });

    this.blobStoreBucket   = dataRef.blobStoreBucket;
    this.blobStore         = dataRef.blobStore;
    this.configTable       = dataRef.configTable;
    this.itemTable         = dataRef.itemTable;
    this.changelogTable    = dataRef.changelogTable;
    this.auditLogTable     = dataRef.auditLogTable;
    this.mailFeedbackTable = dataRef.mailFeedbackTable;

    const auditWriting = new AuditWriting(this, 'audit-writing', {
      auditLogTable:    this.auditLogTable,
      artifactResolver: props.artifactResolver,
      queueProps:       props.queueProps,
    });

    this.auditEventsQueue = auditWriting.auditEventsQueue;
  }
}
