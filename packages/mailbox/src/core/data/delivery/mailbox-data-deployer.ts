import type { IArtifactResolver }                                                                                         from '@serverlessinbox/artifact-registry-cdk';
import type { ServerlessInboxDeployerType }                                                                               from '@serverlessinbox/mailbox-cdk-shared';
import { ArtifactObject, ComponentDescription, DeployedStack, DeployerInfra, StackIdentity, serverlessInboxSubStackTags } from '@serverlessinbox/mailbox-cdk-shared';
import { IBucket }                                                                                                        from 'aws-cdk-lib/aws-s3';
import { Aws, Stack }                                                                                                     from 'aws-cdk-lib';
import { Construct }                                                                                                      from 'constructs';

import type { IDataBlobStore }                                                                                            from '../../../resources/buckets/data-blob-store';
import { MailboxDataDeployerWorkerLambda }                                                                                from '../../../resources/lambdas/mailbox-data-deployer-worker-lambda';
import type { IDataTable }                                                                                                from '../../../resources/tables/data-tables';
import { MailboxDataStackRef }                                                                                            from '../mailbox-data-stack-ref';
import type { MailboxDataStackParameters }                                                                                from '../mailbox-data-stack';

import { MailboxDataOverrideResolver }                                                                                    from './mailbox-data-override-resolver';

/** Inputs of `MailboxDataDeployer`: the data stack's name and bucket-name base, and the tagging values. */
export interface MailboxDataDeployerProps {
  readonly artifactResolver: IArtifactResolver;
  /** The name of the data stack to deploy. */
  readonly dataStackName: string;
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
  private static readonly TEMPLATE_PACKAGE = 'mailbox-cdk';
  private static readonly TEMPLATE_OBJECT  = 'data-stack-template.json';

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

    const stack     = Stack.of(this);
    const dataStack = new DeployedStack(stack.formatArn({
      service:      'cloudformation',
      resource:     'stack',
      resourceName: `${props.dataStackName}/*`,
    }));

    const infra = new DeployerInfra(this, 'infra', {
      artifactResolver:       props.artifactResolver,
      stateMachineNamePrefix: 'mailbox-data-deployer-',
      deployedStackName:      'data',
      deployedStack:          dataStack,
      createWorker:           (workerScope: Construct, workerId: string) => new MailboxDataDeployerWorkerLambda(workerScope, workerId, {
        artifactResolver: props.artifactResolver,
        stack,
        dataStack,
        dataStackName: props.dataStackName,
        template:      new ArtifactObject(props.artifactResolver, MailboxDataDeployer.TEMPLATE_PACKAGE, MailboxDataDeployer.TEMPLATE_OBJECT),
        nameBase:      props.nameBase,
      }),
    });

    const parameters: MailboxDataStackParameters = {
      nameBase:     props.nameBase,
      rootStack:    Aws.STACK_NAME,
      rootStackId:  StackIdentity.guid,
      deployerType: props.deployerType,
    };

    const resource = infra.deployStack(this, 'resource', 'Custom::MailboxDataDeployer', {
      stackName:        props.dataStackName,
      templateUrl:      props.artifactResolver.getUrl(MailboxDataDeployer.TEMPLATE_PACKAGE, MailboxDataDeployer.TEMPLATE_OBJECT),
      preserveOnDelete: true,
      parameters,
      tags:             serverlessInboxSubStackTags({
        rootStack:   Aws.STACK_NAME,
        rootStackId: StackIdentity.guid,
        stack:       props.dataStackName,
      }),
    });

    // An operator-supplied SSM override replaces a table's ARN, provided the override table exists and is ACTIVE.
    const resolver = new MailboxDataOverrideResolver(this, 'override-resolver', {
      tableArns:        {
        configTable:       resource.getAttString('configTableArn'),
        itemTable:         resource.getAttString('itemTableArn'),
        changelogTable:    resource.getAttString('changelogTableArn'),
        auditLogTable:     resource.getAttString('auditLogTableArn'),
        mailFeedbackTable: resource.getAttString('mailFeedbackTableArn'),
      },
      artifactResolver: props.artifactResolver,
    });
    resolver.node.addDependency(resource);

    const ref = new MailboxDataStackRef(this, 'ref', {
      configTableArn:       resolver.effectiveTableArn('configTable'),
      itemTableArn:         resolver.effectiveTableArn('itemTable'),
      changelogTableArn:    resolver.effectiveTableArn('changelogTable'),
      auditLogTableArn:     resolver.effectiveTableArn('auditLogTable'),
      mailFeedbackTableArn: resolver.effectiveTableArn('mailFeedbackTable'),
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
