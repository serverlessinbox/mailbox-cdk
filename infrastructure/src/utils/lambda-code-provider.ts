import { Code } from 'aws-cdk-lib/aws-lambda';

export interface ILambdaCodeProvider {
  /**
   * Get Lambda code for a given lambda ID
   * @param lambdaId The lambda identifier (e.g., "authorizer", "api-handler")
   * @returns Code object that can be used in Lambda function definition
   */
  getCode(lambdaId: string): Code;
}
