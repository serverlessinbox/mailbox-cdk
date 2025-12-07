import {
  Architecture,
  FunctionOptions,
  Runtime,
  Function as LambdaFunction,
} from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ILambdaCodeProvider } from './lambda-code-provider';

export interface GoLambdaProps extends FunctionOptions {
  /**
   * Lambda identifier used by code provider (e.g., "authorizer", "api-handler")
   */
  lambdaId: string;

  /**
   * Code provider for obtaining lambda code asset
   */
  codeProvider: ILambdaCodeProvider;
}

/**
 * CDK Construct for Go Lambda functions
 *
 * Provides sensible defaults for Go binaries:
 * - Runtime: PROVIDED_AL2 (Go AL2 runtime)
 * - Handler: bootstrap (Go's AL2 handler)
 * - Architecture: ARM_64 (cost-effective)
 * - Memory: 640 MB (configurable)
 * - Logging: CloudWatch Logs with 1-month retention
 *
 * Example:
 * ```typescript
 * const authorizer = new GoLambda(this, 'Authorizer', {
 *   lambdaId: 'authorizer',
 *   codeProvider,
 *   memorySize: 256,
 *   timeout: cdk.Duration.seconds(10),
 *   environment: { ... },
 * });
 * ```
 */
export class GoLambda extends LambdaFunction {
  constructor(scope: Construct, id: string, props: GoLambdaProps) {
    const { lambdaId, codeProvider, ...lambdaProps } = props;

    const code = codeProvider.getCode(lambdaId);

    super(scope, id, {
      code,
      runtime: Runtime.PROVIDED_AL2,
      handler: 'bootstrap',
      architecture: Architecture.ARM_64,
      memorySize: 640,
      logGroup: new LogGroup(scope, `${id}-LogGroup`, {
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      ...lambdaProps,
    });
  }
}
