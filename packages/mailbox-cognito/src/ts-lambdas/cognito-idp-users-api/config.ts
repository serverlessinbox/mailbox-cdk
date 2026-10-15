import * as t from 'typanion';
import {
  env,
  loadLogLevel,
  toFunctionName,
  toQueueUrl,
  type BaseConfig,
  type FunctionName,
  type QueueUrl,
} from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { isGroupName, toUserPoolId, type GroupName, type UserPoolId } from '../shared/cognito-identifiers';

const isGroupNameArray = t.isArray(isGroupName);

/**
 * The environment variables this Lambda reads besides the ones every Lambda has. The group variables hold a
 * JSON array of group names and are absent when the user pool defines none.
 */
export type IdpUsersApiEnvironment = {
  readonly USER_POOL_ID: string;
  readonly AUDIT_EVENTS_QUEUE_URL: string;
  readonly IDENTITY_PROVISIONER_FUNCTION_NAME: string;
  readonly ADMIN_GROUPS?: string;
  readonly USER_GROUPS?: string;
};

/** The environment of the IdP users API Lambda: the base configuration plus the variables of `IdpUsersApiEnvironment`. */
export interface Config extends BaseConfig {
  readonly userPoolId: UserPoolId;
  readonly auditEventsQueueUrl: QueueUrl;
  readonly identityProvisionerFunctionName: FunctionName;
  readonly adminGroups?: GroupName[];
  readonly userGroups?: GroupName[];
}

const Variable: { readonly [Name in keyof IdpUsersApiEnvironment]-?: Name } = {
  USER_POOL_ID: 'USER_POOL_ID',
  AUDIT_EVENTS_QUEUE_URL: 'AUDIT_EVENTS_QUEUE_URL',
  IDENTITY_PROVISIONER_FUNCTION_NAME: 'IDENTITY_PROVISIONER_FUNCTION_NAME',
  ADMIN_GROUPS: 'ADMIN_GROUPS',
  USER_GROUPS: 'USER_GROUPS',
};

/** Reads `SERVICE_NAME` as optional where `loadBaseConfig` requires it, so an empty service name is accepted. */
export function load(l: env.Loader): Config {
  return {
    logLevel: loadLogLevel(l),
    serviceName: l.optional('SERVICE_NAME', ''),
    userPoolId: env.mandatoryAs(l, Variable.USER_POOL_ID, toUserPoolId, toUserPoolId('')),
    auditEventsQueueUrl: env.mandatoryAs(l, Variable.AUDIT_EVENTS_QUEUE_URL, toQueueUrl, toQueueUrl('')),
    identityProvisionerFunctionName: env.mandatoryAs(l, Variable.IDENTITY_PROVISIONER_FUNCTION_NAME, toFunctionName, toFunctionName('')),
    adminGroups: env.optionalAs(l, Variable.ADMIN_GROUPS, undefined, env.json(isGroupNameArray)),
    userGroups: env.optionalAs(l, Variable.USER_GROUPS, undefined, env.json(isGroupNameArray)),
  };
}
