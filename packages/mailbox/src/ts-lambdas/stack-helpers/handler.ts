import { wrapHandler } from 'aws-custom-resources';
import { Route53Client, GetHostedZoneCommand } from '@aws-sdk/client-route-53';

const r53 = new Route53Client({});

function sanitizeStackName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export const handler = wrapHandler(async (event) => {
  if (event.RequestType === 'Delete') return {};

  const hostedZoneId: string  = event.ResourceProperties?.HostedZoneId ?? '';
  const dataStackName: string = event.ResourceProperties?.DataStackName ?? '';

  const resp = await r53.send(new GetHostedZoneCommand({ Id: hostedZoneId }));
  const domainName = (resp.HostedZone?.Name ?? '').replace(/\.$/, '');
  const s3SafeDataStackName = sanitizeStackName(dataStackName);

  return { Data: { domainName, s3SafeDataStackName } };
});
