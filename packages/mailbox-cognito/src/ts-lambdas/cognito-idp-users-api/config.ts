import {
  env,
  loadLogLevel,
  toFunctionName,
  toQueueUrl,
  type BaseConfig,
  type FunctionName,
  type QueueUrl,
} from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import * as t                                                         from 'typanion';

import { isGroupName, toUserPoolId, type GroupName, type UserPoolId } from '../../runtime/shared/cognito-identifiers';

const isGroupNameArray = t.isArray(isGroupName);

/**
 * The environment of the IdP users API Lambda: the base configuration plus its own variables. The group
 * variables hold a JSON array of group names and are absent when the user pool defines none.
 */
export interface Config extends BaseConfig {
  readonly userPoolId: UserPoolId;
  readonly auditEventsQueueUrl: QueueUrl;
  readonly identityProvisionerFunctionName: FunctionName;
  readonly adminGroups?: GroupName[];
  readonly userGroups?: GroupName[];
}

/** Reads `SERVICE_NAME` as optional where `loadBaseConfig` requires it, so an empty service name is accepted. */
export function load(l: env.Loader): Config {
  return {
    logLevel: loadLogLevel(l),
    serviceName: l.optional('SERVICE_NAME', ''),
    userPoolId: env.mandatoryAs(l, 'USER_POOL_ID', toUserPoolId, toUserPoolId('')),
    auditEventsQueueUrl: env.mandatoryAs(l, 'AUDIT_EVENTS_QUEUE_URL', toQueueUrl, toQueueUrl('')),
    identityProvisionerFunctionName: env.mandatoryAs(l, 'IDENTITY_PROVISIONER_FUNCTION_NAME', toFunctionName, toFunctionName('')),
    adminGroups: env.optionalAs(l, 'ADMIN_GROUPS', undefined, env.json(isGroupNameArray)),
    userGroups: env.optionalAs(l, 'USER_GROUPS', undefined, env.json(isGroupNameArray)),
  };
}
