import * as t from 'typanion';
import type { Stack } from '@aws-sdk/client-cloudformation';
import { LoggerBuffer } from '../../shared/logger-buffer';
import type { CfnReplyTarget } from '../cfn-responder';
import { toRegion } from '../../shared/aws-identifiers';
import {
  toLogicalResourceId,
  toPhysicalResourceId,
  toRequestId,
  toResponseUrl,
  toStackId,
  toStackName,
  type StackId,
} from '../../shared/custom-resource-identifiers';
import { toStateMachineArn, toTemplateUrl } from '../deployer-identifiers';
import type { BrandedStackDeployerProperties, CfnRequest, OperationInput, SfnInvokeEvent } from '../stack-deployment';

export const RESPONSE_URL = toResponseUrl('https://example.com/cfn-response');
export const STACK_ID = toStackId('arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack-abc/guid');
export const STATE_MACHINE_ARN = toStateMachineArn('arn:aws:states:us-east-1:123456789012:stateMachine:MailboxDataDeployer-abc123');
export const STACK_NAME = toStackName('test-data-stack');
export const OTHER_STACK_NAME = toStackName('only-a-name');
export const REQUEST_ID = toRequestId('request-123');
export const LOGICAL_RESOURCE_ID = toLogicalResourceId('MailboxDeployer');
export const LOG_STREAM_NAME = '/aws/lambda/test';
export const US_EAST_1 = toRegion('us-east-1');
export const EU_WEST_1 = toRegion('eu-west-1');
export const US_WEST_2 = toRegion('us-west-2');

/** A stack id whose stack name is not a name CloudFormation would give, because it is not an ARN. */
export const MALFORMED_STACK_ID = toStackId('not-a-stack-arn');

/** The id CloudFormation gives to the stack with the given name. */
export function stackIdOf(stackName: string): StackId {
  return toStackId(`arn:aws:cloudformation:us-east-1:123456789012:stack/${stackName}/guid`);
}

const isCfnAnswerBody = t.isObject({
  Status: t.isEnum(['SUCCESS', 'FAILED'] as const),
  Reason: t.isOptional(t.isString()),
  PhysicalResourceId: t.isString(),
  StackId: t.isString(),
  RequestId: t.isString(),
  LogicalResourceId: t.isString(),
  NoEcho: t.isBoolean(),
  Data: t.isRecord(t.isString()),
});

/** The body of one PUT to the CloudFormation response URL. */
export type CfnAnswerBody = t.InferType<typeof isCfnAnswerBody>;

/** The endpoint a CloudFormation response is PUT to, replaced by a recording fake. */
export interface FakeCfnEndpoint {
  answers(): CfnAnswerBody[];
}

/** Replaces `fetch` with a fake CloudFormation endpoint that accepts every PUT and records its body; undo with `jest.restoreAllMocks()`. */
export function fakeCfnEndpoint(): FakeCfnEndpoint {
  const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('', { status: 200 }));
  return {
    answers: () => fetchSpy.mock.calls.map(([, init]) => {
      const body: unknown = JSON.parse(String(init?.body));
      t.assert(body, isCfnAnswerBody);
      return body;
    }),
  };
}

/** The console methods a logger writes to, silenced and recorded. */
export interface ConsoleSpies {
  readonly debug: jest.SpyInstance;
  readonly info: jest.SpyInstance;
  readonly warn: jest.SpyInstance;
  readonly error: jest.SpyInstance;
  readonly log: jest.SpyInstance;
}

/** Silences the console and records what is written; undo with `jest.restoreAllMocks()`. */
export function silenceConsole(): ConsoleSpies {
  return {
    debug: jest.spyOn(console, 'debug').mockImplementation(() => undefined),
    info: jest.spyOn(console, 'info').mockImplementation(() => undefined),
    warn: jest.spyOn(console, 'warn').mockImplementation(() => undefined),
    error: jest.spyOn(console, 'error').mockImplementation(() => undefined),
    log: jest.spyOn(console, 'log').mockImplementation(() => undefined),
  };
}

/** A pause that returns at once, for a responder whose retries a test does not wait for. */
export const noPause = async (): Promise<void> => undefined;

/** A logger at the default level, which buffers everything below `error`. */
export function defaultLevelLogger(): LoggerBuffer {
  return new LoggerBuffer('stack-deployer', 'error');
}

