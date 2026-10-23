/**
 * BaseTable defaults
 *
 * Verifies the two defaults BaseTable adds on top of CDK's Table: pay-per-request billing and the
 * development-aware removal policy. Each is read from the synthesized CloudFormation template.
 */

import { Match, Template }               from 'aws-cdk-lib/assertions';
import { AttributeType, BillingMode }    from 'aws-cdk-lib/aws-dynamodb';
import * as cdk                          from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';

import { DEVELOPMENT_CONTEXT_KEY }       from '../../../context/context-keys';
import { BaseTable }                     from '../base-table';

interface TableOptions {
  billingMode?:   BillingMode;
  removalPolicy?: cdk.RemovalPolicy;
}

function synthesizeTable(options: TableOptions, context?: Record<string, unknown>): Template {
  const app   = new App({ context });
  const stack = new cdk.Stack(app, 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });

  new BaseTable(stack, 'TestTable', {
    partitionKey: { name: 'pk', type: AttributeType.STRING },
    ...options,
  });

  return Template.fromStack(stack);
}

describe('BaseTable defaults', () => {
  it('defaults to pay-per-request billing', () => {
    const template = synthesizeTable({});

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  it('keeps a caller-supplied billing mode', () => {
    const template = synthesizeTable({ billingMode: BillingMode.PROVISIONED });

    // CDK omits BillingMode for provisioned tables and emits ProvisionedThroughput instead.
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode:           Match.absent(),
      ProvisionedThroughput: Match.anyValue(),
    });
  });

  it('retains the table outside development mode', () => {
    const template = synthesizeTable({});

    template.hasResource('AWS::DynamoDB::Table', {
      DeletionPolicy: 'RetainExceptOnCreate',
    });
  });

  it('deletes the table in development mode', () => {
    const template = synthesizeTable({}, { [DEVELOPMENT_CONTEXT_KEY]: true });

    template.hasResource('AWS::DynamoDB::Table', {
      DeletionPolicy: 'Delete',
    });
  });

  it('keeps a caller-supplied removal policy over the development default', () => {
    const template = synthesizeTable(
      { removalPolicy: cdk.RemovalPolicy.RETAIN },
      { [DEVELOPMENT_CONTEXT_KEY]: true },
    );

    template.hasResource('AWS::DynamoDB::Table', {
      DeletionPolicy: 'Retain',
    });
  });
});
