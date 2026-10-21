import {
  env,
  loadLogLevel,
  toFunctionName,
  type BaseConfig,
  type FunctionName,
} from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { toUserPoolId, type UserPoolId } from '../../runtime/shared/cognito-identifiers';

/**
 * The environment of the DCR Lambda: the base configuration plus its own variables. Neither has a safe default: a
 * Lambda without them would count a registration against the tenant's cap before it failed.
 */
export interface Config extends BaseConfig {
  readonly userPoolId: UserPoolId;
  readonly identityProvisionerFunctionName: FunctionName;
}

/** Reads `SERVICE_NAME` as optional where `loadBaseConfig` requires it, so an empty service name is accepted. */
export function load(l: env.Loader): Config {
  return {
    logLevel: loadLogLevel(l),
    serviceName: l.optional('SERVICE_NAME', ''),
    userPoolId: env.mandatoryAs(l, 'USER_POOL_ID', toUserPoolId, toUserPoolId('')),
    identityProvisionerFunctionName: env.mandatoryAs(l, 'IDENTITY_PROVISIONER_FUNCTION_NAME', toFunctionName, toFunctionName('')),
  };
}
