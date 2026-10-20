/**
 * StackNamedTable naming tests.
 *
 * Pins how the explicit physical table name is composed from the account, the name base and the
 * construct id, and that the template's `TableName` is that same value; a regression here renames
 * live tables on deploy.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import { Template } from 'aws-cdk-lib/assertions';
import { StackNamedTable } from '../named-table';
import type { StackNamedTableProps } from '../named-table';

const accountRef = { Ref: 'AWS::AccountId' };
const stackNameRef = { Ref: 'AWS::StackName' };

function createStack(): cdk.Stack {
  return new cdk.Stack(new App(), 'TestStack', {
    env: { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

function propsWith(nameBase?: string): StackNamedTableProps {
  return { partitionKey: { name: 'pk', type: AttributeType.STRING }, nameBase };
}

describe('StackNamedTable', () => {
  it('names the table <account>-<stack name>-<id> when no nameBase is given', () => {
    const stack = createStack();

    const sut = new StackNamedTable(stack, 'orders', propsWith());

    expect(stack.resolve(sut.explicitTableName)).toEqual({
      'Fn::Join': ['', [accountRef, '-', stackNameRef, '-orders']],
    });
    Template.fromStack(stack).hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: stack.resolve(sut.explicitTableName),
    });
  });

  it('uses nameBase in place of the stack name', () => {
    const stack = createStack();

    const sut = new StackNamedTable(stack, 'orders', propsWith('custom'));

    expect(stack.resolve(sut.explicitTableName)).toEqual({
      'Fn::Join': ['', [accountRef, '-custom-orders']],
    });
  });

  it('treats an empty nameBase as absent', () => {
    const stack = createStack();

    const sut = new StackNamedTable(stack, 'orders', propsWith(''));

    expect(stack.resolve(sut.explicitTableName)).toEqual({
      'Fn::Join': ['', [accountRef, '-', stackNameRef, '-orders']],
    });
  });
});
