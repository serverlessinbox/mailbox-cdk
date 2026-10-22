/// <reference types="jest" />

/**
 * Pins how the updater tells its three triggers apart. A CloudFormation request and an HTTP API request carry
 * many fields beyond the ones the schemas list, so a schema that rejected the extras would send every real
 * request down the scheduled path and run an update cycle instead of answering it. A request the schema does
 * not recognise is also run as a scheduled event, so every field a request variant must carry is pinned.
 */

import { isCfnTriggerEvent, isHttpTriggerEvent } from '../updater-event';

import { deployEndTriggerEvent, httpApiEvent }   from './updater-helpers';

/** A copy of the event without the given field, so a test can leave out exactly the field it pins. */
function withoutField(event: object, field: string): object {
  return Object.fromEntries(Object.entries(event).filter(([key]) => key !== field));
}

describe('isCfnTriggerEvent', () => {
  it.each(['Create', 'Update', 'Delete'] as const)('accepts a full %s request from CloudFormation', (requestType) => {
    expect(isCfnTriggerEvent(deployEndTriggerEvent(requestType))).toBe(true);
  });

  it.each(['ServiceToken', 'ResponseURL', 'StackId', 'RequestId', 'LogicalResourceId', 'ResourceType', 'ResourceProperties', 'RequestType'])(
    'rejects a request without %s',
    (field) => {
      expect(isCfnTriggerEvent(withoutField(deployEndTriggerEvent('Create'), field))).toBe(false);
    },
  );

  it.each([
    { requestType: 'Update', field: 'PhysicalResourceId' },
    { requestType: 'Update', field: 'OldResourceProperties' },
    { requestType: 'Delete', field: 'PhysicalResourceId' },
  ] as const)('rejects a $requestType request without $field', ({ requestType, field }) => {
    expect(isCfnTriggerEvent(withoutField(deployEndTriggerEvent(requestType), field))).toBe(false);
  });

  it('rejects a request whose type is none CloudFormation sends', () => {
    expect(isCfnTriggerEvent({ ...deployEndTriggerEvent('Create'), RequestType: 'Replace' })).toBe(false);
  });

  it.each([
    { event: 'an HTTP API request', value: httpApiEvent('POST', '/artifact-updates/trigger') },
    { event: 'a scheduled event', value: { source: 'aws.events' } },
    { event: 'an empty event', value: {} },
  ])('rejects $event', ({ value }) => {
    expect(isCfnTriggerEvent(value)).toBe(false);
  });
});

describe('isHttpTriggerEvent', () => {
  it('accepts a full HTTP API request', () => {
    expect(isHttpTriggerEvent(httpApiEvent('POST', '/artifact-updates/trigger'))).toBe(true);
  });

  it.each([
    { event: 'a request context without http', value: { requestContext: {} } },
    { event: 'a request context whose http is not an object', value: { requestContext: { http: 'POST' } } },
  ])('accepts $event, which is answered as an HTTP request', ({ value }) => {
    expect(isHttpTriggerEvent(value)).toBe(true);
  });

  it.each([
    { event: 'a CloudFormation request', value: deployEndTriggerEvent('Create') },
    { event: 'an event without a request context', value: { rawPath: '/artifact-updates/trigger' } },
    { event: 'an empty event', value: {} },
  ])('rejects $event', ({ value }) => {
    expect(isHttpTriggerEvent(value)).toBe(false);
  });
});
