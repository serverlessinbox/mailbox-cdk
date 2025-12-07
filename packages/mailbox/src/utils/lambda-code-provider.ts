import { Code } from 'aws-cdk-lib/aws-lambda';

/**
 * Interface for providing Lambda code
 */
export interface ILambdaCodeProvider {
  getCode(lambdaId: string): Code;
}
