/**
 * Pins that the verifiers, and the key caches they hold, are built once per container in the region of the
 * first request. A rebuild per request would discard the cached signing keys and read the auth key store on
 * every download.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { RegionBoundVerifiers } from '../region-bound-verifiers';
import { EU_WEST_1, US_EAST_1 } from './jmap-blob-download-helpers';

describe('RegionBoundVerifiers', () => {
  it('creates the DynamoDB client in the region of the first request', () => {
    const createDynamoDBClient = jest.fn((region: string) => new DynamoDBClient({ region }));

    new RegionBoundVerifiers(createDynamoDBClient).get(EU_WEST_1);

    expect(createDynamoDBClient).toHaveBeenCalledWith(EU_WEST_1);
  });

  it('serves later requests, whatever region they name, from the verifiers of the first', () => {
    const createDynamoDBClient = jest.fn((region: string) => new DynamoDBClient({ region }));
    const verifiers = new RegionBoundVerifiers(createDynamoDBClient);

    const first = verifiers.get(EU_WEST_1);
    const second = verifiers.get(US_EAST_1);

    expect(second).toBe(first);
    expect(createDynamoDBClient).toHaveBeenCalledTimes(1);
  });
});
