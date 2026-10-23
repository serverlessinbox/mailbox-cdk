/**
 * DataOverrideResolverLambda tests. The Lambda must be able to describe the operator's override
 * table, which can be any table in the account, so DescribeTable is granted on every table; a missing
 * grant fails every override with AccessDenied. Its code comes from the `mailbox-cdk` package pin, so
 * a resolver without that pin must fail to synthesize rather than reference a missing artifact.
 */

import { ArtifactZone }                         from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin }                     from '@serverlessinbox/artifact-registry-cdk';
import { allPolicyStatements }                  from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { Template }                             from 'aws-cdk-lib/assertions';

import { DataOverrideResolverLambda }           from '../data-override-resolver-lambda';

import { arrangeWrapperStack }                  from './lambda-wrapper-helpers';

describe('DataOverrideResolverLambda', () => {
  it('grants dynamodb:DescribeTable, and no other action, on every DynamoDB table', () => {
    const packages: Record<string, ArtifactPin> = { 'mailbox-cdk': { version: '1.0.0', zone: ArtifactZone.REGIONAL } };
    const { stack, artifactResolver }           = arrangeWrapperStack(packages);
    new DataOverrideResolverLambda(stack, 'resolver', { artifactResolver });

    const statements = allPolicyStatements(Template.fromStack(stack));

    expect(statements).toEqual([
      {
        Action:   'dynamodb:DescribeTable',
        Effect:   'Allow',
        Resource: {
          'Fn::Join': [
            '',
            ['arn:', { Ref: 'AWS::Partition' }, ':dynamodb:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, ':table/*'],
          ],
        },
      },
    ]);
  });

  it('fails to synthesize naming the package the resolver holds no pin for', () => {
    const { stack, artifactResolver } = arrangeWrapperStack();

    expect(() => {
      new DataOverrideResolverLambda(stack, 'resolver', { artifactResolver });
    }).toThrow("No resolved data for package 'mailbox-cdk'");
  });
});
