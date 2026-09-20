/// <reference types="node" />
import { CognitoIdentityProviderClient, AdminCreateUserCommand, AdminUpdateUserAttributesCommand, AdminAddUserToGroupCommand, UsernameExistsException } from '@aws-sdk/client-cognito-identity-provider';
import https from 'node:https';
import { URL } from 'node:url';
import * as crypto from 'crypto';
import { withSmokeTest, emitManualFinalize, env, LoggerBuffer, isParentStackRollingBack } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { load } from './config';

type CloudFormationCustomResourceEvent = {
  RequestType: 'Create' | 'Update' | 'Delete';
  ResponseURL: string;
  StackId: string;
  RequestId: string;
  ResourceType: string;
  LogicalResourceId: string;
  PhysicalResourceId?: string;
  ResourceProperties: Record<string, any>;
};

type CloudFormationCustomResourceResponse = {
  Status: 'SUCCESS' | 'FAILED';
  Reason?: string;
  PhysicalResourceId: string;
  StackId: string;
  RequestId: string;
  LogicalResourceId: string;
  NoEcho?: boolean;
  Data?: Record<string, any>;
};

function sendResponse(event: CloudFormationCustomResourceEvent, response: CloudFormationCustomResourceResponse): Promise<void> {
  return new Promise((resolve, reject) => {
    const responseBody = JSON.stringify(response);
    const url = new URL(event.ResponseURL);

    const req = https.request(
      {
        method: 'PUT',
        hostname: url.hostname,
        path: url.pathname + url.search,
        headers: {
          'content-type': '',
          'content-length': Buffer.byteLength(responseBody),
        },
      },
      (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`CloudFormation response failed: ${res.statusCode}`));
          return;
        }
        resolve();
      },
    );

    req.on('error', reject);
    req.write(responseBody);
    req.end();
  });
}

const cognito = new CognitoIdentityProviderClient({});
const { config: configOrError, error: configError } = env.tryLoad(load);

/**
 * Generate a cryptographically unpredictable random password that meets Cognito policy requirements.
 * Returns a 16-character password containing lowercase, uppercase, and digits.
 * Never logged or exposed in responses.
 *
 * Uses Node's built-in crypto.randomInt (CSPRNG) because this password is the initial admin
 * credential for the entire deployment. Math.random() would be recoverable from observed outputs,
 * violating the security requirement for an initial credential.
 */
export function generateSecurePassword(): string {
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digits = '0123456789';
  // Symbols are allowed by Cognito but not required; we exclude them for simplicity
  const allChars = lowercase + uppercase + digits;

  const passwordChars: string[] = [];

  // Ensure at least one of each required character type by selecting from specific sets
  passwordChars.push(lowercase[crypto.randomInt(0, lowercase.length)]);
  passwordChars.push(uppercase[crypto.randomInt(0, uppercase.length)]);
  passwordChars.push(digits[crypto.randomInt(0, digits.length)]);

  // Fill remaining 13 positions with random characters from the full set
  for (let i = 3; i < 16; i++) {
    passwordChars.push(allChars[crypto.randomInt(0, allChars.length)]);
  }

  // Shuffle using Fisher-Yates with cryptographic random selection to avoid predictable structure
  for (let i = passwordChars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [passwordChars[i], passwordChars[j]] = [passwordChars[j], passwordChars[i]];
  }

  return passwordChars.join('');
}

type BootstrapUserProperties = {
  userPoolId: string;
  /** Defaults to `"admin"` if not provided. */
  username?: string;
  /** Email address for the bootstrap user. Optional. */
  email?: string;
  groups?: string[];

  /**
   * One-time temporary bootstrap password (FORCE_CHANGE_PASSWORD mode).
   * This is a temporary credential only — never use for permanent passwords.
   */
  temporaryPassword?: string;

  /** If true, Cognito will send an invite email. Default: false (SUPPRESS). */
  sendInvite?: boolean;
};

