import { CognitoIdentityProviderClient, AdminCreateUserCommand, AdminUpdateUserAttributesCommand, AdminAddUserToGroupCommand, UsernameExistsException } from '@aws-sdk/client-cognito-identity-provider';
import https from 'node:https';
import { URL } from 'node:url';
import { withSmokeTest } from '@serverlessinbox/mailbox-cdk-shared/smoke-test';
import { emitManualFinalize } from '@serverlessinbox/mailbox-cdk-shared/manual-finalize';

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

/**
 * Default one-time bootstrap password used when neither `temporaryPassword` nor `email` is configured.
 * The user is created in FORCE_CHANGE_PASSWORD state and must change this on first login.
 * See documentation for the well-known default value.
 */
const DEFAULT_TEMPORARY_PASSWORD = 'Mailbox-Admin-1!';

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
  const temporaryPassword = props.temporaryPassword ?? (!email ? DEFAULT_TEMPORARY_PASSWORD : undefined);
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

export const handler = withSmokeTest(async (event: CloudFormationCustomResourceEvent): Promise<void> => {
  // Emit finalization details for manual recovery of hung custom resources
  emitManualFinalize(event);

  const props = event.ResourceProperties as BootstrapUserProperties;

  const physicalResourceId = `BootstrapUser:${props.userPoolId}:${props.username ?? 'admin'}`;

  // CDK CustomResource serializes all properties as strings — coerce booleans explicitly.
  const normalizedProps: BootstrapUserProperties = {
    ...props,
    sendInvite: props.sendInvite === true || (props.sendInvite as any) === 'true',
  };

  try {
    if (!props?.userPoolId) {
      throw new Error('Missing required property: userPoolId');
    }

    if (event.RequestType === 'Create' || event.RequestType === 'Update') {
      await ensureUser(normalizedProps);
    }

    await sendResponse(event, {
      Status: 'SUCCESS',
      PhysicalResourceId: event.PhysicalResourceId ?? physicalResourceId,
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
    });
  } catch (e: any) {
    const message = (e as Error)?.message ?? String(e);

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
});
