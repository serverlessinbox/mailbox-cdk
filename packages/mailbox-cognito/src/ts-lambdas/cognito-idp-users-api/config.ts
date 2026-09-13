import * as t from 'typanion';
import { env, parseLogLevelStrict, type LogLevel } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

const isStringArray = t.isArray(t.isString());

export interface Config {
  readonly logLevel: LogLevel;
  readonly userPoolId: string;
  readonly auditEventsQueueUrl: string;
  readonly adminGroups?: string[];
  readonly userGroups?: string[];
}

export function load(l: env.Loader): Config {
  return {
    logLevel: env.optionalAs(l, 'LOG_LEVEL', 'error', parseLogLevelStrict),
    userPoolId: l.mandatory('USER_POOL_ID'),
    auditEventsQueueUrl: l.mandatory('AUDIT_EVENTS_QUEUE_URL'),
    adminGroups: env.optionalAs(l, 'ADMIN_GROUPS', undefined, env.json(isStringArray)),
    userGroups: env.optionalAs(l, 'USER_GROUPS', undefined, env.json(isStringArray)),
  };
}
