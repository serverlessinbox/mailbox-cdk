import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

import { IArtifactResolver, createArtifactResolverFromContext } from '@sipkg/mailbox';

import { CognitoCustomMessageLambda } from '../lambdas/cognito-custom-message';

export interface MailboxCognitoCustomMessageProps {
  /** The Cognito user pool to attach the trigger to. */
  userPool: cognito.UserPool;

  /** Optional artifact resolver (defaults to context via `createArtifactResolverFromContext`). */
  artifactResolver?: IArtifactResolver;

  /** Optional login URL to include in templates. */
  loginUrl?: string;

  /** Optional support/contact line appended to emails. */
  supportText?: string;
}

/**
 * Attaches the built-in artifact-based Custom Message trigger to a Cognito User Pool.
 *
 * This is an addon construct (keeps `MailboxUserPool` focused on user pool concerns).
 */
export class MailboxCognitoCustomMessage extends Construct {
  public readonly lambda: CognitoCustomMessageLambda;

  constructor(scope: Construct, id: string, props: MailboxCognitoCustomMessageProps) {
    super(scope, id);

    const artifactResolver = props.artifactResolver ?? createArtifactResolverFromContext(this);

    this.lambda = new CognitoCustomMessageLambda(this, 'lambda', {
      artifactResolver,
      loginUrl: props.loginUrl,
      supportText: props.supportText,
    });

    props.userPool.addTrigger(cognito.UserPoolOperation.CUSTOM_MESSAGE, this.lambda.fn);
  }
}
