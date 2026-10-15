import {
  env,
  loadLogLevel,
  toFunctionName,
  type BaseConfig,
  type FunctionName,
} from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { toUserPoolId, type UserPoolId } from '../shared/cognito-identifiers';

/**
 * The environment variables this Lambda reads besides the ones every Lambda has. Neither has a safe default: a
 * Lambda without them would count a registration against the tenant's cap before it failed.
 */
export type JmapOAuthDcrEnvironment = {
  readonly USER_POOL_ID: string;
  readonly IDENTITY_PROVISIONER_FUNCTION_NAME: string;
};

/** The environment of the DCR Lambda: the base configuration plus the variables of `JmapOAuthDcrEnvironment`. */
export interface Config extends BaseConfig {
  readonly userPoolId: UserPoolId;
  readonly identityProvisionerFunctionName: FunctionName;
}

const Variable: { readonly [Name in keyof JmapOAuthDcrEnvironment]-?: Name } = {
  USER_POOL_ID: 'USER_POOL_ID',
  IDENTITY_PROVISIONER_FUNCTION_NAME: 'IDENTITY_PROVISIONER_FUNCTION_NAME',
};

/** Reads `SERVICE_NAME` as optional where `loadBaseConfig` requires it, so an empty service name is accepted. */
export function load(l: env.Loader): Config {
  return {
    logLevel: loadLogLevel(l),
    serviceName: l.optional('SERVICE_NAME', ''),
    userPoolId: env.mandatoryAs(l, Variable.USER_POOL_ID, toUserPoolId, toUserPoolId('')),
    identityProvisionerFunctionName: env.mandatoryAs(l, Variable.IDENTITY_PROVISIONER_FUNCTION_NAME, toFunctionName, toFunctionName('')),
  };
}
