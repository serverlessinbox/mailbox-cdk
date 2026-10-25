import { DescribeTableCommand, ResourceNotFoundException, type DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  CaughtError,
  ExpectedFailure,
  parseArn,
  toTableName,
  type LoggerBuffer,
  type ParsedArn,
  type TableName,
} from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { isResourceProperties, type ResourceProperties, type TableRole } from './resource-properties';

/** The effective table ARN of each role, under the attribute name `<role>Arn` the custom resource answers CloudFormation with. */
export type ResolvedTableArns = { readonly [R in TableRole as `${R}Arn`]: string };

/**
 * Decides, per data table role, which table ARN is in effect: the stack's own (incoming) table, or an
 * operator-chosen override. It reads the override table's state from DynamoDB but never writes.
 */
export class TableOverrideResolver {
  constructor(
    private readonly dynamodb: DynamoDBClient,
    private readonly logger: LoggerBuffer,
  ) {}

  /**
   * Resolves the effective ARN of every table role from the custom-resource properties. A role whose
   * override equals its incoming ARN keeps the incoming table; a differing override replaces it,
   * provided the override table exists and is ACTIVE. Rejects with an `ExpectedFailure` naming the role
   * when an override table is missing, not ACTIVE, or not a table ARN; rejects with a plain error when
   * the properties do not match the schema or DynamoDB fails.
   */
  public async resolve(resourceProperties: unknown): Promise<ResolvedTableArns> {
    const props = this.parseProperties(resourceProperties);

    return {
      configTableArn:       await this.resolveTable('configTable', props),
      itemTableArn:         await this.resolveTable('itemTable', props),
      changelogTableArn:    await this.resolveTable('changelogTable', props),
      auditLogTableArn:     await this.resolveTable('auditLogTable', props),
      mailFeedbackTableArn: await this.resolveTable('mailFeedbackTable', props),
    };
  }

  private parseProperties(resourceProperties: unknown): ResourceProperties {
    const errors: string[] = [];
    if (!isResourceProperties(resourceProperties, { errors })) {
      throw new Error(`Invalid ResourceProperties: ${errors.join('; ')}`);
    }
    return resourceProperties;
  }

  private async resolveTable(role: TableRole, props: ResourceProperties): Promise<string> {
    const incomingArn = props[`${role}IncomingArn`];
    const overrideArn = props[`${role}OverrideArn`];

    // An override equal to the incoming ARN means the operator has not redirected this role.
    if (overrideArn === incomingArn) {
      this.logger.info(`${role}: override matches incoming, using incoming table`);
      return incomingArn;
    }

    this.assertOwnPlacement(role, incomingArn, overrideArn);
    await this.assertOverrideTableActive(role, overrideArn);
    this.logger.info(`${role}: using override table ${overrideArn}`);
    return overrideArn;
  }

  /**
   * The incoming ARN names this stack's own table, so its partition, region and account are this stack's.
   * An override outside them is refused before DynamoDB is called.
   */
  private assertOwnPlacement(role: TableRole, incomingArn: string, overrideArn: string): void {
    const own      = parseArn(incomingArn);
    const override = this.parseTableArn(role, overrideArn);

    if (override.partition !== own.partition || override.region !== own.region || override.account !== own.account) {
      throw new ExpectedFailure(`${role}: override ${overrideArn} is not in this stack's partition, region and account`);
    }
  }

  private async assertOverrideTableActive(role: TableRole, overrideArn: string): Promise<void> {
    const status = await this.loadOverrideTableStatus(role, overrideArn);

    // Redirecting a role to a table that cannot serve requests would break the mailbox, so it is refused.
    if (status !== 'ACTIVE') {
      throw new ExpectedFailure(`${role}: override table ${overrideArn} is not ACTIVE (status: ${status ?? 'unknown'})`);
    }
  }

  private async loadOverrideTableStatus(role: TableRole, overrideArn: string): Promise<string | undefined> {
    try {
      const response = await this.dynamodb.send(new DescribeTableCommand({ TableName: this.tableNameOf(role, overrideArn) }));
      return response.Table?.TableStatus;
    } catch (thrown) {
      throw this.describeFailure(role, overrideArn, thrown);
    }
  }

  private describeFailure(role: TableRole, overrideArn: string, thrown: unknown): unknown {
    if (thrown instanceof ResourceNotFoundException) {
      return new ExpectedFailure(`${role}: override table ${overrideArn} does not exist`);
    }
    return thrown;
  }

  private tableNameOf(role: TableRole, tableArn: string): TableName {
    const parsed = this.parseTableArn(role, tableArn);

    // A table ARN is `table/{name}`; an index, stream or other service's ARN names something DescribeTable cannot describe.
    if (parsed.service !== 'dynamodb' || parsed.resource !== `table/${parsed.resourceName}`) {
      throw new ExpectedFailure(`${role}: override ${tableArn} is not a DynamoDB table ARN`);
    }
    return toTableName(parsed.resourceName);
  }

  private parseTableArn(role: TableRole, tableArn: string): ParsedArn {
    try {
      return parseArn(tableArn);
    } catch (thrown) {
      throw this.malformedTableArn(role, thrown);
    }
  }

  private malformedTableArn(role: TableRole, thrown: unknown): ExpectedFailure {
    return new ExpectedFailure(`${role}: override is malformed: ${CaughtError.readableMessage(thrown)}`);
  }
}
