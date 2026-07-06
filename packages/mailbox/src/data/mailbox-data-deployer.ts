import { Aws, CustomResource, Duration, Fn, Stack } from 'aws-cdk-lib';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import type { ICdkArtifactResolver } from '@serverlessinbox/mailbox-cdk-shared';
import { StackDeployerInfra } from '../features/stack-deployer';
import { grantDataDeployerWorkerPermissions } from './mailbox-data-deployer-grants';
import { MailboxDataStackRef } from './mailbox-data-stack-ref';
import { serverlessInboxSubStackTags } from '../utils/serverless-inbox-tags';

export interface MailboxDataDeployerProps {
  readonly artifactResolver: ICdkArtifactResolver;
  /** Resolved data stack name. Defaults to `${AWS::StackName}-data` when omitted. */
  readonly dataStackName?: string;
  /** S3-safe base for bucket names */
  readonly s3NameBase: string;
}

/**
 * Deploys the MailboxDataStack (DynamoDB tables + S3 bucket) via a CloudFormation
 * custom resource. The data stack is deployed in the same region as the mailbox stack.
 *
 * Exposes typed ITable and IBucket instances built from the ARNs returned in the custom
 * resource Data dict (i.e. the CloudFormation stack outputs), so that CDK can generate
 * correct IAM policy resource ARNs at deploy time.
 */
export class MailboxDataDeployer extends Construct {
  public readonly configTable: ITable;
  public readonly itemTable: ITable;
  public readonly changelogTable: ITable;
  public readonly auditLogTable: ITable;
  public readonly mailFeedbackTable: ITable;
  public readonly blobStore: IBucket;

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

    const infra = new StackDeployerInfra(this, 'infra', {
      artifactResolver: props.artifactResolver,
      stateMachineNamePrefix: 'mailbox-data-deployer-',
    });

    const templateUrl = props.artifactResolver.getUrl('mailbox-cdk', 'data-stack-template.json');

    // Real product version for tagging (same source as the main Mailbox construct), so the data
    // sub-stack's resources get serverless-inbox:version = the actual version, not 'unknown'.
    const productVersion = props.artifactResolver.getVersion('mailbox-cdk');

    grantDataDeployerWorkerPermissions(infra.worker, {
      stack,
      dataStackArn,
      dataStackName: dataStackNameToken,
      templateObjectArn: props.artifactResolver.getArn('mailbox-cdk', 'data-stack-template.json'),
    });

    const resource = new CustomResource(this, 'resource', {
      serviceToken: infra.starter.functionArn,
      resourceType: 'Custom::MailboxDataDeployer',
      serviceTimeout: Duration.hours(1), // caps CFN's default multi-hour wait
      properties: {
        stackName: dataStackNameToken,
        templateUrl,
        preserveOnDelete: true,
        parameters: {
          s3NameBase: props.s3NameBase,
          // Correlation tagging: pass the root (main) stack name so the data sub-stack's resources
          // carry the same serverless-inbox:root-stack tag. Key MUST match the data stack's
          // CfnParameter overrideLogicalId (rootStack).
          rootStack: Aws.STACK_NAME,
          // Real product version so tags aren't 'unknown'.
          productVersion,
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

    // Read table and bucket ARNs from the deployed stack outputs
    // (surfaced as custom resource Data attributes by the stack-deployer handler).
    const ref = new MailboxDataStackRef(this, 'ref', {
      configTableArn:       resource.getAttString('configTableArn'),
      itemTableArn:         resource.getAttString('itemTableArn'),
      changelogTableArn:    resource.getAttString('changelogTableArn'),
      auditLogTableArn:     resource.getAttString('auditLogTableArn'),
      mailFeedbackTableArn: resource.getAttString('mailFeedbackTableArn'),
      blobStoreArn:         resource.getAttString('blobStoreArn'),
    });

    this.configTable       = ref.configTable;
    this.itemTable         = ref.itemTable;
    this.changelogTable    = ref.changelogTable;
    this.auditLogTable     = ref.auditLogTable;
    this.mailFeedbackTable = ref.mailFeedbackTable;
    this.blobStore         = ref.blobStore;
  }
}
