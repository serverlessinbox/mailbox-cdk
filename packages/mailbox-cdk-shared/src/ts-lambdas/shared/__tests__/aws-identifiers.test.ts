import * as t from 'typanion';
import { isRegion, toFunctionName, toQueueUrl, toRegion, toTableName, type FunctionName, type QueueUrl, type Region, type TableName } from '../aws-identifiers';

/**
 * Pins what the AWS-wide identifier kinds exist for: a region cannot be passed where a table name is expected,
 * nor the other way round, and the region validator brands a string and reports a value that is not one. The
 * swap is checked by the compiler, so each `@ts-expect-error` below turns into a failure if the kinds ever
 * become interchangeable.
 */
describe('AWS identifiers', () => {
  function describeRegion(region: Region): string {
    return region;
  }

  function describeTable(table: TableName): string {
    return table;
  }

  it('does not accept a region where a table name is expected, nor the other way round', () => {
    // @ts-expect-error a Region is not a TableName
    describeTable(toRegion('eu-west-1'));
    // @ts-expect-error a TableName is not a Region
    describeRegion(toTableName('auth-key-store'));
  });

  it('does not accept a function name where a queue URL is expected, nor the other way round', () => {
    const describeQueue = (queue: QueueUrl): string => queue;
    const describeFunction = (name: FunctionName): string => name;

    // @ts-expect-error a FunctionName is not a QueueUrl
    describeQueue(toFunctionName('identity-provisioner'));
    // @ts-expect-error a QueueUrl is not a FunctionName
    describeFunction(toQueueUrl('https://sqs.eu-west-1.amazonaws.com/123456789012/audit'));
  });

  describe('isRegion', () => {
    it('accepts a string and reports a value that is not one', () => {
      expect(isRegion('eu-west-1')).toBe(true);
      expect(t.as(42, isRegion, { errors: true }).errors).toEqual(['.: Expected a string (got 42)']);
    });
  });
});
