/**
 * Configuration extracted from CloudFront custom origin headers
 * (Lambda@Edge doesn't support environment variables)
 */
export interface Config {
  authKeyStoreTable: string;   // was: jwkCacheTable
  region: string;
  jwtAlgorithms?: string[];
  /** The pipeline this function's traffic belongs to, read from the `x-pipeline` custom origin header. */
  pipeline?: string;
}

export function extractConfig(request: any): Config | null {
  const customHeaders = request.origin?.s3?.customHeaders;
  if (!customHeaders) return null;

  const authKeyStoreTable = customHeaders['x-auth-key-store-table']?.[0]?.value;  // was: x-jwk-cache-table
  const region = customHeaders['x-region']?.[0]?.value || 'us-east-1';
  const jwtAlgorithmsRaw = customHeaders['x-jwt-algorithms']?.[0]?.value;
  const pipeline = customHeaders['x-pipeline']?.[0]?.value;

  if (!authKeyStoreTable) return null;

  return {
    authKeyStoreTable,
    region,
    jwtAlgorithms: jwtAlgorithmsRaw
      ? jwtAlgorithmsRaw.split(',').map((s: string) => s.trim()).filter(Boolean)
      : undefined,
    pipeline,
  };
}
