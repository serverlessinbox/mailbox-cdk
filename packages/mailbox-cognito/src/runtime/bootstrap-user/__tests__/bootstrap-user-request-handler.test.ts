/// <reference types="jest" />

/**
 * Pins the answers of the bootstrap user custom resource: which password it reports, which physical id it
 * answers with, and when a failed Update is answered with success. A password reported although it was never
 * applied would hand the operator a credential that does not work, and a failed Update answered with failure
 * during a stack rollback leaves the stack in UPDATE_ROLLBACK_FAILED.
 */

import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  CognitoIdentityProviderClient,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';
import { createCloudFormationClient, ExpectedFailure, isParentStackRollingBack, LoggerBuffer, toStackId } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { mockClient }                                                                                     from 'aws-sdk-client-mock';

import { PASSWORD_SET_AT_INSTALL_TIME }                                                                   from '../bootstrap-user-answers';
import { BootstrapUserRequestHandler }                                                                    from '../bootstrap-user-request-handler';
import { UserEnsurer }                                                                                    from '../ensure-user';

import { PHYSICAL_RESOURCE_ID, request, STACK_ID, templateProperties, USER_POOL_ID }                      from './bootstrap-user-helpers';

// The stack-status lookup belongs to isParentStackRollingBack and is pinned by its own tests, so this suite
// mocks that function and lets everything else run for real.
jest.mock('@serverlessinbox/mailbox-cdk-shared/lambda-runtime', () => ({
  ...jest.requireActual('@serverlessinbox/mailbox-cdk-shared/lambda-runtime'),
  isParentStackRollingBack: jest.fn(),
}));

const mockIsParentStackRollingBack = isParentStackRollingBack as jest.MockedFunction<typeof isParentStackRollingBack>;

const SUPPLIED_PASSWORD = 'Supplied1Password';

describe('BootstrapUserRequestHandler', () => {
  const cognitoMock    = mockClient(CognitoIdentityProviderClient);
  const cloudFormation = createCloudFormationClient();
  const logger         = new LoggerBuffer('test-service', 'error');
  let requestHandler: BootstrapUserRequestHandler;

  beforeEach(() => {
    cognitoMock.reset();
    cognitoMock.on(AdminCreateUserCommand).resolves({});
    cognitoMock.on(AdminAddUserToGroupCommand).resolves({});
    mockIsParentStackRollingBack.mockReset();
    requestHandler = new BootstrapUserRequestHandler(new UserEnsurer(new CognitoIdentityProviderClient({}), logger), cloudFormation, logger);
  });

  describe('handle', () => {
    it('Create answers the physical id and the password it applied when the properties supply one', async () => {
      const answer = await requestHandler.handle(request('Create', templateProperties({ username: 'testadmin', temporaryPassword: SUPPLIED_PASSWORD })));

      expect(answer).toEqual({
        PhysicalResourceId: `BootstrapUser:${USER_POOL_ID}:testadmin`,
        Data: { temporaryPassword: SUPPLIED_PASSWORD },
      });
    });

    it('Create without a username creates and names the user admin', async () => {
      const answer = await requestHandler.handle(request('Create'));

      expect(answer.PhysicalResourceId).toBe(PHYSICAL_RESOURCE_ID);
      expect(cognitoMock.commandCalls(AdminCreateUserCommand)[0].args[0].input).toMatchObject({ Username: 'admin' });
    });

    it('Create without a password reports the password it generated and applied', async () => {
      const answer = await requestHandler.handle(request('Create'));

      const appliedPassword = cognitoMock.commandCalls(AdminCreateUserCommand)[0].args[0].input.TemporaryPassword;
      expect(answer.Data.temporaryPassword).toBe(appliedPassword);
      expect(answer.Data.temporaryPassword).not.toBe(PASSWORD_SET_AT_INSTALL_TIME);
    });

    it('reports the marker, not the supplied password, when the user already existed', async () => {
      cognitoMock.on(AdminCreateUserCommand).rejects(new UsernameExistsException({ message: 'exists', $metadata: {} }));

      const answer = await requestHandler.handle(request('Create', templateProperties({ temporaryPassword: SUPPLIED_PASSWORD })));

      expect(answer.Data.temporaryPassword).toBe(PASSWORD_SET_AT_INSTALL_TIME);
      expect(answer.PhysicalResourceId).toBe(PHYSICAL_RESOURCE_ID);
    });

    it('Update answers the password without a physical id, so the resource keeps its own', async () => {
      const answer = await requestHandler.handle(request('Update', templateProperties({ temporaryPassword: SUPPLIED_PASSWORD })));

      expect(answer).toEqual({ Data: { temporaryPassword: SUPPLIED_PASSWORD } });
    });

    it('Delete answers the marker without a physical id', async () => {
      const answer = await requestHandler.handle(request('Delete'));

      expect(answer).toEqual({ Data: { temporaryPassword: PASSWORD_SET_AT_INSTALL_TIME } });
    });

    it('Delete answers the marker although its properties are not valid', async () => {
      const answer = await requestHandler.handle(request('Delete', { ServiceToken: 'x' }));

      expect(answer).toEqual({ Data: { temporaryPassword: PASSWORD_SET_AT_INSTALL_TIME } });
    });

    it('adds the user to its groups and skips an empty group name', async () => {
      await requestHandler.handle(request('Create', templateProperties({ groups: ['admin', '', 'user'] })));

      const groupNames = cognitoMock.commandCalls(AdminAddUserToGroupCommand).map((call) => call.args[0].input.GroupName);
      expect(groupNames).toEqual(['admin', 'user']);
    });

    it('throws an ExpectedFailure that names the invalid field when the properties are not valid', async () => {
      const failure: unknown = await requestHandler.handle(request('Create', { ServiceToken: 'x' })).catch((thrown: unknown) => thrown);

      expect(failure).toBeInstanceOf(ExpectedFailure);
      expect(failure).toHaveProperty('message', expect.stringMatching(/^Invalid ResourceProperties: .*userPoolId/));
    });
  });

  describe('answerFailure', () => {
    const failure = new Error('cognito failed');

    it('answers an Update that fails while the parent stack rolls back with the marker', async () => {
      mockIsParentStackRollingBack.mockResolvedValue(true);

      const answer = await requestHandler.answerFailure(request('Update'), failure);

      expect(answer).toEqual({ Data: { temporaryPassword: PASSWORD_SET_AT_INSTALL_TIME } });
    });

    it('asks about the stack of the request through the CloudFormation client it was given', async () => {
      mockIsParentStackRollingBack.mockResolvedValue(true);

      await requestHandler.answerFailure(request('Update'), failure);

      expect(mockIsParentStackRollingBack).toHaveBeenCalledWith(toStackId(STACK_ID), cloudFormation, logger);
    });

    it('throws the failure of an Update when the parent stack is not rolling back', async () => {
      mockIsParentStackRollingBack.mockResolvedValue(false);

      await expect(requestHandler.answerFailure(request('Update'), failure)).rejects.toBe(failure);
    });

    it('throws the failure of a Create without consulting the stack status', async () => {
      mockIsParentStackRollingBack.mockResolvedValue(true);

      await expect(requestHandler.answerFailure(request('Create'), failure)).rejects.toBe(failure);
      expect(mockIsParentStackRollingBack).not.toHaveBeenCalled();
    });
  });
});
