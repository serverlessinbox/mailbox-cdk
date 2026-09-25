import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';
import type { BootstrapUserProperties } from './properties';

/**
 * Ensure a bootstrap user exists in Cognito.
 *
 * If the user does not exist, creates it with the provided password.
 * If the user already exists (UsernameExistsException), leaves it unchanged.
 * Attempts to add the user to groups on a best-effort basis; group errors do not fail the operation.
 *
 * @param cognito - The CognitoIdentityProviderClient (injected for testability)
 * @param props - The resource properties from CloudFormation
 * @param resolvedPassword - The password to set on user creation
 * @returns true if the user was newly created, false if it already existed
 */
export async function ensureUser(
  cognito: CognitoIdentityProviderClient,
  props: BootstrapUserProperties,
  resolvedPassword: string,
): Promise<boolean> {
  const { userPoolId } = props;
  const username = props.username ?? 'admin';
  const groups = (props.groups ?? []).filter(Boolean);

  let userWasCreated = false;

  try {
    await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: username,
        MessageAction: 'SUPPRESS',
        TemporaryPassword: resolvedPassword,
      }),
    );
    userWasCreated = true;
  } catch (err: unknown) {
    if (err instanceof UsernameExistsException || (err as { name?: string }).name === 'UsernameExistsException') {
      // User already exists; leave it unchanged
    } else {
      throw err;
    }
  }

  for (const groupName of groups) {
    try {
      await cognito.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: userPoolId,
          Username: username,
          GroupName: groupName,
        }),
      );
    } catch {
      // best-effort: don't fail the stack if groups are missing or misconfigured
    }
  }

  return userWasCreated;
}
