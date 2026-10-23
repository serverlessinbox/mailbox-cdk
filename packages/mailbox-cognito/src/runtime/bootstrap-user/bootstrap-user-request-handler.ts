import {
  InvalidOwnInput,
  toPhysicalResourceId,
  type CustomResourceRequest,
  type LoggerBuffer,
} from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { generateSecurePassword }                                                       from '../../utils/secure-password';
import { toGroupName, toUserPoolId, toUsername }                                        from '../shared/cognito-identifiers';

import { BootstrapUserAnswers, PASSWORD_SET_AT_INSTALL_TIME, type BootstrapUserAnswer } from './bootstrap-user-answers';
import { UserEnsurer, type BootstrapUser }                                              from './ensure-user';
import { isBootstrapUserProperties, type BootstrapUserProperties }                      from './properties';

const DEFAULT_USERNAME        = 'admin';
const DEFAULT_PASSWORD_LENGTH = 16;

/**
 * Answers the CloudFormation requests of the bootstrap user custom resource: a Create or Update makes sure the
 * user exists and reports its password, a Delete leaves the user in place.
 */
export class BootstrapUserRequestHandler {
  private readonly userEnsurer: UserEnsurer;
  private readonly logger: LoggerBuffer;

  constructor(userEnsurer: UserEnsurer, logger: LoggerBuffer) {
    this.userEnsurer = userEnsurer;
    this.logger      = logger;
  }

  /**
   * A Delete is answered without reading its properties. A Create or Update throws an `InvalidOwnInput`, with
   * the password redacted from the properties it carries, when the resource properties are not valid. The password is generated here, once, unless the properties supply one; it
   * is reported only when it was applied to a newly created user.
   */
  public async handle(request: CustomResourceRequest): Promise<BootstrapUserAnswer> {
    if (request.RequestType === 'Delete') {
      return BootstrapUserAnswers.withPasswordMarker();
    }

    const properties        = this.readProperties(request);
    const temporaryPassword = properties.temporaryPassword ?? generateSecurePassword(this.passwordLength(properties));
    const user              = this.toBootstrapUser(properties, temporaryPassword);

    const userWasCreated = await this.ensureUser(user);

    const reportedPassword = userWasCreated ? temporaryPassword : PASSWORD_SET_AT_INSTALL_TIME;
    return this.answerEnsured(request, user, reportedPassword);
  }

  private readProperties(request: CustomResourceRequest): BootstrapUserProperties {
    const errors: string[] = [];
    const properties       = request.ResourceProperties;
    if (!isBootstrapUserProperties(properties, { errors })) {
      throw new InvalidOwnInput('Invalid ResourceProperties', errors, properties);
    }

    this.logger.debug('bootstrap_user_validating', { userPoolIdLength: properties.userPoolId.length });
    return properties;
  }

  /**
   * The length of a generated password: the pool's minimum length, never below the default of 16 characters.
   */
  private passwordLength(properties: BootstrapUserProperties): number {
    // BWCOMPAT(2026-10-23): passwordMinLength may be absent from a template deployed before the property was added;
    // the default applies then. Remove when: every live stack has had a Path 2 template update on/after 2026-10-23.
    const minimumLength = Number(properties.passwordMinLength ?? DEFAULT_PASSWORD_LENGTH);
    return Math.max(DEFAULT_PASSWORD_LENGTH, minimumLength);
  }

  private toBootstrapUser(properties: BootstrapUserProperties, temporaryPassword: string): BootstrapUser {
    return {
      userPoolId: toUserPoolId(properties.userPoolId),
      username:   toUsername(properties.username ?? DEFAULT_USERNAME),
      groups:     (properties.groups ?? []).filter(Boolean).map(toGroupName),
      temporaryPassword,
    };
  }

  private async ensureUser(user: BootstrapUser): Promise<boolean> {
    this.logger.debug('bootstrap_user_ensuring_user');
    const userWasCreated = await this.userEnsurer.ensure(user);
    this.logger.info('bootstrap_user_ensured');
    return userWasCreated;
  }

  private answerEnsured(request: CustomResourceRequest, user: BootstrapUser, reportedPassword: string): BootstrapUserAnswer {
    this.logger.debug('bootstrap_user_sending_success_response');

    if (request.RequestType === 'Create') {
      return BootstrapUserAnswers.withPassword(reportedPassword, toPhysicalResourceId(`BootstrapUser:${user.userPoolId}:${user.username}`));
    }
    return BootstrapUserAnswers.withPassword(reportedPassword);
  }
}
