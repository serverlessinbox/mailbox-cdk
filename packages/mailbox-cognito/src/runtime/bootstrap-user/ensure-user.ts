import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  type CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { CaughtError, type LoggerBuffer }       from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import type { GroupName, UserPoolId, Username } from '../shared/cognito-identifiers';

/** A user that must exist in a user pool, the groups it belongs to, and the password it is created with. */
export interface BootstrapUser {
  readonly userPoolId:        UserPoolId;
  readonly username:          Username;
  readonly groups:            readonly GroupName[];
  readonly temporaryPassword: string;
}

/** The outcome of `UserEnsurer.ensure`: whether the user was created now, and the groups it could not be joined to. */
export interface EnsuredUser {
  readonly created:      boolean;
  readonly failedGroups: readonly GroupName[];
}

interface GroupJoinFailure {
  readonly groupName: GroupName;
  readonly error:     string;
}

const USERNAME_EXISTS = 'UsernameExistsException';

/**
 * Makes the bootstrap user exist in a Cognito user pool without touching a user that is already there. It does
 * not choose the password: the caller generates it once and passes it in.
 */
export class UserEnsurer {
  private readonly cognito: CognitoIdentityProviderClient;
  private readonly logger: LoggerBuffer;

  constructor(cognito: CognitoIdentityProviderClient, logger: LoggerBuffer) {
    this.cognito = cognito;
    this.logger  = logger;
  }

  /**
   * Creates the user, or leaves an existing one unchanged, and adds it to its groups. A group that cannot be
   * joined is logged and listed in `failedGroups`. When the user has groups and none of them can be joined, the
   * call throws instead, naming every group with its error.
   */
  public async ensure(user: BootstrapUser): Promise<EnsuredUser> {
    const userWasCreated = await this.createUser(user);
    const failures       = await this.joinGroups(user);

    this.failIfEveryJoinFailed(user, failures);
    return { created: userWasCreated, failedGroups: failures.map((failure) => failure.groupName) };
  }

  private async joinGroups(user: BootstrapUser): Promise<GroupJoinFailure[]> {
    const failures: GroupJoinFailure[] = [];

    for (const groupName of user.groups) {
      const failure = await this.addToGroup(user, groupName);
      if (failure !== undefined) {
        failures.push(failure);
      }
    }

    return failures;
  }

  private failIfEveryJoinFailed(user: BootstrapUser, failures: readonly GroupJoinFailure[]): void {
    if (user.groups.length > 0 && failures.length === user.groups.length) {
      const reasons = failures.map((failure) => `${failure.groupName}: ${failure.error}`).join('; ');
      throw new Error(`No group of the bootstrap user could be joined: ${reasons}`);
    }
  }

  private async createUser(user: BootstrapUser): Promise<boolean> {
    try {
      await this.cognito.send(
        new AdminCreateUserCommand({
          UserPoolId:        user.userPoolId,
          Username:          user.username,
          MessageAction:     'SUPPRESS',
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
    if (CaughtError.is(failure, USERNAME_EXISTS)) {
      return false;
    }
    throw failure;
  }

  private async addToGroup(user: BootstrapUser, groupName: GroupName): Promise<GroupJoinFailure | undefined> {
    try {
      await this.cognito.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: user.userPoolId,
          Username:   user.username,
          GroupName:  groupName,
        }),
      );
      return undefined;
    } catch (failure) {
      const error = CaughtError.readableMessage(failure);
      this.logger.error('bootstrap_user_group_join_failed', { groupName, error });
      return { groupName, error };
    }
  }
}
