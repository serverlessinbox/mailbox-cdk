/// <reference types="jest" />

import { InvokeCommand, type LambdaClient } from '@aws-sdk/client-lambda';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { AwsClientStub } from 'aws-sdk-client-mock';
import * as t from 'typanion';

/**
 * The payload of an invoke result is a `Uint8ArrayBlobAdapter` (`@smithy/util-stream`): a `Uint8Array` with a
 * `transformToString()`. The value built here has the same shape, without a direct dependency on that transitive package.
 */
function encode(value: unknown): Uint8Array & { transformToString(encoding?: string): string } {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return Object.assign(bytes, {
    transformToString: (): string => new TextDecoder().decode(bytes),
  });
}

/** The fields of a request to `identity-provisioner` that a test reads. */
const isSentRequest = t.isPartial({
  kind: t.isString(),
  tenantId: t.isOptional(t.isString()),
  clientId: t.isOptional(t.isString()),
  scope: t.isOptional(t.isString()),
});
export type SentRequest = t.InferType<typeof isSentRequest>;

/** What the faked `identity-provisioner` answers per request kind; a kind left out gets the answer of a registration that proceeds. An `Error` is thrown by the invoke. */
export interface IdentityProvisionerAnswers {
  readonly resolveTenant?: unknown;
  readonly dcrCheck?: unknown;
  readonly dcrPersist?: unknown;
}

/** The `POST /oauth/register` event of API Gateway for a request body that is sent as it is. */
export function rawRequestEvent(body: string | undefined, isBase64Encoded = false): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'POST /oauth/register',
    rawPath: '/oauth/register',
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '123456789012',
      apiId: 'api-id',
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: { method: 'POST', path: '/oauth/register', protocol: 'HTTP/1.1', sourceIp: '203.0.113.1', userAgent: 'test' },
      requestId: 'request-id',
      routeKey: 'POST /oauth/register',
      stage: '$default',
      time: '01/Jan/2026:00:00:00 +0000',
      timeEpoch: 1767225600000,
    },
    body,
    isBase64Encoded,
  };
}

/** The `POST /oauth/register` event for a request whose JSON body is `body`. */
export function requestEvent(body: unknown): APIGatewayProxyEventV2 {
  return rawRequestEvent(JSON.stringify(body));
}

/** The JSON body of an answer. */
export function bodyOf(answer: APIGatewayProxyStructuredResultV2): unknown {
  return JSON.parse(answer.body ?? '');
}

/** Makes the faked Lambda client answer each request kind of `identity-provisioner` with its own configurable answer. */
export function mockIdentityProvisioner(lambdaMock: AwsClientStub<LambdaClient>, answers: IdentityProvisionerAnswers): void {
  lambdaMock.on(InvokeCommand).callsFake((input) => {
    const request = sentRequestOf(input.Payload);
    switch (request.kind) {
      case 'RESOLVE_TENANT':
        return answerWith(answers.resolveTenant ?? { tenantId: 'tenant-1' });
      case 'DCR_CHECK':
        return answerWith(answers.dcrCheck ?? { status: 'proceed' });
      case 'DCR_PERSIST':
        return answerWith(answers.dcrPersist ?? { status: 'success' });
      default:
        throw new Error(`unexpected kind: ${request.kind}`);
    }
  });
}

/** The requests that reached `identity-provisioner`, in order. */
export function sentRequests(lambdaMock: AwsClientStub<LambdaClient>): SentRequest[] {
  return lambdaMock.commandCalls(InvokeCommand).map((call) => sentRequestOf(call.args[0].input.Payload));
}

function answerWith(answer: unknown): { Payload: ReturnType<typeof encode> } {
  if (answer instanceof Error) {
    throw answer;
  }
  return { Payload: encode(answer) };
}

function sentRequestOf(payload: unknown): SentRequest {
  if (!(payload instanceof Uint8Array)) {
    throw new Error('The payload sent to identity-provisioner is not bytes');
  }
  const request: unknown = JSON.parse(Buffer.from(payload).toString('utf-8'));
  const errors: string[] = [];
  if (!isSentRequest(request, { errors })) {
    throw new Error(`Unexpected request to identity-provisioner: ${errors.join('; ')}`);
  }
  return request;
}
