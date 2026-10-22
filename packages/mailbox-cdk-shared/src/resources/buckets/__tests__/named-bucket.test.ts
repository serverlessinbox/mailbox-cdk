/**
 * StackNamedBucket naming tests.
 *
 * Pins how the explicit physical bucket name is composed (`<account>-<name base>-<id>`), as rendered
 * in the template's `BucketName`, and where the name base comes from: the prop, else the base
 * registered for the stack (even when registered after the bucket was constructed), else the stack
 * name. A regression renames live buckets on deploy. Also pins the two grants a static content deployer
 * is given on the bucket: a wider action or resource lets the deployer write outside its content.
 */

import { Template }                      from 'aws-cdk-lib/assertions';
import * as iam                          from 'aws-cdk-lib/aws-iam';
import * as cdk                          from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';

import { statementsForAction }           from '../../../cdk-test-support';
import { setStackNameBase }              from '../../../naming/stack-name-base-registry';
import { StackNamedBucket }              from '../named-bucket';

const accountRef   = { Ref: 'AWS::AccountId' };
const stackNameRef = { Ref: 'AWS::StackName' };

function createStack(): cdk.Stack {
  return new cdk.Stack(new App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

/** Asserts the stack holds exactly one bucket, named `bucketName` in the synthesized template. */
function expectOnlyBucketNamed(stack: cdk.Stack, bucketName: object): void {
  const template = Template.fromStack(stack);

  template.resourceCountIs('AWS::S3::Bucket', 1);
  template.hasResourceProperties('AWS::S3::Bucket', { BucketName: bucketName });
}

describe('StackNamedBucket', () => {
  it('names the bucket <account>-<stack name>-<id> when no name base is given or registered', () => {
    const stack = createStack();

    new StackNamedBucket(stack, 'assets');

    expectOnlyBucketNamed(stack, { 'Fn::Join': ['', [accountRef, '-', stackNameRef, '-assets']] });
  });

  it('uses the name base registered for the stack, also when it is registered after the bucket', () => {
    const stack = createStack();
    new StackNamedBucket(stack, 'assets');

    setStackNameBase(stack, 'registered');

    expectOnlyBucketNamed(stack, { 'Fn::Join': ['', [accountRef, '-registered-assets']] });
  });

  it('prefers the nameBase prop over the registered name base', () => {
    const stack = createStack();
    setStackNameBase(stack, 'registered');

    new StackNamedBucket(stack, 'assets', { nameBase: 'custom' });

    expectOnlyBucketNamed(stack, { 'Fn::Join': ['', [accountRef, '-custom-assets']] });
  });

  it('treats an empty nameBase as absent', () => {
    const stack = createStack();

    new StackNamedBucket(stack, 'assets', { nameBase: '' });

    expectOnlyBucketNamed(stack, { 'Fn::Join': ['', [accountRef, '-', stackNameRef, '-assets']] });
  });

  describe('static content target', () => {
    function grantee(stack: cdk.Stack): iam.Role {
      return new iam.Role(stack, 'deployer', { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') });
    }

    it('lets the grantee put and delete exactly the objects matching the key patterns', () => {
      const stack  = createStack();
      const bucket = new StackNamedBucket(stack, 'assets');
      const arn    = { 'Fn::GetAtt': [stack.getLogicalId(bucket.node.defaultChild as cdk.CfnResource), 'Arn'] };

      bucket.grantContentWrite(grantee(stack), ['content/*', 'config/config.json']);

      expect(statementsForAction(Template.fromStack(stack), 's3:PutObject')).toEqual([
        expect.objectContaining({
          Action:   ['s3:PutObject', 's3:DeleteObject'],
          Effect:   'Allow',
          Resource: [{ 'Fn::Join': ['', [arn, '/content/*']] }, { 'Fn::Join': ['', [arn, '/config/config.json']] }],
        }),
      ]);
    });

    it('lets the grantee list the whole bucket and nothing else', () => {
      const stack  = createStack();
      const bucket = new StackNamedBucket(stack, 'assets');

      bucket.grantContentListing(grantee(stack));

      expect(statementsForAction(Template.fromStack(stack), 's3:ListBucket')).toEqual([
        expect.objectContaining({
          Action:   's3:ListBucket',
          Effect:   'Allow',
          Resource: { 'Fn::GetAtt': [stack.getLogicalId(bucket.node.defaultChild as cdk.CfnResource), 'Arn'] },
        }),
      ]);
    });
  });
});
