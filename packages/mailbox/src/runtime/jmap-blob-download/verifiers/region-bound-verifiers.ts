import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { Region }         from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { HmacVerifier }        from './hmac-verifier';
import { JwtVerifier }         from './jwt-verifier';

/** The verifiers of the credentials a blob download carries, reading their keys from one auth key store. */
export interface Verifiers {
  readonly jwt:  JwtVerifier;
  readonly hmac: HmacVerifier;
}

/**
 * Builds the verifiers of a region, with a DynamoDB client of that region, the first time a request names the
 * region, and serves every later request for it from the same verifiers, so the keys they cache survive across
 * invocations. Lambda@Edge has no environment, so a region first arrives with a request; each region a
 * container is asked for has verifiers of its own.
 */
export class RegionBoundVerifiers {
  private readonly createDynamoDBClient: (region: Region) => DynamoDBClient;
  private readonly verifiersByRegion = new Map<Region, Verifiers>();

  constructor(createDynamoDBClient: (region: Region) => DynamoDBClient) {
    this.createDynamoDBClient = createDynamoDBClient;
  }

  public get(region: Region): Verifiers {
    const existing = this.verifiersByRegion.get(region);
    if (existing) {
      return existing;
    }

    const dynamodb           = this.createDynamoDBClient(region);
    const created: Verifiers = { jwt: new JwtVerifier(dynamodb), hmac: new HmacVerifier(dynamodb) };
    this.verifiersByRegion.set(region, created);
    return created;
  }
}
