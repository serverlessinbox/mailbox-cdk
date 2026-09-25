import { wrapHandler } from 'aws-custom-resources';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { withSmokeTest, emitManualFinalize, env, LoggerBuffer, isParentStackRollingBack } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { load } from './config';
import { generateSecurePassword, PASSWORD_SET_AT_INSTALL_TIME } from './password';
import { schema, type BootstrapUserProperties } from './properties';
import { ensureUser } from './ensure-user';

const cognito = new CognitoIdentityProviderClient({});
const { config, error: configError } = env.tryLoad(load);

export const handler = withSmokeTest(
  wrapHandler(async (event) => {
    if (configError) {
      // On Delete with config error, respond SUCCESS to not block stack deletion
      if (event.RequestType === 'Delete') {
        return {
          Data: {
            temporaryPassword: PASSWORD_SET_AT_INSTALL_TIME,
          },
        };
      }
      throw new Error(configError);
    }

    const logger = new LoggerBuffer(config.serviceName, config.logLevel);

    emitManualFinalize(event, { service: config.serviceName });

    try {
      const errors: string[] = [];
      const props = event.ResourceProperties;
      if (!schema(props, { errors })) {
        throw new Error(`Invalid ResourceProperties: ${errors.join('; ')}`);
      }
      const resourceProps: BootstrapUserProperties = props;

      if (event.RequestType === 'Delete') {
        return {
          Data: {
            temporaryPassword: PASSWORD_SET_AT_INSTALL_TIME,
          },
        };
      }

      const physicalResourceId = `BootstrapUser:${resourceProps.userPoolId}:${resourceProps.username ?? 'admin'}`;

      // For Create or Update: ensure the user exists
      logger.debug('bootstrap_user_validating', { userPoolIdLength: String(resourceProps.userPoolId).length });

      // Generate password exactly once at this layer; pass resolved value to ensureUser.
      // ensureUser receives it as a parameter and never generates its own.
      const suppliedPassword = resourceProps.temporaryPassword;
      const resolvedPassword = suppliedPassword ?? generateSecurePassword();

      logger.debug('bootstrap_user_ensuring_user');
      const userWasCreated = await ensureUser(cognito, resourceProps, resolvedPassword);

      // Only report the password if it was actually applied to a newly created user.
      // If the user already existed, the password was not applied, so report the marker.
      const reportedPassword = userWasCreated ? resolvedPassword : PASSWORD_SET_AT_INSTALL_TIME;

      logger.info('bootstrap_user_ensured');

      logger.debug('bootstrap_user_sending_success_response');

      if (event.RequestType === 'Create') {
        return {
          PhysicalResourceId: physicalResourceId,
          Data: {
            temporaryPassword: reportedPassword,
          },
        };
      }

      return {
        Data: {
          temporaryPassword: reportedPassword,
        },
      };
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      logger.error('bootstrap_user_handler_failed', { message });
      logger.flush();

      // During parent-stack rollback on Update, send SUCCESS to allow rollback to complete
      // instead of failing and leaving the stack in UPDATE_ROLLBACK_FAILED.
      if (event.RequestType === 'Update') {
        const rollingBack = await isParentStackRollingBack(event.StackId, undefined, logger);
        if (rollingBack) {
          logger.warn('Suppressing error during stack rollback', { error: message });
          return {
            Data: {
              temporaryPassword: PASSWORD_SET_AT_INSTALL_TIME,
            },
          };
        }
      }

      throw err;
    }
  }),
  env.check(load),
);
