import { Aws, CustomResource } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { MailboxCognitoDataStackRef } from './mailbox-cognito-data-stack-ref';
import { MailboxCognitoDeployerInfra } from './mailbox-cognito-deployer-infra';
import { grantCognitoDataDeployerPermissions } from './mailbox-cognito-data-deployer-grants';
import { serverlessInboxSubStackTags } from '@serverlessinbox/mailbox-cdk-shared';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';

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
  /** Engine for artifact resolution (threaded from parent MailboxUserPool). */
  readonly artifactResolver: ICdkArtifactEngine;
}

/**
 * Deploys the MailboxCognitoDataStack (Cognito User Pool + OAuth domain + resource server)
 * via a CloudFormation custom resource backed by a Step Functions workflow.
 *
 * The cognito data stack is deployed in the same region as the parent stack, using
 * `Aws.REGION` (never `Stack.of(this).region`) to keep the value as a CloudFormation token.
 *
 * Invariants:
 * - No `Stack.of(this)` anywhere — `Aws.*` tokens only.
 * - `preserveOnDelete: true` — cognito data stack is never deleted on CFN resource removal.
 * - `region: Aws.REGION` — token-safe, resolved at deploy time.
 */
export class MailboxCognitoDataDeployer extends Construct {
  public readonly dataStackRef: MailboxCognitoDataStackRef;

  constructor(scope: Construct, id: string, props: MailboxCognitoDataDeployerProps) {
    super(scope, id);

    const artifacts = props.artifactResolver;

    const deployerInfra = new MailboxCognitoDeployerInfra(this, 'infra', {
      artifactResolver: artifacts,
    });

    // Resolve the cognito data stack template to S3 location.
    const templateUrl = artifacts.getUrl('mailbox-cognito', 'cognito-data-stack-template.json');
    const templateArn = artifacts.getArn('mailbox-cognito', 'cognito-data-stack-template.json');

    // Grant the worker the IAM permissions it needs (CloudFormation + Cognito + S3 template read).
    grantCognitoDataDeployerPermissions(deployerInfra.worker, {
      templateObjectArn: templateArn,
    });

    const productVersion = artifacts.getVersion('mailbox-cognito');
    const cognitoStackName = Aws.STACK_NAME + '-cognito';

    const parameters: Record<string, string> = {
      cognitoDomainPrefix: props.cognitoDomainPrefix,
      mfaMode: props.mfaMode ?? 'OPTIONAL',
      passwordMinLength: String(props.passwordMinLength ?? 8),
      // Correlation tagging: pass the root (main) stack name so the cognito sub-stack's resources
      // carry the same serverless-inbox:root-stack tag. Key MUST match the cognito data stack's
      // CfnParameter overrideLogicalId (rootStack).
      rootStack: Aws.STACK_NAME,
      // Real product version so tags aren't 'unknown'.
      productVersion,
    };
    if (props.customDomain !== undefined) {
      parameters.customDomainName = props.customDomain.domainName;
      parameters.customDomainCertArn = props.customDomain.certificateArn;
    }

    const resource = new CustomResource(this, 'resource', {
      serviceToken: deployerInfra.starter.functionArn,
      resourceType: 'Custom::MailboxCognitoDataDeployer',
      properties: {
        region: Aws.REGION,
        preserveOnDelete: true,
        stackName: cognitoStackName,
        templateUrl,
        parameters,
        // Object-level correlation tags on the cognito AWS::CloudFormation::Stack itself.
        tags: serverlessInboxSubStackTags({
          rootStack: Aws.STACK_NAME,
          stack: cognitoStackName,
          version: productVersion,
        }),
      },
    });

    // Ensure the workflow remains until after the custom resource is deleted.
    resource.node.addDependency(deployerInfra.stateMachine);

    this.dataStackRef = new MailboxCognitoDataStackRef(this, 'ref', {
      userPoolId:  resource.getAttString('userPoolId'),
      userPoolArn: resource.getAttString('userPoolArn'),
      oauthDomain: resource.getAttString('oauthDomain'),
    });
  }
}
