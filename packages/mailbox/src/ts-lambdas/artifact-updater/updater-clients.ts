import type { CloudFrontClient } from '@aws-sdk/client-cloudfront';
import type { LambdaClient } from '@aws-sdk/client-lambda';
import type { ResourceGroupsTaggingAPIClient } from '@aws-sdk/client-resource-groups-tagging-api';
import type { S3Client } from '@aws-sdk/client-s3';
import { toRegion, type Region } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

/** Lambda@Edge functions and the CloudFront API live in this region regardless of the deployment region. */
export const EDGE_REGION = toRegion('us-east-1');

/** The clients the updater needs in one region it scans for artifacts. */
export interface RegionClients {
  readonly region: Region;
  readonly lambda: LambdaClient;
  readonly tagging: ResourceGroupsTaggingAPIClient;
}

/**
 * Every AWS client the artifact updater uses, built once by the entry point and handed down.
 * Modules below the entry point never construct a client of their own.
 */
export interface UpdaterClients {
  /** Reads release pointers and artifacts from any region (follows redirects); also writes UI content in the deployment region. */
  readonly registryS3: S3Client;
  readonly deployment: RegionClients;
  /** The same instance as `deployment` when the deployment region is the edge region. */
  readonly edge: RegionClients;
  readonly cloudFront: CloudFrontClient;
}
