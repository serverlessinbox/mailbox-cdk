import {
  CaughtError,
  ExpectedFailure,
  toPhysicalResourceId,
  type CustomResourceRequest,
  type LoggerBuffer,
  type ParentStackStatus,
} from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { generateSecurePassword }                                                       from '../../utils/secure-password';
import { toGroupName, toUserPoolId, toUsername }                                        from '../shared/cognito-identifiers';

import { BootstrapUserAnswers, PASSWORD_SET_AT_INSTALL_TIME, type BootstrapUserAnswer } from './bootstrap-user-answers';
import { UserEnsurer, type BootstrapUser }                                              from './ensure-user';
import { isBootstrapUserProperties, type BootstrapUserProperties }                      from './properties';

const DEFAULT_USERNAME = 'admin';

/**
 * Answers the CloudFormation requests of the bootstrap user custom resource: a Create or Update makes sure the
 * user exists and reports its password, a Delete leaves the user in place.
 */
export class BootstrapUserRequestHandler {
  private readonly userEnsurer: UserEnsurer;
  private readonly parentStackStatus: ParentStackStatus;
  private readonly logger: LoggerBuffer;

  constructor(userEnsurer: UserEnsurer, parentStackStatus: ParentStackStatus, logger: LoggerBuffer) {
    this.userEnsurer       = userEnsurer;
    this.parentStackStatus = parentStackStatus;
    this.logger            = logger;
  }

  /**
   * A Delete is answered without reading its properties. A Create or Update throws an `ExpectedFailure` when the
   * resource properties are not valid. The password is generated here, once, unless the properties supply one; it
   * is reported only when it was applied to a newly created user.
   */
  public async handle(request: CustomResourceRequest): Promise<BootstrapUserAnswer> {
    if (request.RequestType === 'Delete') {
      return BootstrapUserAnswers.withPasswordMarker();
    }

    const properties        = this.readProperties(request);
    const temporaryPassword = properties.temporaryPassword ?? generateSecurePassword();
    const user              = this.toBootstrapUser(properties, temporaryPassword);

    const userWasCreated = await this.ensureUser(user);

    const reportedPassword = userWasCreated ? temporaryPassword : PASSWORD_SET_AT_INSTALL_TIME;
    return this.answerEnsured(request, user, reportedPassword);
  }

  /**
   * Answers an Update that fails while the parent stack rolls back with success, because failing it would leave
   * the stack in UPDATE_ROLLBACK_FAILED. Every other failure is thrown on.
   */
  public async answerFailure(request: CustomResourceRequest, failure: unknown): Promise<BootstrapUserAnswer> {
    const reason = new CaughtError(failure).readableMessage();
    this.logger.error('bootstrap_user_handler_failed', { message: reason });

    if (await this.parentStackIsRollingBack(request)) {
      this.logger.warn('Suppressing error during stack rollback', { error: reason });
      return BootstrapUserAnswers.withPasswordMarker();
    }
    throw failure;
  }

  private readProperties(request: CustomResourceRequest): BootstrapUserProperties {
    const errors: string[] = [];
    const properties       = request.ResourceProperties;
    if (!isBootstrapUserProperties(properties, { errors })) {
      throw new ExpectedFailure(`Invalid ResourceProperties: ${errors.join('; ')}`);
    }

    this.logger.debug('bootstrap_user_validating', { userPoolIdLength: properties.userPoolId.length });
    return properties;
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

  // Only an Update is suppressed: a Create that fails must fail, and the detector is not consulted for it.
  private async parentStackIsRollingBack(request: CustomResourceRequest): Promise<boolean> {
    if (request.RequestType !== 'Update') {
      return false;
    }
    return this.parentStackStatus.isRollingBack(request.StackId);
  }
}
