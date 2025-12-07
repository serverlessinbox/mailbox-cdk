import { Code } from 'aws-cdk-lib/aws-lambda';
import { ILambdaCodeProvider } from './lambda-code-provider';

export interface UrlLambdaCodeProviderConfig {
  s3Bucket: string;     // S3 bucket name
  s3KeyPrefix: string;  // e.g., "lambdas/v1.0.0/"
}

/**
 * Provides Lambda code from S3 (external code)
 *
 * Expects Lambda ZIPs to be located at:
 * s3://{bucket}/{s3KeyPrefix}{lambdaId}/lambda.zip
 *
 * CloudFormation will reference the code externally without downloading.
 * Useful for production deployments where lambdas are pre-built and signed.
 */
export class UrlLambdaCodeProvider implements ILambdaCodeProvider {
  private config: UrlLambdaCodeProviderConfig;

  constructor(config: UrlLambdaCodeProviderConfig) {
    this.config = config;
  }

  getCode(lambdaId: string): Code {
    const s3Key = `${this.config.s3KeyPrefix}${lambdaId}/lambda.zip`;
    return Code.fromBucket(
      {
        bucketName: this.config.s3Bucket,
      } as any,
      s3Key
    );
  }
}
