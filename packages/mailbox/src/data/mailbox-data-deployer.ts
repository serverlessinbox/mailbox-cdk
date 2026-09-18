import { Aws, CustomResource, Duration, Fn, Stack } from 'aws-cdk-lib';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import type { ICdkArtifactEngine, ServerlessInboxDeployerType } from '@serverlessinbox/mailbox-cdk-shared';
import { DeployerInfra, serverlessInboxSubStackTags } from '@serverlessinbox/mailbox-cdk-shared';
import { MailboxDataDeployerWorker } from './mailbox-data-deployer-worker';
import { MailboxDataStackRef } from './mailbox-data-stack-ref';
import { MailboxDataOverrideResolver } from './mailbox-data-override-resolver';
import type { IDataTable } from './data-tables';
import type { IDataBlobStore } from './data-blob-store';

export interface MailboxDataDeployerProps {
  readonly artifactResolver: ICdkArtifactEngine;
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
 * correct IAM policy resource ARNs at deploy time. Internal only (not reachable from
 * `src/index.ts`) — the raw CDK `ITable`s never leave `MailboxDataStackRef`.
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
   * The raw imported bucket, forwarded from `MailboxDataStackRef`. Only its two named consumers
   * (`features/cdn/cdn-construct.ts`, `email/receiving/ses-rules.ts`) should use this — see that
   * class's own comment for why. Every other consumer should take `blobStore`.
   */
  public readonly blobStoreBucket: IBucket;

  constructor(scope: Construct, id: string, props: MailboxDataDeployerProps) {
    super(scope, id);

    const stack = Stack.of(this);

    // CFN token for use as CloudFormation stack name parameter in the custom resource
    // and for formatArn of the CFN stack ARN.
    const dataStackNameToken = props.dataStackName ?? Fn.join('', [Aws.STACK_NAME, '-data']);

    const dataStackArn = stack.formatArn({
      service: 'cloudformation',
      resource: 'stack',
      resourceName: `${dataStackNameToken}/*`,
    });

    const infra = new DeployerInfra(this, 'infra', {
      artifactResolver: props.artifactResolver,
      stateMachineNamePrefix: 'mailbox-data-deployer-',
      parent: 'data',
      createWorker: (workerScope: Construct, workerId: string) => new MailboxDataDeployerWorker(workerScope, workerId, {
        artifactResolver: props.artifactResolver,
        stack,
        dataStackArn,
        dataStackName: dataStackNameToken,
        templateObjectArn: props.artifactResolver.getArn('mailbox-cdk', 'data-stack-template.json'),
        nameBase: props.nameBase,
      }),
    });

    const templateUrl = props.artifactResolver.getUrl('mailbox-cdk', 'data-stack-template.json');

    // Real product version for tagging (same source as the main Mailbox construct), so the data
    // sub-stack's resources get serverless-inbox:version = the actual version, not 'unknown'.
    const productVersion = props.artifactResolver.getVersion('mailbox-cdk');

    const resource = new CustomResource(this, 'resource', {
      serviceToken: infra.starter.functionArn,
      resourceType: 'Custom::MailboxDataDeployer',
      serviceTimeout: Duration.hours(1), // caps CFN's default multi-hour wait
      properties: {
        stackName: dataStackNameToken,
        templateUrl,
        preserveOnDelete: true,
        parameters: {
          nameBase: props.nameBase,
          // Correlation tagging: pass the root (main) stack name so the data sub-stack's resources
          // carry the same serverless-inbox:root-stack tag. Key MUST match the data stack's
          // CfnParameter overrideLogicalId (rootStack).
          rootStack: Aws.STACK_NAME,
          // Real product version so tags aren't 'unknown'.
          productVersion,
          deployerType: props.deployerType,
        },
        // Object-level correlation tags on the data AWS::CloudFormation::Stack itself.
        tags: serverlessInboxSubStackTags({
          rootStack: Aws.STACK_NAME,
          stack: dataStackNameToken,
          version: productVersion,
        }),
      },
    });

    // Ensure the workflow remains until after the custom resource is deleted.
    resource.node.addDependency(infra.workflow.stateMachine);

    // Resolve data table ARNs through the override resolver: an operator-supplied SSM override replaces a
    // table's ARN, provided the override table exists and is ACTIVE.
    const resolver = new MailboxDataOverrideResolver(this, 'override-resolver', {
      configTableArn:       resource.getAttString('configTableArn'),
      itemTableArn:         resource.getAttString('itemTableArn'),
      changelogTableArn:    resource.getAttString('changelogTableArn'),
      auditLogTableArn:     resource.getAttString('auditLogTableArn'),
      mailFeedbackTableArn: resource.getAttString('mailFeedbackTableArn'),
      artifactResolver: props.artifactResolver,
    });
    resolver.node.addDependency(resource);

    // Read table and bucket ARNs from the deployed stack outputs and the resolver override
    // (surfaced as custom resource Data attributes by the stack-deployer handler and resolver).
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
