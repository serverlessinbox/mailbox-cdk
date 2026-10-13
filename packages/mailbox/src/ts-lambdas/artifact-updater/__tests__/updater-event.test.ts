/// <reference types="jest" />

/**
 * Pins how the updater tells its three triggers apart. A CloudFormation request and an HTTP API request carry
 * many fields beyond the ones the schemas list, so a schema that rejected the extras would send every real
 * request down the scheduled path and run an update cycle instead of answering it.
 */

import { deployEndTriggerEvent, httpApiEvent } from './updater-helpers';
import { isCfnTriggerEvent, isHttpTriggerEvent } from '../updater-event';

describe('isCfnTriggerEvent', () => {
  it.each(['Create', 'Update', 'Delete'] as const)('accepts a full %s request from CloudFormation', (requestType) => {
    expect(isCfnTriggerEvent(deployEndTriggerEvent(requestType))).toBe(true);
  });

  it.each(['ResponseURL', 'StackId', 'RequestId', 'LogicalResourceId', 'RequestType'])(
    'rejects a request without %s',
    (field) => {
      const { [field]: _removed, ...withoutField } = { ...deployEndTriggerEvent('Create') } as Record<string, unknown>;

      expect(isCfnTriggerEvent(withoutField)).toBe(false);
    },
  );

  it.each([
    ['an HTTP API request', httpApiEvent('POST', '/artifact-updates/trigger')],
    ['a scheduled event', { source: 'aws.events' }],
    ['an empty event', {}],
  ])('rejects %s', (_description, event) => {
    expect(isCfnTriggerEvent(event)).toBe(false);
  });
});

describe('isHttpTriggerEvent', () => {
  it('accepts a full HTTP API request', () => {
    expect(isHttpTriggerEvent(httpApiEvent('POST', '/artifact-updates/trigger'))).toBe(true);
  });

  it.each([
    ['a request context without http', { requestContext: {} }],
    ['a request context whose http is not an object', { requestContext: { http: 'POST' } }],
  ])('accepts %s, which is answered as an HTTP request', (_description, event) => {
    expect(isHttpTriggerEvent(event)).toBe(true);
  });

  it.each([
    ['a CloudFormation request', deployEndTriggerEvent('Create')],
    ['an event without a request context', { rawPath: '/artifact-updates/trigger' }],
    ['an empty event', {}],
  ])('rejects %s', (_description, event) => {
    expect(isHttpTriggerEvent(event)).toBe(false);
  });
});
