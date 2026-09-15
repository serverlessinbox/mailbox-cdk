import * as t from 'typanion';
import { wrapHandler } from 'aws-custom-resources';
import { withSmokeTest, emitManualFinalize, env, LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { DynamoDBClient, DescribeTableCommand, ResourceNotFoundException } from '@aws-sdk/client-dynamodb';
import { load } from './config';

const dynamodb = new DynamoDBClient({});
const { config, error: configError } = env.tryLoad(load);

const schema = t.isObject(
  {
    configTableIncomingArn: t.isString(),
    configTableOverrideArn: t.isString(),
    itemTableIncomingArn: t.isString(),
    itemTableOverrideArn: t.isString(),
    changelogTableIncomingArn: t.isString(),
    changelogTableOverrideArn: t.isString(),
    auditLogTableIncomingArn: t.isString(),
    auditLogTableOverrideArn: t.isString(),
    mailFeedbackTableIncomingArn: t.isString(),
    mailFeedbackTableOverrideArn: t.isString(),
  },
  { extra: t.isRecord(t.isUnknown()) },
);

type ResourceProperties = t.InferType<typeof schema>;

type TableRole = 'configTable' | 'itemTable' | 'changelogTable' | 'auditLogTable' | 'mailFeedbackTable';
type IncomingArnKey = 'configTableIncomingArn' | 'itemTableIncomingArn' | 'changelogTableIncomingArn' | 'auditLogTableIncomingArn' | 'mailFeedbackTableIncomingArn';
type OverrideArnKey = 'configTableOverrideArn' | 'itemTableOverrideArn' | 'changelogTableOverrideArn' | 'auditLogTableOverrideArn' | 'mailFeedbackTableOverrideArn';

const roles: readonly TableRole[] = ['configTable', 'itemTable', 'changelogTable', 'auditLogTable', 'mailFeedbackTable'];

const roleToKeys: Record<TableRole, { incoming: IncomingArnKey; override: OverrideArnKey }> = {
  configTable: { incoming: 'configTableIncomingArn', override: 'configTableOverrideArn' },
  itemTable: { incoming: 'itemTableIncomingArn', override: 'itemTableOverrideArn' },
  changelogTable: { incoming: 'changelogTableIncomingArn', override: 'changelogTableOverrideArn' },
  auditLogTable: { incoming: 'auditLogTableIncomingArn', override: 'auditLogTableOverrideArn' },
  mailFeedbackTable: { incoming: 'mailFeedbackTableIncomingArn', override: 'mailFeedbackTableOverrideArn' },
};

const arnToTableName = (arn: string): string => {
  const match = arn.match(/table\/([^/]+)$/);
  if (!match) throw new Error(`Invalid table ARN: ${arn}`);
  return match[1];
};

async function assertOverrideTableActive(role: TableRole, overrideArn: string): Promise<void> {
  let status: string | undefined;
  try {
    const resp = await dynamodb.send(new DescribeTableCommand({ TableName: arnToTableName(overrideArn) }));
    status = resp.Table?.TableStatus;
  } catch (err) {
    if (err instanceof ResourceNotFoundException) {
      throw new Error(`${role}: override table ${overrideArn} does not exist`);
    }
    throw err;
  }
  if (status !== 'ACTIVE') {
    throw new Error(`${role}: override table ${overrideArn} is not ACTIVE (status: ${status ?? 'unknown'})`);
  }
}

export const handler = withSmokeTest(wrapHandler(async (event) => {
  if (configError) throw new Error(configError);

  const logger = new LoggerBuffer(config.serviceName, config.logLevel);

  emitManualFinalize(event, { service: config.serviceName });

  try {
    if (event.RequestType === 'Delete') {
      return {};
    }

    const errors: string[] = [];
    const props = event.ResourceProperties;
    if (!schema(props, { errors })) {
      throw new Error(`Invalid ResourceProperties: ${errors.join('; ')}`);
    }
    const resourceProps: ResourceProperties = props;

    const data: Record<string, string> = {};

    for (const role of roles) {
      const keys = roleToKeys[role];
      const incomingArn = resourceProps[keys.incoming];
      const overrideArn = resourceProps[keys.override];

      let effectiveArn = incomingArn;
      if (overrideArn === incomingArn) {
        logger.info(`${role}: override matches incoming, using incoming table`);
      } else {
        await assertOverrideTableActive(role, overrideArn);
        effectiveArn = overrideArn;
        logger.info(`${role}: using override table ${overrideArn}`);
      }

      data[`${role}Arn`] = effectiveArn;
    }

    return {
      PhysicalResourceId: event.LogicalResourceId,
      Data: data,
    };
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    if (logger.shouldFlush()) {
      logger.flush();
    }
    throw err;
  }
}), env.check(load));
