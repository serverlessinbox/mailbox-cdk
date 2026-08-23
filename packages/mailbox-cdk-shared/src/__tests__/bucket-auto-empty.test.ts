import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Code } from 'aws-cdk-lib/aws-lambda';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { BucketAutoEmpty } from '../bucket-auto-empty';
import type { ICdkArtifactEngine, ResolvedArtifact } from '../artifact-engine';

/** Minimal stand-in for the real engine — resolves everything to a fixed S3 location. */
const fakeEngine: ICdkArtifactEngine = {
  getCode: () => Code.fromBucket(Bucket.fromBucketName(new Stack(new App(), 'code-scope'), 'b', 'artifacts'), 'lambdas/x.zip'),
  getUrl: () => 'https://example.invalid/x.zip',
  getArn: () => 'arn:aws:s3:::artifacts/lambdas/x.zip',
  getVersion: () => 'dev',
  getBucketBase: () => 'artifacts',
  resolve: (): ResolvedArtifact => ({ bucket: 'artifacts', key: 'lambdas/x.zip' }),
  registerPackages: () => undefined,
};

function synth() {
  const stack = new Stack(new App(), 'test-stack', { env: { account: '111122223333', region: 'eu-west-1' } });
  const bucket = new Bucket(stack, 'target-bucket');
  const cr = BucketAutoEmpty.getOrCreate(stack, fakeEngine).attach(stack, 'auto-empty', bucket);
  return { template: Template.fromStack(stack), stack, cr };
}

describe('BucketAutoEmpty.attach', () => {
  // REGRESSION: these grants used to go through addToRolePolicy(), landing in the Lambda role's
  // shared DefaultPolicy. DefaultPolicy survives across updates, so adding a statement to it is an
  // UPDATE — and on rollback CFN reverts that update and *then* invokes this CustomResource's
  // Delete, leaving the handler without the permission it needs:
  //   "not authorized to perform: s3:ListBucketVersions"  → CR Delete FAILED
  //   "The bucket you tried to delete is not empty" (409) → rollback stalls.
  // An updated resource has no ordering handle, so the grants must live in their own Policy that is
  // created and destroyed with the attachment.
  it('puts the bucket grants in a dedicated Policy, not the role DefaultPolicy', () => {
    const { template } = synth();

    const policies = template.findResources('AWS::IAM::Policy');
    const withBucketGrants = Object.entries(policies).filter(([logicalId, res]) => {
      if (logicalId.toLowerCase().includes('defaultpolicy')) return false;
      const statements = (res as any).Properties.PolicyDocument.Statement as any[];
      return statements.some((s) => ([] as string[]).concat(s.Action).includes('s3:ListBucketVersions'));
    });

    expect(withBucketGrants).toHaveLength(1);

    const statements = (withBucketGrants[0][1] as any).Properties.PolicyDocument.Statement as any[];
    expect(statements.map((s) => ([] as string[]).concat(s.Action)).flat().sort()).toEqual([
      's3:DeleteObject',
      's3:DeleteObjectVersion',
      's3:ListBucket',
      's3:ListBucketVersions',
    ]);

    // And the DefaultPolicy must NOT carry them.
    const defaultPolicies = Object.entries(policies).filter(([id]) => id.toLowerCase().includes('defaultpolicy'));
    for (const [, res] of defaultPolicies) {
      const stmts = (res as any).Properties.PolicyDocument.Statement as any[];
      const actions = stmts.map((s) => ([] as string[]).concat(s.Action)).flat();
      expect(actions).not.toContain('s3:ListBucketVersions');
    }
  });

  // Deletion order is the entire point of the fix: CFN deletes dependents first, so the
  // CustomResource's Delete (which empties the bucket) must run while the Policy still exists.
  it('makes the CustomResource depend on that Policy so it is torn down first', () => {
    const { template } = synth();

    const crs = template.findResources('Custom::BucketAutoEmpty');
    expect(Object.keys(crs)).toHaveLength(1);

    const dependsOn: string[] = ([] as string[]).concat((Object.values(crs)[0] as any).DependsOn ?? []);

    const policies = template.findResources('AWS::IAM::Policy');
    const grantPolicyId = Object.entries(policies).find(([logicalId, res]) => {
      if (logicalId.toLowerCase().includes('defaultpolicy')) return false;
      const statements = (res as any).Properties.PolicyDocument.Statement as any[];
      return statements.some((s) => ([] as string[]).concat(s.Action).includes('s3:ListBucketVersions'));
    })![0];

    expect(dependsOn).toContain(grantPolicyId);
  });
});
