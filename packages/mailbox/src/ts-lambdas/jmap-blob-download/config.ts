import { toRegion, toTableName, type Region, type TableName } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { firstHeaderValue, type CloudFrontRequest } from './cloudfront-event';

/**
 * Configuration the CloudFront distribution hands the function in the custom origin headers of its S3 origin;
 * Lambda@Edge supports no environment variables.
 */
export interface Config {
  authKeyStoreTable: TableName;
  region: Region;
  jwtAlgorithms?: string[];
}

/**
 * Reads the configuration from the custom origin headers. A request that names no origin headers or no auth key
 * store table has no configuration. The region defaults to `us-east-1`, and no `x-jwt-algorithms` header leaves
 * the algorithm list unset.
 */
export function extractConfig(request: CloudFrontRequest): Config | null {
  const customHeaders = request.origin?.s3?.customHeaders;
  if (!customHeaders) {
    return null;
  }

  const authKeyStoreTable = firstHeaderValue(customHeaders, 'x-auth-key-store-table');
  if (!authKeyStoreTable) {
    return null;
  }

  const jwtAlgorithmsRaw = firstHeaderValue(customHeaders, 'x-jwt-algorithms');

  return {
    authKeyStoreTable: toTableName(authKeyStoreTable),
    region: toRegion(firstHeaderValue(customHeaders, 'x-region') || 'us-east-1'),
    jwtAlgorithms: jwtAlgorithmsRaw
      ? jwtAlgorithmsRaw.split(',').map((algorithm) => algorithm.trim()).filter(Boolean)
      : undefined,
  };
}
