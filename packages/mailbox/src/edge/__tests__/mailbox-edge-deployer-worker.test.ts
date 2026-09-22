import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { CdkArtifactEngine, PinnedResolver } from '@serverlessinbox/mailbox-cdk-shared';
import { MailboxEdgeDeployerWorker } from '../mailbox-edge-deployer-worker';

function synthWorker(): Template {
  const app = new App();
  app.node.setContext('serverlessinbox:artifacts', {
    bucketBase: 'test-artifacts',
    packages: {
      mailbox: { kind: 'release', version: '0.0.1-test' },
      'mailbox-cdk': { kind: 'release', version: '0.0.1-test' },
    },
  });
  app.node.setContext('serverlessinbox:artifact_versions', {});

  const stack = new cdk.Stack(app, 'test-stack', {
    env: { account: '111122223333', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });

  const pinnedResolver = PinnedResolver.loadFromArtifactMetadata(stack);
  pinnedResolver.registerPackages(['mailbox', 'mailbox-cdk']);
  const artifactResolver = new CdkArtifactEngine(stack, pinnedResolver);

  new MailboxEdgeDeployerWorker(stack, 'worker', {
    artifactResolver,
    stack,
    edgeStackName: 'test-stack-edge',
    edgeStackArn: 'arn:aws:cloudformation:us-east-1:111122223333:stack/test-stack-edge/*',
    rootStack: 'test-stack',
    templateObjectArn: 'arn:aws:s3:::test-artifacts/templates/edge-template.json',
    artifactObjectArns: ['arn:aws:s3:::test-artifacts-us-east-1/lambdas/blob-authorizer.zip'],
    blobAuthorizerRoleArn: 'arn:aws:iam::111122223333:role/test-role',
  });

  return Template.fromStack(stack);
}

/** Flattens every statement across every AWS::IAM::Policy resource in the template. */
function allStatements(template: Template): any[] {
  const policies = template.findResources('AWS::IAM::Policy');
  const statements: any[] = [];
  for (const [, policy] of Object.entries(policies)) {
    const doc = (policy as any).Properties?.PolicyDocument;
    for (const stmt of doc?.Statement ?? []) {
      statements.push(stmt);
    }
  }
  return statements;
}

function statementsForAction(template: Template, action: string): any[] {
  return allStatements(template).filter((stmt) => {
    const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
    return actions.includes(action);
  });
}

describe('MailboxEdgeDeployerWorker Tagging API grants', () => {
  let template: Template;

  beforeAll(() => {
    template = synthWorker();
  });

  it('grants tag:GetResources unconditionally (read-only enumeration)', () => {
    const stmts = statementsForAction(template, 'tag:GetResources');
    expect(stmts.length).toBe(1);
    expect(stmts[0].Condition).toBeUndefined();
    expect(stmts[0].Resource).toContain('*');
  });

  it('constrains tag:TagResources and tag:UntagResources with ForAllValues:StringEquals on aws:TagKeys', () => {
    const tagResourcesStmts = statementsForAction(template, 'tag:TagResources');
    const untagResourcesStmts = statementsForAction(template, 'tag:UntagResources');

    expect(tagResourcesStmts.length).toBe(1);
    expect(untagResourcesStmts.length).toBe(1);

    for (const stmt of [tagResourcesStmts[0], untagResourcesStmts[0]]) {
      const tagKeys = stmt.Condition?.['ForAllValues:StringEquals']?.['aws:TagKeys'];
      expect(Array.isArray(tagKeys)).toBe(true);
      expect(tagKeys).toEqual(
        expect.arrayContaining([
          'serverless-inbox:product',
          'serverless-inbox:root-stack',
          'serverless-inbox:stack',
          'serverless-inbox:component',
          'serverless-inbox:version',
          'serverless-inbox:deployer_type',
          'serverless-inbox:edge',
          'serverless-inbox:root-region',
        ]),
      );
      expect(tagKeys.length).toBe(8);
      expect(stmt.Resource).toContain('*');

      // aws:TagKeys is multivalued; a plain StringEquals never matches it and silently denies
      // every tag write. ForAllValues:StringEquals is the only correct operator here.
      expect(stmt.Condition?.StringEquals?.['aws:TagKeys']).toBeUndefined();
    }
  });
});
