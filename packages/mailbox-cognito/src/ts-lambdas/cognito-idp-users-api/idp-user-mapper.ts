import type { AdminGetUserCommandOutput, AttributeType, UserStatusType, UserType } from '@aws-sdk/client-cognito-identity-provider';
import { timestampFromDate }                                                       from '@bufbuild/protobuf/wkt';
import { create }                                                                  from '@bufbuild/protobuf';

import { toUsername, type Username }                                               from '../shared/cognito-identifiers';

import { IdpUserSchema, type IdpUser }                                             from './generated/idp_users_pb';

const UNKNOWN_USERNAME = toUsername('unknown');

/** What an IdP user is built from, however Cognito reported the user. */
interface IdpUserFields {
  readonly username: Username;
  readonly enabled: boolean;
  readonly userStatus?: UserStatusType;
  readonly createdAt?: Date;
  readonly modifiedAt?: Date;
  readonly attributes?: AttributeType[];
}

/** The fields of a fetched user that the mapper reads, each of which may be missing from what Cognito returned. */
type FetchedUser = Partial<Pick<AdminGetUserCommandOutput, 'Username' | 'Enabled' | 'UserStatus' | 'UserCreateDate' | 'UserLastModifiedDate' | 'UserAttributes'>>;

/** Maps the users Cognito reports, in a list or on a fetch, to the `IdpUser` the API returns. */
export class IdpUserMapper {
  /** A listed user without a username is named `unknown` and one without an enabled flag is disabled. */
  public fromListedUser(user: UserType): IdpUser {
    return this.toIdpUser({
      username: this.usernameOf(user.Username, UNKNOWN_USERNAME),
      enabled: user.Enabled ?? false,
      userStatus: user.UserStatus,
      createdAt: user.UserCreateDate,
      modifiedAt: user.UserLastModifiedDate,
      attributes: user.Attributes,
    });
  }

  /**
   * A fetched user without a username takes `requestedUsername`. One without an enabled flag takes
   * `enabledFallback` and, absent that, is disabled.
   */
  public fromFetchedUser(output: FetchedUser, requestedUsername: Username, enabledFallback?: boolean): IdpUser {
    return this.toIdpUser({
      username: this.usernameOf(output.Username, requestedUsername),
      enabled: output.Enabled ?? enabledFallback ?? false,
      userStatus: output.UserStatus,
      createdAt: output.UserCreateDate,
      modifiedAt: output.UserLastModifiedDate,
      attributes: output.UserAttributes,
    });
  }

  private usernameOf(reported: string | undefined, fallback: Username): Username {
    return reported === undefined ? fallback : toUsername(reported);
  }

  private toIdpUser(fields: IdpUserFields): IdpUser {
    return create(IdpUserSchema, {
      username: fields.username,
      enabled: fields.enabled,
      userStatus: fields.userStatus,
      createdAt: fields.createdAt ? timestampFromDate(fields.createdAt) : undefined,
      modifiedAt: fields.modifiedAt ? timestampFromDate(fields.modifiedAt) : undefined,
      attributes: this.attributesToMap(fields.attributes),
    });
  }

  private attributesToMap(attributes: AttributeType[] | undefined): Record<string, string> {
    const map: Record<string, string> = {};
    for (const attribute of attributes ?? []) {
      if (attribute.Name && typeof attribute.Value === 'string') {
        map[attribute.Name] = attribute.Value;
      }
    }
    return map;
  }
}
