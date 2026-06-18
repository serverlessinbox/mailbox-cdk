import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';

export interface MailboxCognitoDataStackRefProps {
  readonly userPoolId: string;
  readonly userPoolArn: string;
  readonly oauthDomain: string;
}

/**
 * Wraps CloudFormation output values from MailboxCognitoDataStack into typed CDK constructs.
 * All props are CF token strings passed from resource.getAttString() — no synthesis-time resolution.
 */
export class MailboxCognitoDataStackRef extends Construct {
  public readonly userPool: cognito.IUserPool;
  public readonly userPoolId: string;
  public readonly userPoolArn: string;
  public readonly oauthDomain: string;

  constructor(scope: Construct, id: string, props: MailboxCognitoDataStackRefProps) {
    super(scope, id);

    this.userPool = cognito.UserPool.fromUserPoolArn(this, 'user-pool', props.userPoolArn);
    this.userPoolId = props.userPoolId;
    this.userPoolArn = props.userPoolArn;
    this.oauthDomain = props.oauthDomain;
  }
}
