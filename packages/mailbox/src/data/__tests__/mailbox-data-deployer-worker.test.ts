import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { CdkArtifactEngine, PinnedResolver } from '@serverlessinbox/mailbox-cdk-shared';
import { MailboxDataDeployerWorker } from '../mailbox-data-deployer-worker';

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

  new MailboxDataDeployerWorker(stack, 'worker', {
    artifactResolver,
    stack,
    dataStackArn: 'arn:aws:cloudformation:us-west-2:111122223333:stack/test-stack-data/*',
    dataStackName: 'test-stack-data',
    templateObjectArn: 'arn:aws:s3:::test-artifacts/templates/data-template.json',
    nameBase: 'test-stack-data',
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

describe('MailboxDataDeployerWorker Tagging API grants', () => {
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
        ]),
      );
      expect(tagKeys.length).toBe(6);
      expect(stmt.Resource).toContain('*');

      // aws:TagKeys is multivalued; a plain StringEquals never matches it and silently denies
      // every tag write. ForAllValues:StringEquals is the only correct operator here.
      expect(stmt.Condition?.StringEquals?.['aws:TagKeys']).toBeUndefined();
    }
  });
});
