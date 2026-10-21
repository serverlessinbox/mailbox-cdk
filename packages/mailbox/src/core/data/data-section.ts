import type { IArtifactResolver }                                              from '@serverlessinbox/artifact-registry-cdk';
import type { BaseQueueProps, ServerlessInboxDeployerType }                    from '@serverlessinbox/mailbox-cdk-shared';
import type { StackHelpersMailboxData, StackHelpersMailboxDataProps }          from '@serverlessinbox/mailbox-cdk-shared';
import { applyServerlessInboxComponentTag }                                    from '@serverlessinbox/mailbox-cdk-shared';
import type { IBucket }                                                        from 'aws-cdk-lib/aws-s3';
import * as cdk                                                                from 'aws-cdk-lib';
import { Aws }                                                                 from 'aws-cdk-lib';
import { Construct }                                                           from 'constructs';

import type { IDataBlobStore }                                                 from '../../resources/buckets/data-blob-store';
import type { IAuditEventsQueue }                                              from '../../resources/queues/audit-events-queue';
import type { IDataTable }                                                     from '../../resources/tables/data-tables';

import { AuditWriting }                                                        from './audit-writing';
import { MailboxDataDeployer }                                                 from './delivery/mailbox-data-deployer';

/** Derives the domain name and the S3-safe stack name at deploy time. */
export interface IMailboxDataResolver {
  resolveMailboxData(scope: Construct, id: string, props: StackHelpersMailboxDataProps): StackHelpersMailboxData;
}

/** Props of {@link DataSection}. */
export interface DataSectionProps {
  readonly artifactResolver: IArtifactResolver;
  readonly deployerType: ServerlessInboxDeployerType;
  readonly stackHelpers: IMailboxDataResolver;
  readonly hostedZoneId?: string;
  readonly queueProps?: Partial<BaseQueueProps>;
}

/** The retained data resources, the audit writer, and the stack names derived from the hosted zone. */
export class DataSection extends Construct {
  /** The domain name of the hosted zone, a deploy-time token. */
  public readonly derivedDomainName: string;
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

    // Derive domain name and S3-safe stack name from hosted zone at deploy time.
    const effectiveDataStackName = cdk.Fn.join('', [cdk.Aws.STACK_NAME, '-data']);

    const { derivedDomainName, derivedS3SafeDataStackName } = props.stackHelpers.resolveMailboxData(
      this, 'stack-helpers', { hostedZoneId: props.hostedZoneId ?? '', dataStackName: effectiveDataStackName },
    );

    // Derive S3-safe main stack name (no domain lookup needed, so hostedZoneId is empty)
    const { derivedS3SafeDataStackName: mainStackNameBase } = props.stackHelpers.resolveMailboxData(
      this, 'stack-helpers-main-stack', { hostedZoneId: '', dataStackName: Aws.STACK_NAME },
    );

    this.derivedDomainName = derivedDomainName;
    this.nameBase          = derivedS3SafeDataStackName;
    this.mainStackNameBase = mainStackNameBase;

    // Retained data resources come from the auto-deployed data stack. Every field on `dataRef` is
    // an `IDataTable` grant interface; no raw `ITable` reaches this scope.
    const dataRef = new MailboxDataDeployer(this, 'data-deployer', {
      artifactResolver: props.artifactResolver,
      nameBase: this.nameBase,
      deployerType: props.deployerType,
    });

    this.blobStoreBucket   = dataRef.blobStoreBucket;
    this.blobStore         = dataRef.blobStore;
    this.configTable       = dataRef.configTable;
    this.itemTable         = dataRef.itemTable;
    this.changelogTable    = dataRef.changelogTable;
    this.auditLogTable     = dataRef.auditLogTable;
    this.mailFeedbackTable = dataRef.mailFeedbackTable;

    const auditWriting = new AuditWriting(this, 'audit-writing', {
      auditLogTable: this.auditLogTable,
      artifactResolver: props.artifactResolver,
      queueProps: props.queueProps,
    });

    this.auditEventsQueue = auditWriting.auditEventsQueue;
  }
}
