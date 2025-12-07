/**
 * Configuration extracted from CloudFront custom origin headers
 * (Lambda@Edge doesn't support environment variables)
 */
export interface Config {
  tableName: string;
  configTable: string;
  jwkCacheTable: string;
  region: string;
  issuer: string;
}

/**
 * Extract configuration from CloudFront request
 */
export function extractConfig(request: any): Config | null {
  const customHeaders = request.origin?.s3?.customHeaders;
  
  if (!customHeaders) {
    return null;
  }

  const tableName = customHeaders['x-table-name']?.[0]?.value;
  const configTable = customHeaders['x-config-table']?.[0]?.value;
  const jwkCacheTable = customHeaders['x-jwk-cache-table']?.[0]?.value;
  const region = customHeaders['x-region']?.[0]?.value || 'us-east-1';
  const issuer = customHeaders['x-issuer']?.[0]?.value;

  if (!tableName || !configTable || !jwkCacheTable || !issuer) {
    return null;
  }

  return {
    tableName,
    configTable,
    jwkCacheTable,
    region,
    issuer,
  };
}
