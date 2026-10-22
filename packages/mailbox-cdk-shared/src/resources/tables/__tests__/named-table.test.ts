/**
 * StackNamedTable naming tests.
 *
 * Pins how the explicit physical table name is composed from the account, the name base and the
 * construct id (plus the position hash and guid prefix when `uniquePerPosition` is set), as rendered
 * in the template's `TableName`; a regression here renames live tables on deploy, or lets a moved
 * table collide with its retained original.
 */

import { Template }                      from 'aws-cdk-lib/assertions';
import { AttributeType }                 from 'aws-cdk-lib/aws-dynamodb';
import * as cdk                          from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Construct }                     from 'constructs';

import { PositionHash }                  from '../../../naming/position-hash';
import { StackIdentity }                 from '../../../naming/stack-identity';
import { StackNamedTable }               from '../named-table';
import type { StackNamedTableProps }     from '../named-table';

const accountRef   = { Ref: 'AWS::AccountId' };
const stackNameRef = { Ref: 'AWS::StackName' };

function createStack(): cdk.Stack {
  return new cdk.Stack(new App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

function propsWith(nameBase?: string): StackNamedTableProps {
  return { partitionKey: { name: 'pk', type: AttributeType.STRING }, nameBase };
}

function nameWithPosition(stack: cdk.Stack, parent: Construct): object {
  return {
    'Fn::Join': [
      '',
      [accountRef, '-', stackNameRef, `-orders-${PositionHash.ofChild(parent, 'orders')}-`, stack.resolve(StackIdentity.guidPrefix)],
    ],
  };
}

describe('StackNamedTable', () => {
  it('names the table <account>-<stack name>-<id> when no nameBase is given', () => {
    const stack = createStack();

    new StackNamedTable(stack, 'orders', propsWith());

    Template.fromStack(stack).hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: { 'Fn::Join': ['', [accountRef, '-', stackNameRef, '-orders']] },
    });
  });

  it('uses nameBase in place of the stack name', () => {
    const stack = createStack();

    new StackNamedTable(stack, 'orders', propsWith('custom'));

    Template.fromStack(stack).hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: { 'Fn::Join': ['', [accountRef, '-custom-orders']] },
    });
  });

  it('appends the table position hash and the guid prefix when uniquePerPosition is set', () => {
    const stack = createStack();
    const group = new Construct(stack, 'group');

    new StackNamedTable(group, 'orders', { ...propsWith(), uniquePerPosition: true });

    Template.fromStack(stack).hasResourceProperties('AWS::DynamoDB::Table', { TableName: nameWithPosition(stack, group) });
  });

  it('gives a table with the same id a different name under a different parent when uniquePerPosition is set', () => {
    const stack  = createStack();
    const first  = new Construct(stack, 'first');
    const second = new Construct(stack, 'second');

    new StackNamedTable(first, 'orders', { ...propsWith(), uniquePerPosition: true });
    new StackNamedTable(second, 'orders', { ...propsWith(), uniquePerPosition: true });

    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::DynamoDB::Table', 2);
    template.hasResourceProperties('AWS::DynamoDB::Table', { TableName: nameWithPosition(stack, first) });
    template.hasResourceProperties('AWS::DynamoDB::Table', { TableName: nameWithPosition(stack, second) });
  });

  it('keeps the name unchanged when uniquePerPosition is false', () => {
    const stack = createStack();

    new StackNamedTable(stack, 'orders', { ...propsWith(), uniquePerPosition: false });

    Template.fromStack(stack).hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: { 'Fn::Join': ['', [accountRef, '-', stackNameRef, '-orders']] },
    });
  });

  it('treats an empty nameBase as absent', () => {
    const stack = createStack();

    new StackNamedTable(stack, 'orders', propsWith(''));

    Template.fromStack(stack).hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: { 'Fn::Join': ['', [accountRef, '-', stackNameRef, '-orders']] },
    });
  });
});
