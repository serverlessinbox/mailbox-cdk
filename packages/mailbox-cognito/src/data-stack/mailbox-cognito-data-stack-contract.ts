import type { ServerlessInboxDeployerType } from '@serverlessinbox/mailbox-cdk-shared';

import { MfaMode }                          from '../user-pool/mfa-mode';

export const DEFAULT_MFA_MODE = MfaMode.OPTIONAL;

export const DEFAULT_PASSWORD_MIN_LENGTH = 8;

/** Composes into the `SERVICE_NAME` of the cognito data stack deployer's starter and worker Lambdas. */
export const COGNITO_DEPLOYED_STACK_NAME = 'cognito';

/** The object name of the cognito data stack's CloudFormation template in the package's artifacts. */
export const COGNITO_DATA_STACK_TEMPLATE_OBJECT = 'cognito-data-stack-template.json';

/** The identifier of the resource server that carries the JMAP scopes. */
export const RESOURCE_SERVER_IDENTIFIER = 'si';

export const ADMIN_GROUP_NAME = 'admin';

export const USER_GROUP_NAME = 'user';

/**
 * The template parameters of the cognito data stack, as the deployer writes them: the stack declares one
 * CloudFormation parameter per key and the deployer supplies a value of this type, so a missing or misspelled
 * name fails the compile. Values are strings because CloudFormation parameters arrive as strings.
 */
export type MailboxCognitoDataStackParameters = {
  readonly cognitoDomainPrefix:  string;
  readonly customDomainName?:    string;
  readonly customDomainCertArn?: string;
  readonly mfaMode:              MfaMode;
  readonly passwordMinLength:    string;
  readonly rootStack:            string;
  readonly rootStackId:          string;
  readonly deployerType:         ServerlessInboxDeployerType;
};
