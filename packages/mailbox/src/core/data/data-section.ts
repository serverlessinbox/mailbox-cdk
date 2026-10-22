import type { IArtifactResolver }                                              from '@serverlessinbox/artifact-registry-cdk';
import type { BaseQueueProps, ServerlessInboxDeployerType }                    from '@serverlessinbox/mailbox-cdk-shared';
import { ComponentDescription, applyServerlessInboxComponentTag }              from '@serverlessinbox/mailbox-cdk-shared';
import type { IBucket }                                                        from 'aws-cdk-lib/aws-s3';
import { Aws, Fn }                                                             from 'aws-cdk-lib';
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
  private static readonly DATA_STACK_HELPERS_ID = 'stack-helpers';
  private static readonly MAIN_STACK_HELPERS_ID = 'stack-helpers-main-stack';

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

    const dataStackName = Fn.join('', [Aws.STACK_NAME, '-data']);

    this.nameBase = props.stackHelpers.resolveS3SafeStackName(this, DataSection.DATA_STACK_HELPERS_ID, dataStackName);
    ComponentDescription.describe(
      this.node.findChild(DataSection.DATA_STACK_HELPERS_ID),
      'Deploy-time helper custom resources (e.g. deriving the S3-safe stack names).',
    );

    this.mainStackNameBase = props.stackHelpers.resolveS3SafeStackName(this, DataSection.MAIN_STACK_HELPERS_ID, Aws.STACK_NAME);

    const dataRef = new MailboxDataDeployer(this, 'data-deployer', {
      dataStackName,
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
