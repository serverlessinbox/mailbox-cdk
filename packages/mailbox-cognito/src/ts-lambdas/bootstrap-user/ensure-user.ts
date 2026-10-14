import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  type CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { CaughtError } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import type { GroupName, UserPoolId, Username } from './cognito-identifiers';

/** A user that must exist in a user pool, the groups it belongs to, and the password it is created with. */
export interface BootstrapUser {
  readonly userPoolId: UserPoolId;
  readonly username: Username;
  readonly groups: readonly GroupName[];
  readonly temporaryPassword: string;
}

const USERNAME_EXISTS = 'UsernameExistsException';

/**
 * Makes the bootstrap user exist in a Cognito user pool without touching a user that is already there. It does
 * not choose the password: the caller generates it once and passes it in.
 */
export class UserEnsurer {
  private readonly cognito: CognitoIdentityProviderClient;

  constructor(cognito: CognitoIdentityProviderClient) {
    this.cognito = cognito;
  }

  /**
   * Creates the user, or leaves an existing one unchanged, and adds it to its groups. A group that cannot be
   * joined does not fail the call. Resolves to true when the user was newly created, false when it already existed.
   */
  public async ensure(user: BootstrapUser): Promise<boolean> {
    const userWasCreated = await this.createUser(user);

    for (const groupName of user.groups) {
      await this.addToGroup(user, groupName);
    }

    return userWasCreated;
  }

  private async createUser(user: BootstrapUser): Promise<boolean> {
    try {
      await this.cognito.send(
        new AdminCreateUserCommand({
          UserPoolId: user.userPoolId,
          Username: user.username,
          MessageAction: 'SUPPRESS',
          TemporaryPassword: user.temporaryPassword,
        }),
      );
      return true;
    } catch (failure) {
      return this.answerCreateFailure(failure);
    }
  }

  // A user that already exists is the expected outcome of a repeated request; any other failure stands.
  private answerCreateFailure(failure: unknown): boolean {
    if (new CaughtError(failure).is(USERNAME_EXISTS)) {
      return false;
    }
    throw failure;
  }

  private async addToGroup(user: BootstrapUser, groupName: GroupName): Promise<void> {
    try {
      await this.cognito.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: user.userPoolId,
          Username: user.username,
          GroupName: groupName,
        }),
      );
    } catch {
      // A group that is missing or misconfigured must not fail the stack.
    }
  }
}