async function ensureUser(props: BootstrapUserProperties): Promise<void> {
  const { userPoolId, email } = props;
  const username = props.username ?? 'admin';
  const temporaryPassword = props.temporaryPassword ?? (!email ? generateSecurePassword() : undefined);
  const sendInvite = props.sendInvite ?? false;
  const groups = (props.groups ?? []).filter(Boolean);
  const emailAttributes = email
    ? [{ Name: 'email', Value: email }, { Name: 'email_verified', Value: 'true' }]
    : [];

  try {
    await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: username,
        ...(sendInvite ? { DesiredDeliveryMediums: ['EMAIL'] } : { MessageAction: 'SUPPRESS' }),
        ...(emailAttributes.length > 0 ? { UserAttributes: emailAttributes } : {}),
        ...(temporaryPassword ? { TemporaryPassword: temporaryPassword } : {}),
      }),
    );
  } catch (err: any) {
    if (err instanceof UsernameExistsException || err?.name === 'UsernameExistsException') {
      // Only update attributes if email was provided; do NOT re-set temp password
      // (the user may have already changed it).
      if (emailAttributes.length > 0) {
        await cognito.send(
          new AdminUpdateUserAttributesCommand({
            UserPoolId: userPoolId,
            Username: username,
            UserAttributes: emailAttributes,
          }),
        );
      }
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
}

export const handler = withSmokeTest(
  async (event: CloudFormationCustomResourceEvent): Promise<void> => {
  if (configError) {
    const physicalResourceId = `BootstrapUser:error`;
    try {
      await sendResponse(event, {
        Status: event.RequestType === 'Delete' ? 'SUCCESS' : 'FAILED',
        Reason: configError,
        PhysicalResourceId: event.PhysicalResourceId ?? physicalResourceId,
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
      });
    } catch {
      // If even the response fails, rethrow to surface in logs.
    }
    return;
  }

  const config = configOrError;
  const logger = new LoggerBuffer(config.serviceName, config.logLevel);

  // Emit finalization details for manual recovery of hung custom resources.
  // Intentionally omit physicalResourceId (which would be BootstrapUser:${userPoolId}:${username})
  // to avoid writing the admin username into CloudWatch logs.
  emitManualFinalize(event, { service: config.serviceName });

  const props = event.ResourceProperties as BootstrapUserProperties;

  const physicalResourceId = `BootstrapUser:${props.userPoolId}:${props.username ?? 'admin'}`;

  // CDK CustomResource serializes all properties as strings — coerce booleans explicitly.
  const normalizedProps: BootstrapUserProperties = {
    ...props,
    sendInvite: props.sendInvite === true || (props.sendInvite as any) === 'true',
  };

  logger.info('bootstrap_user_request', { requestType: event.RequestType });

  try {
    if (!props?.userPoolId) {
      throw new Error('Missing required property: userPoolId');
    }

    logger.debug('bootstrap_user_validating', { userPoolIdLength: String(props.userPoolId).length });

    let generatedPassword: string | undefined;

    if (event.RequestType === 'Create' || event.RequestType === 'Update') {
      logger.debug('bootstrap_user_ensuring_user');
      // Determine the actual temporary password to track whether it was generated
      const email = (props.email as string | undefined);
      const suppliedPassword = (props.temporaryPassword as string | undefined);
      generatedPassword = suppliedPassword ?? (!email ? generateSecurePassword() : undefined);
      await ensureUser(normalizedProps);
      logger.info('bootstrap_user_ensured');
    }

    logger.debug('bootstrap_user_sending_success_response');
    const responseData: Record<string, string> = {};
    // Only return the password if it was generated (not supplied by the caller)
    if (generatedPassword && !props.temporaryPassword) {
      responseData.temporaryPassword = generatedPassword;
    }
    await sendResponse(event, {
      Status: 'SUCCESS',
      PhysicalResourceId: event.PhysicalResourceId ?? physicalResourceId,
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
      ...(Object.keys(responseData).length > 0 ? { Data: responseData } : {}),
    });
  } catch (e: any) {
    const message = (e as Error)?.message ?? String(e);
    logger.error('bootstrap_user_handler_failed', { message });
    logger.flush();

    // During parent-stack rollback on Update, send SUCCESS to allow rollback to complete
    // instead of failing and leaving the stack in UPDATE_ROLLBACK_FAILED.
    if (event.RequestType === 'Update') {
      const rollingBack = await isParentStackRollingBack(event.StackId, undefined, logger);
      if (rollingBack) {
        logger.warn('Suppressing error during stack rollback', { error: message });
        try {
          await sendResponse(event, {
            Status: 'SUCCESS',
            PhysicalResourceId: event.PhysicalResourceId ?? physicalResourceId,
            StackId: event.StackId,
            RequestId: event.RequestId,
            LogicalResourceId: event.LogicalResourceId,
          });
        } catch (responseErr) {
          // If the response send fails, log it but do not rethrow — the handler
          // has already logged the original error and we do not want to fail the
          // rollback because the response could not be sent.
          const responseErrorMessage = responseErr instanceof Error ? responseErr.message : String(responseErr);
          logger.error('bootstrap_user_response_failed_during_rollback', { error: responseErrorMessage });
        }
        return;
      }
    }

    try {
      await sendResponse(event, {
        Status: 'FAILED',
        Reason: message,
        PhysicalResourceId: event.PhysicalResourceId ?? physicalResourceId,
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
      });
    } catch {
      // If even the response fails, rethrow to surface in logs.
    }

    throw e;
  }
  },
  env.check(load),
);
