import { Aws, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { MailboxCognitoDataStackRef } from './mailbox-cognito-data-stack-ref';
import { MailboxCognitoDataDeployerWorker } from './mailbox-cognito-data-deployer-worker';
import { cognitoDataStackName } from './mailbox-cognito-data-stack-name';
import { DeployerInfra, StackIdentity, serverlessInboxSubStackTags } from '@serverlessinbox/mailbox-cdk-shared';
import type { ServerlessInboxDeployerType } from '@serverlessinbox/mailbox-cdk-shared';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';

export interface MailboxCognitoDataDeployerCustomDomain {
  /** Custom domain name for the Cognito OAuth endpoint. */
  readonly domainName: string;
  /** ACM certificate ARN in us-east-1 for the custom domain. */
  readonly certificateArn: string;
}

export interface MailboxCognitoDataDeployerProps {
  /** The Cognito user pool managed domain prefix (must be globally unique across AWS). */
  readonly cognitoDomainPrefix: string;
  /** Optional custom domain. When set, overrides the managed domain for the OAuth endpoint. */
  readonly customDomain?: MailboxCognitoDataDeployerCustomDomain;
  /** MFA enforcement mode. @default 'OPTIONAL' */
  readonly mfaMode?: 'OFF' | 'OPTIONAL' | 'ON';
  /** Minimum password length (6–99). @default 8 */
  readonly passwordMinLength?: number;
  /** Resolver for artifact locations (threaded from parent MailboxUserPool). */
  readonly artifactResolver: IArtifactResolver;
  /** Deployment mechanism label, resolved once by the composition root and threaded down for tagging. */
  readonly deployerType: ServerlessInboxDeployerType;
}

/**
 * Deploys the MailboxCognitoDataStack (Cognito User Pool + OAuth domain + resource server)
 * via a CloudFormation custom resource backed by a Step Functions workflow.
 *
 * The cognito data stack is deployed in the same region as the parent stack. Region and stack
 * name stay `Aws.*` tokens, never `Stack.of(this)` values, so they resolve at deploy time.
 * The custom resource sets `preserveOnDelete`: removing it never deletes the cognito data stack.
 */
export class MailboxCognitoDataDeployer extends Construct {
  public readonly dataStackRef: MailboxCognitoDataStackRef;

  constructor(scope: Construct, id: string, props: MailboxCognitoDataDeployerProps) {
    super(scope, id);

    const artifacts = props.artifactResolver;
    const stackName = cognitoDataStackName();
    const cognitoDataStackArn = Stack.of(this).formatArn({
      service: 'cloudformation',
      partition: Aws.PARTITION,
      region: Aws.REGION,
      account: Aws.ACCOUNT_ID,
      resource: 'stack',
      resourceName: `${stackName}/*`,
    });

    const deployerInfra = new DeployerInfra(this, 'infra', {
      artifactResolver: artifacts,
      stateMachineNamePrefix: 'mailbox-cognito-data-deployer-',
      deployedStackName: 'cognito',
      deployedStackArn: cognitoDataStackArn,
      createWorker: (workerScope: Construct, workerId: string) => new MailboxCognitoDataDeployerWorker(workerScope, workerId, {
        artifactResolver: artifacts,
        templateObjectArn: artifacts.getArn('mailbox-cognito', 'cognito-data-stack-template.json'),
        deployedStackArn: cognitoDataStackArn,
      }),
    });

    const productVersion = artifacts.getVersion('mailbox-cognito');

    const resource = deployerInfra.deployStack(this, 'Custom::MailboxCognitoDataDeployer', {
      region: Aws.REGION,
      preserveOnDelete: true,
      stackName,
      templateUrl: artifacts.getUrl('mailbox-cognito', 'cognito-data-stack-template.json'),
      parameters: this.templateParameters(props, productVersion),
      tags: serverlessInboxSubStackTags({
        rootStack: Aws.STACK_NAME,
        rootStackId: StackIdentity.guid,
        stack: stackName,
        version: productVersion,
      }),
    });

    this.dataStackRef = new MailboxCognitoDataStackRef(this, 'ref', {
      userPoolId:  resource.getAttString('userPoolId'),
      userPoolArn: resource.getAttString('userPoolArn'),
      oauthDomain: resource.getAttString('oauthDomain'),
    });
  }

  private templateParameters(props: MailboxCognitoDataDeployerProps, productVersion: string): Record<string, string> {
    return {
      cognitoDomainPrefix: props.cognitoDomainPrefix,
      mfaMode: props.mfaMode ?? 'OPTIONAL',
      passwordMinLength: String(props.passwordMinLength ?? 8),
      rootStack: Aws.STACK_NAME,
      rootStackId: StackIdentity.guid,
      productVersion,
      deployerType: props.deployerType,
      ...(props.customDomain !== undefined
        ? {
          customDomainName: props.customDomain.domainName,
          customDomainCertArn: props.customDomain.certificateArn,
        }
        : {}),
    };
  }
}
