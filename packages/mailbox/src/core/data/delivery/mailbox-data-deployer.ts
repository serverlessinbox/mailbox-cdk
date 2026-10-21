import type { IArtifactResolver }                                                          from '@serverlessinbox/artifact-registry-cdk';
import type { ServerlessInboxDeployerType }                                                from '@serverlessinbox/mailbox-cdk-shared';
import { ComponentDescription, DeployerInfra, StackIdentity, serverlessInboxSubStackTags } from '@serverlessinbox/mailbox-cdk-shared';
import { IBucket }                                                                         from 'aws-cdk-lib/aws-s3';
import { Aws, Fn, Stack }                                                                  from 'aws-cdk-lib';
import { Construct }                                                                       from 'constructs';

import type { IDataBlobStore }                                                             from '../../../resources/buckets/data-blob-store';
import { MailboxDataDeployerWorkerLambda }                                                 from '../../../resources/lambdas/mailbox-data-deployer-worker-lambda';
import type { IDataTable }                                                                 from '../../../resources/tables/data-tables';
import { MailboxDataStackRef }                                                             from '../mailbox-data-stack-ref';

import { MailboxDataOverrideResolver }                                                     from './mailbox-data-override-resolver';

/** Inputs of `MailboxDataDeployer`: the data stack's name and bucket-name base, and the tagging values. */
export interface MailboxDataDeployerProps {
  readonly artifactResolver: IArtifactResolver;
  /** Resolved data stack name. Defaults to `${AWS::StackName}-data` when omitted. */
  readonly dataStackName?: string;
  /** S3-safe base for bucket names */
  readonly nameBase: string;
  /** Deployment mechanism label, resolved once by the composition root and threaded down for tagging. */
  readonly deployerType: ServerlessInboxDeployerType;
}

/**
 * Deploys the MailboxDataStack (DynamoDB tables + S3 bucket) via a CloudFormation
 * custom resource. The data stack is deployed in the same region as the mailbox stack.
 *
 * Exposes narrow per-table grant interfaces and an IBucket built from the ARNs returned in the
 * custom resource Data dict (i.e. the CloudFormation stack outputs), so that CDK can generate
 * correct IAM policy resource ARNs at deploy time. The raw CDK `ITable`s never leave
 * `MailboxDataStackRef`.
 */
export class MailboxDataDeployer extends Construct {
  public readonly configTable: IDataTable;
  public readonly itemTable: IDataTable;
  public readonly changelogTable: IDataTable;
  public readonly auditLogTable: IDataTable;
  public readonly mailFeedbackTable: IDataTable;

  /** Grant-scoped handle to `blobStoreBucket`. Forwarded from `MailboxDataStackRef`. */
  public readonly blobStore: IDataBlobStore;

  /**
   * The raw imported bucket, forwarded from `MailboxDataStackRef`. Use it only where an actual
   * `IBucket` is required rather than grants on it, which `blobStore`'s grant-only surface cannot
   * provide; everything else should take `blobStore`.
   */
  public readonly blobStoreBucket: IBucket;

  constructor(scope: Construct, id: string, props: MailboxDataDeployerProps) {
    super(scope, id);
    ComponentDescription.describe(this, 'Provisions and retains the data tier (DynamoDB tables + S3 blob store) as a separate stack so mailbox data survives app-stack replacement.');

    const stack         = Stack.of(this);
    const dataStackName = props.dataStackName ?? Fn.join('', [Aws.STACK_NAME, '-data']);
    const dataStackArn  = stack.formatArn({
      service: 'cloudformation',
      resource: 'stack',
      resourceName: `${dataStackName}/*`,
    });

    const infra = new DeployerInfra(this, 'infra', {
      artifactResolver: props.artifactResolver,
      stateMachineNamePrefix: 'mailbox-data-deployer-',
      deployedStackName: 'data',
      deployedStackArn: dataStackArn,
      createWorker: (workerScope: Construct, workerId: string) => new MailboxDataDeployerWorkerLambda(workerScope, workerId, {
        artifactResolver: props.artifactResolver,
        stack,
        dataStackArn,
        dataStackName,
        templateObjectArn: props.artifactResolver.getArn('mailbox-cdk', 'data-stack-template.json'),
        nameBase: props.nameBase,
      }),
    });

    const productVersion = props.artifactResolver.getVersion('mailbox-cdk');

    const resource = infra.deployStack(this, 'resource', 'Custom::MailboxDataDeployer', {
      stackName: dataStackName,
      templateUrl: props.artifactResolver.getUrl('mailbox-cdk', 'data-stack-template.json'),
      preserveOnDelete: true,
      parameters: {
        nameBase: props.nameBase,
        rootStack: Aws.STACK_NAME,
        rootStackId: StackIdentity.guid,
        productVersion,
        deployerType: props.deployerType,
      },
      tags: serverlessInboxSubStackTags({
        rootStack: Aws.STACK_NAME,
        rootStackId: StackIdentity.guid,
        stack: dataStackName,
        version: productVersion,
      }),
    });

    // An operator-supplied SSM override replaces a table's ARN, provided the override table exists and is ACTIVE.
    const resolver = new MailboxDataOverrideResolver(this, 'override-resolver', {
      configTableArn:       resource.getAttString('configTableArn'),
      itemTableArn:         resource.getAttString('itemTableArn'),
      changelogTableArn:    resource.getAttString('changelogTableArn'),
      auditLogTableArn:     resource.getAttString('auditLogTableArn'),
      mailFeedbackTableArn: resource.getAttString('mailFeedbackTableArn'),
      artifactResolver: props.artifactResolver,
    });
    resolver.node.addDependency(resource);

    const ref = new MailboxDataStackRef(this, 'ref', {
      configTableArn:       resolver.getConfigTableArn(),
      itemTableArn:         resolver.getItemTableArn(),
      changelogTableArn:    resolver.getChangelogTableArn(),
      auditLogTableArn:     resolver.getAuditLogTableArn(),
      mailFeedbackTableArn: resolver.getMailFeedbackTableArn(),
      blobStoreArn:         resource.getAttString('blobStoreArn'),
    });

    this.configTable       = ref.configTable;
    this.itemTable         = ref.itemTable;
    this.changelogTable    = ref.changelogTable;
    this.auditLogTable     = ref.auditLogTable;
    this.mailFeedbackTable = ref.mailFeedbackTable;
    this.blobStore         = ref.blobStore;
    this.blobStoreBucket   = ref.blobStoreBucket;
  }
}
