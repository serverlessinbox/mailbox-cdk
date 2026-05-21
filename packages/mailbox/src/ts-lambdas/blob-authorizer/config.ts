/**
 * Configuration extracted from CloudFront custom origin headers
 * (Lambda@Edge doesn't support environment variables)
 */
export interface Config {
  jwkCacheTable: string;
  region: string;
  jwtAlgorithms?: string[];
}

/**
 * Extract configuration from CloudFront request
 */
export function extractConfig(request: any): Config | null {
  const customHeaders = request.origin?.s3?.customHeaders;

  if (!customHeaders) {
    return null;
  }

  const jwkCacheTable = customHeaders['x-jwk-cache-table']?.[0]?.value;
  const region = customHeaders['x-region']?.[0]?.value || 'us-east-1';
  const jwtAlgorithmsRaw = customHeaders['x-jwt-algorithms']?.[0]?.value;

  if (!jwkCacheTable) {
    return null;
  }

  return {
    jwkCacheTable,
    region,
    jwtAlgorithms: jwtAlgorithmsRaw
      ? jwtAlgorithmsRaw
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean)
      : undefined,
  };
}
