import { CloudFrontClient } from '@aws-sdk/client-cloudfront';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { ResourceGroupsTaggingAPIClient } from '@aws-sdk/client-resource-groups-tagging-api';
import { S3Client } from '@aws-sdk/client-s3';
import { EDGE_REGION, type RegionClients, type UpdaterClients } from '../updater-clients';

function regionClients(region: string): RegionClients {
  return { region, lambda: new LambdaClient({ region }), tagging: new ResourceGroupsTaggingAPIClient({ region }) };
}

/**
 * Stands in for the clients the entry point builds. The instances are real SDK clients so tests
 * can stub them with aws-sdk-client-mock; the edge set is shared with the deployment set when
 * the deployment region is the edge region, as in the entry point.
 */
export function fakeUpdaterClients(deploymentRegion: string = EDGE_REGION): UpdaterClients {
  const deployment = regionClients(deploymentRegion);
  return {
    registryS3: new S3Client({ region: deploymentRegion }),
    deployment,
    edge: deploymentRegion === EDGE_REGION ? deployment : regionClients(EDGE_REGION),
    cloudFront: new CloudFrontClient({ region: EDGE_REGION }),
  };
}
