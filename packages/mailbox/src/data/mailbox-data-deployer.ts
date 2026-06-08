import { Aws, CustomResource, Fn, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { IArtifactResolver } from '../artifacts/artifact-resolver';
import { StackDeployerInfra } from '../utils/stack-deployer-infra';
import { grantDataDeployerWorkerPermissions } from './mailbox-data-deployer-grants';
import { MailboxDataStackRef } from './mailbox-data-stack-ref';

export interface MailboxDataDeployerProps {
  readonly artifactResolver: IArtifactResolver;
  /** Resolved data stack name. Defaults to `${AWS::StackName}-data` when omitted. */
  readonly dataStackName?: string;
}

/**
 * Deploys the MailboxDataStack (DynamoDB tables + S3 bucket) via a CloudFormation
 * custom resource. The data stack is deployed in the same region as the mailbox stack.
 *
 * Exposes `dataStackRef` with SSM parameter paths that consumers can pass to
 * `ssm.StringParameter.valueForStringParameter()`.
 */
export class MailboxDataDeployer extends Construct {
  public readonly dataStackRef: MailboxDataStackRef;

  constructor(scope: Construct, id: string, props: MailboxDataDeployerProps) {
    super(scope, id);

    const stack = Stack.of(this);

    const dataStackName = props.dataStackName ?? Fn.join('', [Aws.STACK_NAME, '-data']);

    const dataStackArn = stack.formatArn({
      service: 'cloudformation',
      resource: 'stack',
      resourceName: `${dataStackName}/*`,
    });

    const infra = new StackDeployerInfra(this, 'infra', {
      artifactResolver: props.artifactResolver,
      stateMachineNamePrefix: 'mailbox-data-deployer-',
    });

    // Read the data stack template from the artifact bucket (regional bucket)
    const templateUrl = props.artifactResolver.getUrl('mailbox-cdk-data', 'template.json');

    grantDataDeployerWorkerPermissions(infra.worker, {
      stack,
      dataStackArn,
      dataStackName,
      templateObjectArn: props.artifactResolver.getArn('mailbox-cdk-data', 'template.json'),
    });

    const resource = new CustomResource(this, 'resource', {
      serviceToken: infra.starter.functionArn,
      resourceType: 'Custom::MailboxDataDeployer',
      properties: {
        stackName: dataStackName,
        templateUrl,
        preserveOnDelete: true,
      },
    });

    // Ensure the workflow remains until after the custom resource is deleted.
    resource.node.addDependency(infra.workflow.stateMachine);

    this.dataStackRef = {
      configTableArnParam: `/${dataStackName}/config-table-arn`,
      itemTableArnParam: `/${dataStackName}/item-table-arn`,
      changelogTableArnParam: `/${dataStackName}/changelog-table-arn`,
      auditLogTableArnParam: `/${dataStackName}/auditlog-table-arn`,
      mailFeedbackTableArnParam: `/${dataStackName}/mailfeedback-table-arn`,
      blobStoreArnParam: `/${dataStackName}/blob-store-arn`,
    };
  }
}
