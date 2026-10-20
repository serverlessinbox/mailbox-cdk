/**
 * StackNamedTable naming tests.
 *
 * Pins how the explicit physical table name is composed from the account, the name base and the
 * construct id (plus the position hash and guid prefix when `uniquePerPosition` is set), and that the
 * template's `TableName` is that same value; a regression here renames live tables on deploy, or lets a
 * moved table collide with its retained original.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import { Template } from 'aws-cdk-lib/assertions';
import { Construct } from 'constructs';
import { StackNamedTable } from '../named-table';
import type { StackNamedTableProps } from '../named-table';
import { PositionHash } from '../naming/position-hash';
import { StackIdentity } from '../naming/stack-identity';

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

  it('appends the table position hash and the guid prefix when uniquePerPosition is set', () => {
    const stack = createStack();
    const group = new Construct(stack, 'group');

    const sut = new StackNamedTable(group, 'orders', { ...propsWith(), uniquePerPosition: true });

    const expectedName = {
      'Fn::Join': [
        '',
        [accountRef, '-', stackNameRef, `-orders-${PositionHash.ofChild(group, 'orders')}-`, stack.resolve(StackIdentity.guidPrefix)],
      ],
    };
    expect(stack.resolve(sut.explicitTableName)).toEqual(expectedName);
    Template.fromStack(stack).hasResourceProperties('AWS::DynamoDB::Table', { TableName: expectedName });
  });

  it('gives a table with the same id a different name under a different parent when uniquePerPosition is set', () => {
    const stack = createStack();

    const first = new StackNamedTable(new Construct(stack, 'first'), 'orders', { ...propsWith(), uniquePerPosition: true });
    const second = new StackNamedTable(new Construct(stack, 'second'), 'orders', { ...propsWith(), uniquePerPosition: true });

    expect(stack.resolve(first.explicitTableName)).not.toEqual(stack.resolve(second.explicitTableName));
  });

  it('keeps the name unchanged when uniquePerPosition is false', () => {
    const stack = createStack();

    const sut = new StackNamedTable(stack, 'orders', { ...propsWith(), uniquePerPosition: false });

    expect(stack.resolve(sut.explicitTableName)).toEqual({
      'Fn::Join': ['', [accountRef, '-', stackNameRef, '-orders']],
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
