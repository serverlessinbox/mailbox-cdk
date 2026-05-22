/**
 * Configuration extracted from CloudFront custom origin headers
 * (Lambda@Edge doesn't support environment variables)
 */
export interface Config {
  tableName: string;
  configTable: string;
  authKeyStoreTable: string;
  region: string;
  jwtAlgorithms?: string[];
  authPolicyName: string;
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
  const authKeyStoreTable = customHeaders['x-auth-key-store-table']?.[0]?.value;
  const region = customHeaders['x-region']?.[0]?.value || 'us-east-1';
  const jwtAlgorithmsRaw = customHeaders['x-jwt-algorithms']?.[0]?.value;
  const authPolicyName = customHeaders['x-auth-policy-name']?.[0]?.value;

  if (!tableName || !configTable || !authKeyStoreTable || !authPolicyName?.trim()) {
    return null;
  }

  return {
    tableName,
    configTable,
    authKeyStoreTable,
    region,
    jwtAlgorithms: jwtAlgorithmsRaw
      ? jwtAlgorithmsRaw
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean)
      : undefined,
    authPolicyName: authPolicyName.trim(),
  };
}