/** An error as the AWS SDK throws it: an Error with the service exception name and the request metadata. */
export function awsError(name: string, message: string): Error {
  return Object.assign(new Error(message), { name });
}

export function stackDeployerProperties(overrides: Partial<BrandedStackDeployerProperties> = {}): BrandedStackDeployerProperties {
  return { stackName: STACK_NAME, templateUrl: toTemplateUrl('https://example.com/template.json'), ...overrides };
}

export function operation(overrides: Partial<OperationInput> = {}): OperationInput {
  return { ...stackDeployerProperties(), requestType: 'Create', ...overrides };
}

export function cfnRequest(overrides: Partial<CfnRequest> = {}, properties: CfnRequest['ResourceProperties'] = stackDeployerProperties()): CfnRequest {
  return {
    RequestType: 'Create',
    ResponseURL: RESPONSE_URL,
    StackId: STACK_ID,
    RequestId: REQUEST_ID,
    LogicalResourceId: LOGICAL_RESOURCE_ID,
    ResourceType: 'Custom::MailboxDataDeployer',
    ResourceProperties: properties,
    ...overrides,
  };
}

const SERVICE_TOKEN = 'arn:aws:lambda:us-east-1:123456789012:function:stack-deployer-starter';

/**
 * The `ResourceProperties` the three deployer custom resources really carry, with the keys of the synthesized
 * template and every value a string, as CloudFormation sends them. `ServiceToken` and `ServiceTimeout` are not
 * stack deployer properties; CloudFormation adds them.
 */
export const DEPLOYER_RESOURCE_PROPERTIES = {
  edge: {
    ServiceToken: SERVICE_TOKEN,
    ServiceTimeout: '3600',
    stackName: 'mail-edge',
    templateUrl: 'https://artifacts.example.com/edge-stack-template.json',
    parameters: { domainName: 'mail.example.com', certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/abc' },
    tags: { 'serverless-inbox:root-stack': 'mail', 'serverless-inbox:stack': 'mail-edge' },
    terminationProtection: 'false',
    region: 'us-east-1',
  },
  data: {
    ServiceToken: SERVICE_TOKEN,
    ServiceTimeout: '3600',
    stackName: 'mail-data',
    templateUrl: 'https://artifacts.example.com/data-stack-template.json',
    preserveOnDelete: 'true',
    parameters: { nameBase: 'mail', rootStack: 'mail' },
    tags: { 'serverless-inbox:root-stack': 'mail' },
  },
  cognito: {
    ServiceToken: SERVICE_TOKEN,
    ServiceTimeout: '3600',
    region: 'eu-west-1',
    preserveOnDelete: 'true',
    stackName: 'mail-cognito',
    templateUrl: 'https://artifacts.example.com/cognito-data-stack-template.json',
    parameters: { adminUsername: 'admin' },
    tags: { 'serverless-inbox:root-stack': 'mail' },
  },
};

/** A request as one of the deployer resources sends it, with its real property keys. */
export function deployerRequest(resource: keyof typeof DEPLOYER_RESOURCE_PROPERTIES, requestType: CfnRequest['RequestType'] = 'Create'): CfnRequest {
  const properties = DEPLOYER_RESOURCE_PROPERTIES[resource];
  return cfnRequest({ RequestType: requestType }, { ...properties, stackName: toStackName(properties.stackName) });
}

export function sfnEvent(overrides: Partial<SfnInvokeEvent> = {}): SfnInvokeEvent {
  return {
    mode: 'check',
    cfn: {
      ResponseURL: RESPONSE_URL,
      StackId: STACK_ID,
      RequestId: REQUEST_ID,
      LogicalResourceId: LOGICAL_RESOURCE_ID,
    },
    op: operation(),
    attempt: 1,
    ...overrides,
  };
}

export function replyTarget(overrides: Partial<CfnReplyTarget> = {}): CfnReplyTarget {
  return {
    cfn: sfnEvent().cfn,
    physicalResourceId: toPhysicalResourceId(STACK_NAME),
    logStreamName: LOG_STREAM_NAME,
    ...overrides,
  };
}

export function stack(status: NonNullable<Stack['StackStatus']>, overrides: Partial<Stack> = {}): Stack {
  return {
    StackName: STACK_NAME,
    CreationTime: new Date('2026-01-01T00:00:00Z'),
    StackStatus: status,
    ...overrides,
  };
}
