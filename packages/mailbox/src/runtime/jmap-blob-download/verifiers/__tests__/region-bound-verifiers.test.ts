/**
 * Pins that each region gets verifiers of its own, built with a DynamoDB client of that region, and that a
 * region's verifiers, and the key caches they hold, are built once per container. A rebuild per request would
 * discard the cached signing keys and read the auth key store on every download; serving a region from the
 * verifiers of another would read its auth key store through a client in the wrong region.
 */

import { DynamoDBClient }       from '@aws-sdk/client-dynamodb';

import { EU_WEST_1, US_EAST_1 } from '../../__tests__/jmap-blob-download-helpers';
import { RegionBoundVerifiers } from '../region-bound-verifiers';

/** The factory the verifiers are built with: a spy that records each region asked for and returns a real client of that region. */
function createRegionClient(): jest.Mock<DynamoDBClient, [string]> {
  return jest.fn((region: string) => new DynamoDBClient({ region }));
}

describe('RegionBoundVerifiers', () => {
  it('creates the DynamoDB client in the region of the request', () => {
    const createDynamoDBClient = createRegionClient();

    new RegionBoundVerifiers(createDynamoDBClient).get(EU_WEST_1);

    expect(createDynamoDBClient).toHaveBeenCalledWith(EU_WEST_1);
  });

  it('serves a later request for the same region from the verifiers it built before', () => {
    const createDynamoDBClient = createRegionClient();
    const verifiers            = new RegionBoundVerifiers(createDynamoDBClient);

    const first  = verifiers.get(EU_WEST_1);
    const second = verifiers.get(EU_WEST_1);

    expect(second).toBe(first);
    expect(createDynamoDBClient).toHaveBeenCalledTimes(1);
  });

  it('builds verifiers with a client of their own for each region it is asked for', () => {
    const createDynamoDBClient = createRegionClient();
    const verifiers            = new RegionBoundVerifiers(createDynamoDBClient);

    const inEuWest1 = verifiers.get(EU_WEST_1);
    const inUsEast1 = verifiers.get(US_EAST_1);

    expect(inUsEast1).not.toBe(inEuWest1);
    expect(inUsEast1.jwt).not.toBe(inEuWest1.jwt);
    expect(inUsEast1.hmac).not.toBe(inEuWest1.hmac);
    expect(createDynamoDBClient.mock.calls).toEqual([[EU_WEST_1], [US_EAST_1]]);
  });
});
