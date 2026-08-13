import { wrapHandler } from 'aws-custom-resources';
import { Route53Client, GetHostedZoneCommand } from '@aws-sdk/client-route-53';

const r53 = new Route53Client({});

export function sanitizeStackName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function deriveCognitoDomainPrefix(domainName: string, fallback: string): string {
  // Step 1: Lowercase
  let result = domainName.toLowerCase();

  // Step 2: Replace every character not in [a-z0-9] with -
  result = result.replace(/[^a-z0-9]/g, '-');

  // Step 3: Collapse repeated - runs to one
  result = result.replace(/-+/g, '-');

  // Step 4: Strip the reserved substrings aws, amazon, cognito (replace with -)
  result = result.replace(/aws|amazon|cognito/g, '-');

  // Step 5: Collapse repeated - again
  result = result.replace(/-+/g, '-');

  // Step 6: Trim leading/trailing -
  result = result.replace(/^-+|-+$/g, '');

  // Step 7: Truncate to 63 chars, then re-trim trailing -
  result = result.slice(0, 63).replace(/-+$/, '');

  // Step 8: If result is empty, fall back
  if (result === '') {
    if (fallback === '') {
      return 'installer';
    }
    return deriveCognitoDomainPrefix(fallback, '');
  }

  return result;
}

export const handler = wrapHandler(async (event) => {
  if (event.RequestType === 'Delete') return {};

  const hostedZoneId: string  = event.ResourceProperties?.HostedZoneId ?? '';
  const dataStackName: string = event.ResourceProperties?.DataStackName ?? '';
  const fallback: string = event.ResourceProperties?.Fallback ?? '';

  let domainName = '';
  if (hostedZoneId) {
    const resp = await r53.send(new GetHostedZoneCommand({ Id: hostedZoneId }));
    domainName = (resp.HostedZone?.Name ?? '').replace(/\.$/, '');
  }
  const s3SafeDataStackName = sanitizeStackName(dataStackName);
  const cognitoDomainPrefix = deriveCognitoDomainPrefix(domainName, fallback || s3SafeDataStackName);

  return { Data: { domainName, s3SafeDataStackName, cognitoDomainPrefix } };
});
