/// <reference types="jest" />

/**
 * Pins the grants every sub-stack deployer's worker shares. The worker runs CloudFormation with its own
 * role, so a grant that is missing fails a deployment and one that is too wide hands every deployed
 * stack's tags and templates to the role.
 */

import { Template } from 'aws-cdk-lib/assertions';
import { Construct } from 'constructs';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { DeployerWorkerLambda } from '../deployer-worker-lambda';
import { newDeployerTestStack, statementsForAction } from './deployer-infra-helpers';

/** A worker that applies one shared grant per method, because the grants are protected. */
class ProbeWorker extends DeployerWorkerLambda {
  constructor(scope: Construct, artifactResolver: IArtifactResolver) {
    super(scope, 'worker', { artifactResolver, deployedStackName: 'data' });
  }

  public applyStackLifecycle(stackArn: string, readsTemplate?: boolean): void {
    this.grantStackLifecycle(stackArn, readsTemplate);
  }

  public applyTemplateValidation(): void {
    this.grantTemplateValidation();
  }

  public applyArtifactRead(objectArns: string[]): void {
    this.grantArtifactRead(objectArns);
  }

  public applyTaggingApi(additionalTagKeys?: string[]): void {
    this.grantTaggingApi(additionalTagKeys);
  }
}

const STACK_ARN = 'arn:aws:cloudformation:us-west-2:123456789012:stack/probe/*';
const BASE_TAG_KEYS = [
  'serverless-inbox:product',
  'serverless-inbox:root-stack',
  'serverless-inbox:stack',
  'serverless-inbox:component',
  'serverless-inbox:version',
  'serverless-inbox:deployer_type',
];

function synthProbe(apply: (worker: ProbeWorker) => void): Template {
  const { stack, artifactResolver } = newDeployerTestStack();
  apply(new ProbeWorker(stack, artifactResolver));
  return Template.fromStack(stack);
}

describe('DeployerWorkerLambda', () => {
  it('runs the stack-deployer worker handler with the data deployer service name', () => {
    const template = synthProbe(() => undefined);

    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'index.workerHandler',
      Timeout: 900,
      MemorySize: 512,
      Environment: { Variables: { SERVICE_NAME: 'stack-deployer-data-worker' } },
    });
  });

  describe('grantStackLifecycle', () => {
    it('manages the given stack without reading its template by default', () => {
      const template = synthProbe((worker) => worker.applyStackLifecycle(STACK_ARN));

      const statements = statementsForAction(template, 'cloudformation:CreateStack');
      expect(statements).toHaveLength(1);
      expect(statements[0].Resource).toEqual(STACK_ARN);
      expect(statements[0].Action).toEqual([
        'cloudformation:CreateStack',
        'cloudformation:UpdateStack',
        'cloudformation:DeleteStack',
        'cloudformation:DescribeStacks',
        'cloudformation:DescribeStackEvents',
        'cloudformation:GetTemplateSummary',
        'cloudformation:GetStackPolicy',
        'cloudformation:SetStackPolicy',
      ]);
    });

    it('adds GetTemplate when the role reads the stack template', () => {
      const template = synthProbe((worker) => worker.applyStackLifecycle(STACK_ARN, true));

      const statements = statementsForAction(template, 'cloudformation:GetTemplate');
      expect(statements).toHaveLength(1);
      expect(statements[0].Action).toContain('cloudformation:CreateStack');
    });
  });

  it('grants ValidateTemplate on every resource, since it acts on a template URL rather than a stack', () => {
    const template = synthProbe((worker) => worker.applyTemplateValidation());

    const statements = statementsForAction(template, 'cloudformation:ValidateTemplate');
    expect(statements).toHaveLength(1);
    expect(statements[0].Resource).toBe('*');
    expect(statements[0].Condition).toBeUndefined();
  });

  it('lets the role read exactly the given artifact objects', () => {
    const objectArns = ['arn:aws:s3:::bucket/template.json', 'arn:aws:s3:::bucket/lambdas/function.zip'];
    const template = synthProbe((worker) => worker.applyArtifactRead(objectArns));

    const statements = statementsForAction(template, 's3:GetObject');
    expect(statements).toHaveLength(1);
    expect(statements[0].Action).toEqual(['s3:GetObject', 's3:GetObjectVersion']);
    expect(statements[0].Resource).toEqual(objectArns);
  });

  describe('grantTaggingApi', () => {
    it('enumerates tagged resources without any condition', () => {
      const template = synthProbe((worker) => worker.applyTaggingApi());

      const statements = statementsForAction(template, 'tag:GetResources');
      expect(statements).toHaveLength(1);
      expect(statements[0].Resource).toBe('*');
      expect(statements[0].Condition).toBeUndefined();
    });

    it('limits tag writes to the sub-stack tag keys', () => {
      const template = synthProbe((worker) => worker.applyTaggingApi());

      for (const action of ['tag:TagResources', 'tag:UntagResources']) {
        const statements = statementsForAction(template, action);
        expect(statements).toHaveLength(1);
        expect(statements[0].Condition?.['ForAllValues:StringEquals']).toEqual({ 'aws:TagKeys': BASE_TAG_KEYS });
      }
    });

    it('allows the additional tag keys after the sub-stack ones', () => {
      const template = synthProbe((worker) => worker.applyTaggingApi(['serverless-inbox:edge']));

      const statements = statementsForAction(template, 'tag:TagResources');
      expect(statements[0].Condition?.['ForAllValues:StringEquals']).toEqual({
        'aws:TagKeys': [...BASE_TAG_KEYS, 'serverless-inbox:edge'],
      });
    });

    it('compares tag keys with ForAllValues, because aws:TagKeys is multivalued and a plain StringEquals denies every tag write', () => {
      const template = synthProbe((worker) => worker.applyTaggingApi());

      const statements = statementsForAction(template, 'tag:TagResources');
      expect(statements[0].Condition?.StringEquals).toBeUndefined();
    });
  });
});
