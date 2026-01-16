import { wrapHandler } from 'aws-custom-resources';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminUpdateUserAttributesCommand,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';

const cognito = new CognitoIdentityProviderClient();

export interface BootstrapUserProperties {
  userPoolId: string;
  username: string;
  email: string;
  groups: string[];
}

export const handler = wrapHandler(async (event: any) => {
  const props = event.ResourceProperties as BootstrapUserProperties;
  const { userPoolId, username, email, groups } = props;

  if (event.RequestType === 'Create' || event.RequestType === 'Update') {
    try {
      await cognito.send(
        new AdminCreateUserCommand({
          UserPoolId: userPoolId,
          Username: username,
          DesiredDeliveryMediums: ['EMAIL'],
          UserAttributes: [{ Name: 'email', Value: email }],
        }),
      );
      console.log(`Created user: ${username}`);
    } catch (error) {
      if (error instanceof UsernameExistsException) {
        console.log(`User already exists: ${username}, updating email`);
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
        console.error(`Error creating user ${username}:`, error);
        return {};
      }
    }

    for (const group of groups) {
      await cognito.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: userPoolId,
          Username: username,
          GroupName: group,
        }),
      );
      console.log(`Added ${username} to group: ${group}`);
    }

    return {};
  }

  return {};
});
