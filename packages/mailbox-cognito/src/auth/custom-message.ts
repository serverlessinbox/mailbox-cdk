import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

import { IArtifactResolver, createArtifactResolverFromContext } from '@serverlessinbox/mailbox';

import { CognitoCustomMessageLambda } from '../lambdas/cognito-custom-message';

export interface MailboxCognitoCustomMessageProps {
  /** The Cognito user pool to attach the trigger to. */
  readonly userPool: cognito.UserPool;

  /** Optional artifact resolver (defaults to context via `createArtifactResolverFromContext`). */
  readonly artifactResolver?: IArtifactResolver;

  /** Optional login URL to include in templates. */
  readonly loginUrl?: string;

  /** Optional support/contact line appended to emails. */
  readonly supportText?: string;
}


/**
 * Attaches the built-in artifact-based Custom Message trigger to a Cognito User Pool.
 *
 * This is an addon construct (keeps `MailboxUserPool` focused on user pool concerns).
 */
export class MailboxCognitoCustomMessage extends Construct {
  /** @internal */
  private readonly _lambdaConstruct: CognitoCustomMessageLambda;

  /** The underlying CDK construct wrapping the Lambda function. */
  public readonly lambdaFunction: Construct;

  constructor(scope: Construct, id: string, props: MailboxCognitoCustomMessageProps) {
    super(scope, id);

    const artifactResolver = props.artifactResolver ?? createArtifactResolverFromContext(this);

    this._lambdaConstruct = new CognitoCustomMessageLambda(this, 'lambda', {
      artifactResolver,
      loginUrl: props.loginUrl,
      supportText: props.supportText,
    });
    this.lambdaFunction = this._lambdaConstruct;

    props.userPool.addTrigger(cognito.UserPoolOperation.CUSTOM_MESSAGE, this._lambdaConstruct.fn);
  }
}
