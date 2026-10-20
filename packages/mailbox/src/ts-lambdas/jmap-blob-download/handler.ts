import { DynamoDBClient }                               from '@aws-sdk/client-dynamodb';
import { ExpectedFailure, LoggerBuffer, withSmokeTest } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { BlobDownloadAuthorizer }                       from './blob-download-authorizer';
import { readOriginRequest }                            from './cloudfront-event';
import { RegionBoundVerifiers }                         from './region-bound-verifiers';

const verifiers = new RegionBoundVerifiers((region) => new DynamoDBClient({ region }));

/**
 * Lambda@Edge origin-request handler that authorizes blob downloads (JMAP download URL, RFC 8620): an allowed
 * request is returned rewritten to the blob's S3 key, anything else is answered with a CloudFront response.
 * The smoke-test probe is answered with no checks, because a Lambda@Edge function has no environment to check.
 */
export const handler = withSmokeTest(async (event: unknown) => {
  const logger     = new LoggerBuffer();
  const authorizer = new BlobDownloadAuthorizer(logger, (region) => verifiers.get(region));

  try {
    return await authorizer.authorize(readOriginRequest(event));
  } catch (thrown) {
    const answer = authorizer.answerFailure(thrown);
    if (!(thrown instanceof ExpectedFailure)) {
      logger.flush();
    }
    return answer;
  }
});
