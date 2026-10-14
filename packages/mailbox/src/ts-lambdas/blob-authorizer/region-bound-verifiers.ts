import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { HmacVerifier } from './hmac-verifier';
import { JwtVerifier } from './jwt-verifier';

/** The verifiers of the credentials a blob download carries, reading their keys from one auth key store. */
export interface Verifiers {
  readonly jwt: JwtVerifier;
  readonly hmac: HmacVerifier;
}

/**
 * Builds the verifiers once, in the region of the first request, and serves every later request of the
 * container from them, so the keys they cache survive across invocations. Lambda@Edge has no environment, so
 * the region first arrives with a request; a request that names another region is still served by the
 * verifiers of the first.
 */
export class RegionBoundVerifiers {
  private readonly createDynamoDBClient: (region: string) => DynamoDBClient;
  private verifiers: Verifiers | undefined;

  constructor(createDynamoDBClient: (region: string) => DynamoDBClient) {
    this.createDynamoDBClient = createDynamoDBClient;
  }

  public get(region: string): Verifiers {
    if (!this.verifiers) {
      const dynamodb = this.createDynamoDBClient(region);
      this.verifiers = { jwt: new JwtVerifier(dynamodb), hmac: new HmacVerifier(dynamodb) };
    }
    return this.verifiers;
  }
}
