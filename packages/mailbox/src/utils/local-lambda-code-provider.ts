import { Code } from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';
import { ILambdaCodeProvider } from './lambda-code-provider';

export interface LocalLambdaCodeProviderConfig {
  readonly basePath: string;
}

/**
 * Provides Lambda code from local filesystem
 * Useful for development
 */
export class LocalLambdaCodeProvider implements ILambdaCodeProvider {
  private config: LocalLambdaCodeProviderConfig;

  constructor(config: LocalLambdaCodeProviderConfig) {
    this.config = config;
  }

  getCode(lambdaId: string): Code {
    const lambdaPath = path.join(this.config.basePath, lambdaId);
    return Code.fromAsset(lambdaPath);
  }
}
