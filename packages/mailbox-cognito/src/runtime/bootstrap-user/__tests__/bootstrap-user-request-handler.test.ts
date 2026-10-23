/// <reference types="jest" />

/**
 * Pins the answers of the bootstrap user custom resource: which password it reports and which physical id it
 * answers with. A password reported although it was never applied would hand the operator a credential that
 * does not work.
 */

import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  CognitoIdentityProviderClient,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';
import { InvalidOwnInput, LoggerBuffer }                                              from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { mockClient }                                                                 from 'aws-sdk-client-mock';

import { PASSWORD_SET_AT_INSTALL_TIME }                                               from '../bootstrap-user-answers';
import { BootstrapUserRequestHandler }                                                from '../bootstrap-user-request-handler';
import { UserEnsurer }                                                                from '../ensure-user';

import { PHYSICAL_RESOURCE_ID, request, templateProperties, USER_POOL_ID }            from './bootstrap-user-helpers';

const SUPPLIED_PASSWORD = 'Supplied1Password';

describe('BootstrapUserRequestHandler', () => {
  const cognitoMock = mockClient(CognitoIdentityProviderClient);
  const logger      = new LoggerBuffer('test-service', 'error');
  let requestHandler: BootstrapUserRequestHandler;

  beforeEach(() => {
    cognitoMock.reset();
    cognitoMock.on(AdminCreateUserCommand).resolves({});
    cognitoMock.on(AdminAddUserToGroupCommand).resolves({});
    requestHandler = new BootstrapUserRequestHandler(new UserEnsurer(new CognitoIdentityProviderClient({}), logger), logger);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function appliedPasswordLength(): number | undefined {
    return cognitoMock.commandCalls(AdminCreateUserCommand)[0].args[0].input.TemporaryPassword?.length;
  }

  describe('handle', () => {
    it('Create answers the physical id and the password it applied when the properties supply one', async () => {
      const answer = await requestHandler.handle(request('Create', templateProperties({ username: 'testadmin', temporaryPassword: SUPPLIED_PASSWORD })));

      expect(answer).toEqual({
        PhysicalResourceId: `BootstrapUser:${USER_POOL_ID}:testadmin`,
        Data:               { temporaryPassword: SUPPLIED_PASSWORD },
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

    it('Create generates a 16-character password when the pool minimum is the default of 8', async () => {
      await requestHandler.handle(request('Create', templateProperties({ passwordMinLength: '8' })));

      expect(appliedPasswordLength()).toBe(16);
    });

    it('Create generates a 99-character password when the pool minimum is 99', async () => {
      await requestHandler.handle(request('Create', templateProperties({ passwordMinLength: '99' })));

      expect(appliedPasswordLength()).toBe(99);
    });

    it('Create generates a 16-character password when the template does not carry passwordMinLength', async () => {
      await requestHandler.handle(request('Create', templateProperties({ passwordMinLength: undefined })));

      expect(appliedPasswordLength()).toBe(16);
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

    it('throws an InvalidOwnInput that names the invalid field and carries the properties without the password when they are not valid', async () => {
      const failure: unknown = await requestHandler
        .handle(request('Create', { temporaryPassword: SUPPLIED_PASSWORD, kept: 'visible' }))
        .catch((thrown: unknown) => thrown);

      expect(failure).toBeInstanceOf(InvalidOwnInput);
      expect(failure).toHaveProperty('message', expect.stringMatching(/^Invalid ResourceProperties: .*userPoolId.*"kept":"visible"/));
      expect(failure).toHaveProperty('input', expect.objectContaining({ temporaryPassword: '[redacted]', kept: 'visible' }));
      expect(failure).toHaveProperty('message', expect.not.stringContaining(SUPPLIED_PASSWORD));
    });
  });

});
