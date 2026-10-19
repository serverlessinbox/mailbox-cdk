import { toRegion, toTableName, type Region, type TableName } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import * as t from 'typanion';
import { firstHeaderValue, type CloudFrontRequest } from './cloudfront-event';
import { isSupportedAlgorithm, type SupportedAlgorithm } from './jwt-verifier';

/**
 * The custom origin headers the CDN sets on the S3 origin and this function reads, with the value each carries.
 * The CDN construct builds its headers against this type, so a header added, removed or renamed here breaks
 * its compile. `x-jwt-algorithms` is typed as the single algorithm the CDN sends.
 */
export type BlobDownloadOriginHeaders = {
  'x-auth-key-store-table': string;
  'x-region': string;
  'x-jwt-algorithms': SupportedAlgorithm;
};

const AUTH_KEY_STORE_TABLE_HEADER = 'x-auth-key-store-table' satisfies keyof BlobDownloadOriginHeaders;
const REGION_HEADER = 'x-region' satisfies keyof BlobDownloadOriginHeaders;
const JWT_ALGORITHMS_HEADER = 'x-jwt-algorithms' satisfies keyof BlobDownloadOriginHeaders;

// An AWS region code: a two-letter geography, one or more direction words and a number, such as `eu-west-1` or `us-gov-east-1`.
const isRegionCode = t.cascade(t.isString(), [t.matchesRegExp(/^[a-z]{2}(-[a-z]+)+-\d$/)]);

/**
 * Configuration the CloudFront distribution hands the function in the custom origin headers of its S3 origin;
 * Lambda@Edge supports no environment variables.
 */
export interface Config {
  authKeyStoreTable: TableName;
  region: Region;
  jwtAlgorithms?: string[];
}

/** The configuration read from the origin headers. */
interface ConfigRead {
  readonly config: Config;
}

/** Why the configuration cannot be read: names the origin header that is missing or invalid, and never carries a header value. */
interface ConfigRejected {
  readonly problem: string;
}

export type ConfigReading = ConfigRead | ConfigRejected;

/**
 * Reads the configuration from the custom origin headers. The auth key store table and the region are required,
 * and a region must have the shape of an AWS region code; no `x-jwt-algorithms` header leaves the algorithm list
 * unset, and one that is present must list only supported algorithms. The first header that is missing or invalid
 * is named in the rejection.
 */
export function extractConfig(request: CloudFrontRequest): ConfigReading {
  const customHeaders = request.origin?.s3?.customHeaders;
  if (!customHeaders) {
    return { problem: 'the custom origin headers of the S3 origin are missing' };
  }

  const authKeyStoreTable = firstHeaderValue(customHeaders, AUTH_KEY_STORE_TABLE_HEADER);
  if (!authKeyStoreTable) {
    return { problem: `header ${AUTH_KEY_STORE_TABLE_HEADER} is missing or empty` };
  }

  const region = firstHeaderValue(customHeaders, REGION_HEADER);
  if (!region) {
    return { problem: `header ${REGION_HEADER} is missing or empty` };
  }

  if (!isRegionCode(region)) {
    return { problem: `header ${REGION_HEADER} is not an AWS region code` };
  }

  const jwtAlgorithmsRaw = firstHeaderValue(customHeaders, JWT_ALGORITHMS_HEADER);
  const jwtAlgorithms = jwtAlgorithmsRaw
    ? jwtAlgorithmsRaw.split(',').map((algorithm) => algorithm.trim()).filter(Boolean)
    : undefined;
  if (jwtAlgorithms && (jwtAlgorithms.length === 0 || !jwtAlgorithms.every((algorithm) => isSupportedAlgorithm(algorithm)))) {
    return { problem: `header ${JWT_ALGORITHMS_HEADER} is not a comma-separated list of supported algorithms` };
  }

  return {
    config: {
      authKeyStoreTable: toTableName(authKeyStoreTable),
      region: toRegion(region),
      jwtAlgorithms,
    },
  };
}
