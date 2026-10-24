import {
  env,
  loadBaseConfig,
  toFunctionName,
  type BaseConfig,
  type FunctionName,
} from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { toUserPoolId, type UserPoolId } from '../shared/cognito-identifiers';

/**
 * The environment of the DCR Lambda: the base configuration plus its own variables. Neither has a safe default: a
 * Lambda without them would count a registration against the tenant's cap before it failed.
 */
export interface Config extends BaseConfig {
  readonly userPoolId:                      UserPoolId;
  readonly identityProvisionerFunctionName: FunctionName;
}

export function load(loader: env.Loader): Config {
  return {
    ...loadBaseConfig(loader),
    userPoolId:                      env.mandatoryAs(loader, 'USER_POOL_ID', toUserPoolId, toUserPoolId('')),
    identityProvisionerFunctionName: env.mandatoryAs(loader, 'IDENTITY_PROVISIONER_FUNCTION_NAME', toFunctionName, toFunctionName('')),
  };
}
