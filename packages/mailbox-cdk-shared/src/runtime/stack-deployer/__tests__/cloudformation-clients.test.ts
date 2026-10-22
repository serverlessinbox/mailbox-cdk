import { CloudFormationClient }  from '@aws-sdk/client-cloudformation';

import { CloudFormationClients } from '../cloudformation-clients';

import { EU_WEST_1, US_EAST_1 }  from './stack-deployer-helpers';

/**
 * Pins when a client per region is built: once on first use and then reused. A client built on every call
 * would discard the connection reuse of a warm invocation; one shared by all regions would send a stack
 * operation to the wrong region.
 */
describe('CloudFormationClients', () => {
  function clientsBuiltBy(build: jest.Mock<CloudFormationClient, [string]>): CloudFormationClients {
    return new CloudFormationClients(build);
  }

  function buildingClients(): jest.Mock<CloudFormationClient, [string]> {
    return jest.fn((region: string) => new CloudFormationClient({ region }));
  }

  it('builds nothing until a region is asked for', () => {
    const build = buildingClients();

    clientsBuiltBy(build);

    expect(build).not.toHaveBeenCalled();
  });

  it('builds the client of a region once and returns the same client afterwards', () => {
    const build   = buildingClients();
    const clients = clientsBuiltBy(build);

    const first  = clients.forRegion(US_EAST_1);
    const second = clients.forRegion(US_EAST_1);

    expect(second).toBe(first);
    expect(build).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalledWith(US_EAST_1);
  });

  it('builds a separate client for each region', () => {
    const build   = buildingClients();
    const clients = clientsBuiltBy(build);

    const inUsEast1 = clients.forRegion(US_EAST_1);
    const inEuWest1 = clients.forRegion(EU_WEST_1);

    expect(inEuWest1).not.toBe(inUsEast1);
    expect(build.mock.calls).toEqual([[US_EAST_1], [EU_WEST_1]]);
  });
});
