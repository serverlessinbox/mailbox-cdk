import { Aws } from 'aws-cdk-lib';

/** The CloudFormation name of the cognito data sub-stack: the deploying stack's name plus `-cognito`. */
export function cognitoDataStackName(): string {
  return `${Aws.STACK_NAME}-cognito`;
}
