import { CognitoIdentityProviderClient, AdminCreateUserCommand, AdminUpdateUserAttributesCommand, AdminAddUserToGroupCommand, UsernameExistsException } from '@aws-sdk/client-cognito-identity-provider';
import https from 'node:https';
import { URL } from 'node:url';

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

type BootstrapUserProperties = {
  userPoolId: string;
  username: string;
  email: string;
  groups?: string[];

  /** If true, Cognito will send an invite email. Default: false (SUPPRESS). */
  sendInvite?: boolean;
};

async function ensureUser(props: BootstrapUserProperties): Promise<void> {
  const { userPoolId, username, email } = props;
  const sendInvite = props.sendInvite ?? false;
  const groups = (props.groups ?? []).filter(Boolean);

  try {
    await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: username,
        ...(sendInvite ? { DesiredDeliveryMediums: ['EMAIL'] } : { MessageAction: 'SUPPRESS' }),
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
        ],
      }),
    );
  } catch (err: any) {
    if (err instanceof UsernameExistsException || err?.name === 'UsernameExistsException') {
      await cognito.send(
        new AdminUpdateUserAttributesCommand({
          UserPoolId: userPoolId,
          Username: username,
          UserAttributes: [
            { Name: 'email', Value: email },
            { Name: 'email_verified', Value: 'true' },
          ],
        }),
      );
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

export const handler = async (event: CloudFormationCustomResourceEvent): Promise<void> => {
  const props = event.ResourceProperties as BootstrapUserProperties;

  const physicalResourceId = `BootstrapUser:${props.userPoolId}:${props.username}`;

  try {
    if (!props?.userPoolId || !props?.username || !props?.email) {
      throw new Error('Missing required properties: userPoolId, username, email');
    }

    if (event.RequestType === 'Create' || event.RequestType === 'Update') {
      await ensureUser(props);
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
};
