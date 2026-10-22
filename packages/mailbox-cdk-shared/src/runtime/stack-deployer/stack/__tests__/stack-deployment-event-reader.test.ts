import { ExpectedFailure }            from '../../../../runtime/handler-kit/errors/expected-failure';
import {
  cfnRequest,
  DEPLOYER_RESOURCE_PROPERTIES,
  deployerRequest,
  LOGICAL_RESOURCE_ID,
  operation,
  OTHER_STACK_NAME,
  REQUEST_ID,
  RESPONSE_URL,
  sfnEvent,
  STACK_ID,
  STACK_NAME,
  stackDeployerProperties,
  US_EAST_1,
} from '../../__tests__/stack-deployer-helpers';
import { StackDeploymentEventReader } from '../stack-deployment-event-reader';

/**
 * Pins what the deployer Lambdas accept as input. The properties and the workflow input come from the CDK
 * through CloudFormation and Step Functions, so a malformed one must be rejected with the fields that are
 * wrong. A value is read as it arrived, and a Delete is never refused for properties it does not use: a
 * refused Delete leaves a stack behind.
 */
describe('StackDeploymentEventReader', () => {
  const reader = new StackDeploymentEventReader();

  describe('readCfnRequest', () => {
    it('reads a request and ignores the fields it does not use', () => {
      const event = { ...cfnRequest(), ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:starter', ServiceTimeout: '3600' };

      expect(reader.readCfnRequest(event).RequestType).toBe('Create');
    });

    it.each(['ResponseURL', 'StackId', 'RequestId', 'LogicalResourceId', 'RequestType', 'ResourceProperties'])(
      'throws an error naming %s when it is missing',
      (field) => {
        const event = Object.fromEntries(Object.entries(cfnRequest()).filter(([key]) => key !== field));

        expect(() => reader.readCfnRequest(event)).toThrow(new RegExp(`Invalid event.*\\.${field}`));
      },
    );

    it('throws an error for a request type CloudFormation does not send', () => {
      expect(() => reader.readCfnRequest({ ...cfnRequest(), RequestType: 'Replace' })).toThrow(/RequestType/);
    });

    it('throws for an event that is not an object', () => {
      expect(() => reader.readCfnRequest('not an event')).toThrow(/Invalid event/);
    });

    it('does not judge the properties, so a request that cannot be run can still be answered', () => {
      const request = reader.readCfnRequest(cfnRequest({}, { stackName: OTHER_STACK_NAME }));

      expect(request.ResourceProperties.stackName).toBe('only-a-name');
    });
  });

  describe('readProperties', () => {
    it('reads the properties of a stack deployment', () => {
      const properties = stackDeployerProperties({
        ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:starter',
        parameters:   { nameBase: 'mail', skipped: undefined },
        tags:         { 'serverless-inbox:root-stack': 'root' },
        region:       US_EAST_1,
      });

      expect(reader.readProperties(properties, 'Create')).toEqual(properties);
    });

    it('keeps a flag as it arrived, the text false included', () => {
      const read = reader.readProperties({ ...stackDeployerProperties(), preserveOnDelete: 'false', terminationProtection: 'true' }, 'Create');

      expect(read.preserveOnDelete).toBe('false');
      expect(read.terminationProtection).toBe('true');
    });

    it('rejects a termination protection that is neither a boolean nor true or false', () => {
      expect(() => reader.readProperties({ ...stackDeployerProperties(), terminationProtection: 'sometimes' }, 'Create')).toThrow(/terminationProtection/);
    });

    it('rejects a preserveOnDelete that is neither a boolean nor true or false', () => {
      expect(() => reader.readProperties({ ...stackDeployerProperties(), preserveOnDelete: 'sometimes' }, 'Create')).toThrow(/preserveOnDelete/);
    });

    it('reads properties without a template URL for a Delete, which does not need one', () => {
      expect(reader.readProperties({ stackName: 'only-a-name' }, 'Delete').stackName).toBe('only-a-name');
    });

    it.each(['Create', 'Update'] as const)('rejects a %s without a template URL as an ExpectedFailure naming it', (requestType) => {
      let thrown: unknown;
      try {
        reader.readProperties({ stackName: 'only-a-name' }, requestType);
      } catch (failure) {
        thrown = failure;
      }

      expect(thrown).toBeInstanceOf(ExpectedFailure);
      expect(thrown).toHaveProperty('message', `Invalid ResourceProperties: templateUrl is required for a ${requestType}`);
    });

    it('rejects a create whose properties are not valid as an ExpectedFailure naming the field', () => {
      let thrown: unknown;
      try {
        reader.readProperties({ templateUrl: 'https://example.com/template.json' }, 'Create');
      } catch (failure) {
        thrown = failure;
      }

      expect(thrown).toBeInstanceOf(ExpectedFailure);
      expect(thrown).toHaveProperty('message', expect.stringMatching(/Invalid ResourceProperties.*\.stackName/));
    });

    it.each(['edge', 'data', 'cognito'] as const)('accepts the properties of the %s deployer resource as CloudFormation sends them, extra keys included', (resource) => {
      const properties = DEPLOYER_RESOURCE_PROPERTIES[resource];

      expect(reader.readProperties(properties, 'Create')).toEqual(properties);
    });

    it('rejects parameters that are not strings', () => {
      expect(() => reader.readProperties({ ...stackDeployerProperties(), parameters: { count: 3 } }, 'Create')).toThrow(/parameters/);
    });

    it('lets a Delete proceed on the properties it needs when the others are not valid', () => {
      const invalid = { ...stackDeployerProperties(), region: 'us-east-1', preserveOnDelete: 'true', parameters: { count: 3 }, unknown: 'x' };

      expect(reader.readProperties(invalid, 'Delete')).toEqual({ stackName: 'test-data-stack', region: 'us-east-1', preserveOnDelete: 'true' });
    });

    it('rejects a Delete whose preserveOnDelete is not a switch, since it cannot tell whether the stack is to be kept', () => {
      let thrown: unknown;
      try {
        reader.readProperties({ ...stackDeployerProperties(), preserveOnDelete: 'sometimes' }, 'Delete');
      } catch (failure) {
        thrown = failure;
      }

      expect(thrown).toBeInstanceOf(ExpectedFailure);
      expect(thrown).toHaveProperty('message', expect.stringMatching(/Invalid ResourceProperties.*\.preserveOnDelete/));
    });

    it('rejects a Delete that has no stack name, since there is no stack to delete', () => {
      expect(() => reader.readProperties({ templateUrl: 'x' }, 'Delete')).toThrow(/Invalid ResourceProperties.*\.stackName/);
    });
  });

  describe('readSfnInvokeEvent', () => {
    it('reads the workflow input of a check', () => {
      const event = sfnEvent({ attempt: 3, deleteRetryCount: 1, createRetryCount: 2 });

      expect(reader.readSfnInvokeEvent(event)).toEqual(event);
    });

    it.each(['edge', 'data', 'cognito'] as const)('accepts the operation the starter builds from the %s deployer properties, extra keys included', (resource) => {
      const event = { ...sfnEvent(), op: { ...DEPLOYER_RESOURCE_PROPERTIES[resource], requestType: 'Create' } };

      expect(reader.readSfnInvokeEvent(event).op).toEqual(event.op);
    });

    it('accepts a key the workflow adds to its payload', () => {
      const event = { ...sfnEvent(), comment: 'added later' };

      expect(reader.readSfnInvokeEvent(event)).toMatchObject({ mode: 'check' });
    });

    it('accepts a key in the envelope that the worker does not read', () => {
      const event = { ...sfnEvent(), cfn: { ...sfnEvent().cfn, ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:starter' } };

      expect(reader.readSfnInvokeEvent(event).cfn.ResponseURL).toBe('https://example.com/cfn-response');
    });

    it('accepts a request that carries every key CloudFormation sends', () => {
      const request = { ...deployerRequest('edge'), ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:starter', ServiceTimeout: '3600' };

      expect(reader.readCfnRequest(request).ResourceProperties.stackName).toBe('mail-edge');
    });

    it('keeps the flags of the operation as they arrived', () => {
      const event = { ...sfnEvent(), op: { ...operation(), preserveOnDelete: 'false', terminationProtection: 'true' } };

      expect(reader.readSfnInvokeEvent(event).op).toMatchObject({ preserveOnDelete: 'false', terminationProtection: 'true' });
    });

    it('throws an error naming the field for a mode the workflow does not send', () => {
      expect(() => reader.readSfnInvokeEvent({ ...sfnEvent(), mode: 'abort' })).toThrow(/Invalid event.*\.mode/);
    });

    it('throws an error naming the field when the operation is missing', () => {
      const event = Object.fromEntries(Object.entries(sfnEvent()).filter(([key]) => key !== 'op'));

      expect(() => reader.readSfnInvokeEvent(event)).toThrow(/Invalid event.*\.op/);
    });

    it('throws for a counter that is not a number', () => {
      expect(() => reader.readSfnInvokeEvent({ ...sfnEvent(), attempt: 'many' })).toThrow(/\.attempt/);
    });
  });

  describe('readAnswerableCfnRequest', () => {
    it('gives the response target, request type and stack name of a request that is read in full', () => {
      const answerable = reader.readAnswerableCfnRequest(cfnRequest({ RequestType: 'Delete' }));

      expect(answerable).toEqual({
        cfn:         { ResponseURL: RESPONSE_URL, StackId: STACK_ID, RequestId: REQUEST_ID, LogicalResourceId: LOGICAL_RESOURCE_ID, ResourceType: 'Custom::MailboxDataDeployer' },
        requestType: 'Delete',
        stackName:   STACK_NAME,
      });
    });

    it('still gives the response target and the physical id when the request type and the stack name are wrong', () => {
      const event = { ...cfnRequest(), PhysicalResourceId: 'sent-by-cloudformation', RequestType: 'Replace', ResourceProperties: { stackName: 7 } };

      expect(reader.readAnswerableCfnRequest(event)).toMatchObject({
        cfn:                { ResponseURL: RESPONSE_URL },
        physicalResourceId: 'sent-by-cloudformation',
        requestType:        undefined,
        stackName:          undefined,
      });
    });

    it('gives the region the properties name, and none when it is wrong', () => {
      const named = cfnRequest({}, stackDeployerProperties({ region: US_EAST_1 }));
      const wrong = { ...cfnRequest(), ResourceProperties: { stackName: STACK_NAME, region: 7 } };

      expect(reader.readAnswerableCfnRequest(named)).toMatchObject({ region: US_EAST_1 });
      expect(reader.readAnswerableCfnRequest(wrong)).toMatchObject({ stackName: STACK_NAME, region: undefined });
    });

    it('still gives the response target when the physical id is wrong', () => {
      const event = { ...cfnRequest(), PhysicalResourceId: 7 };

      expect(reader.readAnswerableCfnRequest(event)).toMatchObject({ cfn: { ResponseURL: RESPONSE_URL }, physicalResourceId: undefined });
    });

    it.each([
      { description: 'without a response URL', event: { ...cfnRequest(), ResponseURL: undefined } },
      { description: 'that is not an object', event: 'not an event' },
    ])('gives nothing for an event $description', ({ event }) => {
      expect(reader.readAnswerableCfnRequest(event)).toBeUndefined();
    });
  });

  describe('readAnswerableSfnInput', () => {
    it('gives the response target, request type and stack name of a workflow input that is read in full', () => {
      const answerable = reader.readAnswerableSfnInput(sfnEvent({ op: operation({ requestType: 'Delete' }) }));

      expect(answerable).toEqual({ cfn: sfnEvent().cfn, requestType: 'Delete', stackName: STACK_NAME });
    });

    it('still gives the response target when the mode and the operation are wrong', () => {
      const event = { cfn: sfnEvent().cfn, mode: 'abort', op: 'none' };

      expect(reader.readAnswerableSfnInput(event)).toEqual({ cfn: sfnEvent().cfn, requestType: undefined, stackName: undefined });
    });

    it('gives the region the operation names, and none when it is wrong', () => {
      const wrong = { cfn: sfnEvent().cfn, mode: 'check', op: { ...operation(), region: 7 } };

      expect(reader.readAnswerableSfnInput(sfnEvent({ op: operation({ region: US_EAST_1 }) }))).toMatchObject({ region: US_EAST_1 });
      expect(reader.readAnswerableSfnInput(wrong)).toMatchObject({ stackName: STACK_NAME, region: undefined });
    });

    it('gives the physical id of the envelope, and still the response target when it is wrong', () => {
      const sent  = { cfn: { ...sfnEvent().cfn, PhysicalResourceId: 'sent-by-cloudformation' }, op: 'none' };
      const wrong = { cfn: { ...sfnEvent().cfn, PhysicalResourceId: 7 }, op: 'none' };

      expect(reader.readAnswerableSfnInput(sent)).toMatchObject({ physicalResourceId: 'sent-by-cloudformation' });
      expect(reader.readAnswerableSfnInput(wrong)).toMatchObject({ cfn: { ResponseURL: RESPONSE_URL }, physicalResourceId: undefined });
    });

    it('gives nothing for an input without a usable envelope', () => {
      expect(reader.readAnswerableSfnInput({ mode: 'check', op: operation() })).toBeUndefined();
    });
  });
});
