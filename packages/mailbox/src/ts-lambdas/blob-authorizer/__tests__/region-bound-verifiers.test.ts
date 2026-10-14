/**
 * Pins that the verifiers, and the key caches they hold, are built once per container in the region of the
 * first request. A rebuild per request would discard the cached signing keys and read the auth key store on
 * every download.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { RegionBoundVerifiers } from '../region-bound-verifiers';

describe('RegionBoundVerifiers', () => {
  it('creates the DynamoDB client in the region of the first request', () => {
    const createDynamoDBClient = jest.fn((region: string) => new DynamoDBClient({ region }));

    new RegionBoundVerifiers(createDynamoDBClient).get('eu-west-1');

    expect(createDynamoDBClient).toHaveBeenCalledWith('eu-west-1');
  });

  it('serves later requests, whatever region they name, from the verifiers of the first', () => {
    const createDynamoDBClient = jest.fn((region: string) => new DynamoDBClient({ region }));
    const verifiers = new RegionBoundVerifiers(createDynamoDBClient);

    const first = verifiers.get('eu-west-1');
    const second = verifiers.get('us-east-1');

    expect(second).toBe(first);
    expect(createDynamoDBClient).toHaveBeenCalledTimes(1);
  });
});
