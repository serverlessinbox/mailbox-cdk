/**
 * Pins how a custom-resource request is answered when the configuration failed to load: a Delete is answered
 * SUCCESS so a stack in DELETE_FAILED can still be deleted, and every other request throws the configuration
 * error so CloudFormation gets a FAILED that names the problem.
 */

import { answerRequestWithBadConfig }       from '../custom-resource-bad-config-answer';

import { cfnRequest, PHYSICAL_RESOURCE_ID } from './custom-resource-request-helpers';

describe('answerRequestWithBadConfig', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('answers SUCCESS to a Delete with the incoming physical id, and logs the configuration error', () => {
    const answer = answerRequestWithBadConfig(cfnRequest('Delete'), 'LOG_LEVEL: invalid');

    expect(answer).toEqual({ PhysicalResourceId: PHYSICAL_RESOURCE_ID });
    expect(console.error).toHaveBeenCalledWith(
      'Configuration error on Delete; responding SUCCESS so stack deletion is not blocked',
      { error: 'LOG_LEVEL: invalid' },
    );
  });

  it.each(['Create', 'Update'] as const)('throws the configuration error for a %s', (requestType) => {
    expect(() => answerRequestWithBadConfig(cfnRequest(requestType), 'LOG_LEVEL: invalid')).toThrow(
      new Error('LOG_LEVEL: invalid'),
    );
    expect(console.error).not.toHaveBeenCalled();
  });
});
