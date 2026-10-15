/**
 * Coverage for the self-cleanup tail's presence guard (see `features/sweeper/sweeper-workflow.ts`,
 * `createSelfCleanupChain`): a `DescribeStackResource` call on the state machine's own logical id,
 * re-evaluated immediately before `SelfCleanupDeleteWorker` fires, so an ordinary deploy where every
 * removal simply had nothing to do does not delete resources CloudFormation still owns. Also covers
 * the matching IAM grants added for the guard (`cloudformation:DescribeStackResource`, scoped to
 * `Aws.STACK_ID`) on both the SFN execution role's policy and its permissions boundary.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Construct } from 'constructs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as awslambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import {
  actionsOf,
  renderLiteralText,
  resourcesOf,
  statementsOfDocument,
  statementsOfNamedPolicy,
} from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { SweeperInfra } from '../features/sweeper/sweeper-infra';
import { CertificateRemoval } from '../features/sweeper/certificate-removal';
import { EdgeFunctionRemoval } from '../features/sweeper/edge-function-removal';
import { StackFailureDetectorRemoval } from '../features/sweeper/stack-failure-detector-removal';
import type { IResourceRemoval } from '../features/sweeper/removal';
import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin, IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';

describe('SweeperWorkflow self-cleanup guard', () => {
  let app: App;
  let artifactResolver: IArtifactResolver;
  let stack: cdk.Stack;
  let template: Template;
  let def: string;

  beforeAll(() => {
    app = new App();
    stack = new cdk.Stack(app, 'SelfCleanupGuardStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
    const packages: Record<string, ArtifactPin> = {
      'mailbox-cdk': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
    };
    artifactResolver = new PinnedArtifactResolver({
      packages,
      location: { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
      deploymentRegion: stack.region,
    });

    const opsGroup = new Construct(stack, 'ops');

    const certificate = acm.Certificate.fromCertificateArn(
      opsGroup,
      'cert-ref',
      'arn:aws:acm:us-west-2:123456789012:certificate/test-cert',
    );
    const edgeFunction = awslambda.Function.fromFunctionArn(
      opsGroup,
      'edge-fn-ref',
      'arn:aws:lambda:us-east-1:123456789012:function:edge-fn',
    );
    const rule = new events.Rule(opsGroup, 'detector-rule', { eventPattern: { source: ['aws.cloudformation'] } });
    const detectorRole = new iam.Role(opsGroup, 'detector-role', {
      roleName: 'mailbox-diag-role-test',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    const detectorFn = awslambda.Function.fromFunctionArn(
      opsGroup,
      'detector-fn-ref',
      'arn:aws:lambda:us-west-2:123456789012:function:mailbox-diag-fn-test',
    );
    const removals: IResourceRemoval[] = [
      new CertificateRemoval(opsGroup, 'cert-removal', { certificate }),
      new EdgeFunctionRemoval(opsGroup, 'edge-fn-removal', { function: edgeFunction }),
      new StackFailureDetectorRemoval(opsGroup, 'stack-failure-detector-removal', {
        rule,
        ruleTargetId: 'Target0',
        detector: detectorFn,
        role: detectorRole,
        detectorRolePolicyName: 'stack-failure-detector-policy',
      }),
    ];

    new SweeperInfra(opsGroup, 'sweeper', { artifactResolver, removals });

    template = Template.fromStack(stack);
    const machines = template.findResources('AWS::StepFunctions::StateMachine');
    const [, sm] = Object.entries(machines)[0];
    def = renderLiteralText((sm as any).Properties.DefinitionString);
  });

  /**
   * Extracts a state's own JSON body from the "States" map by key, via brace counting — not a
   * substring window. A plain `indexOf` on the state's name would as often land on a *reference* to
   * it (another state's `"Next": "SelfCleanupDescribeOwnResource"`) as on its actual definition, and
   * a fixed-size window breaks on a Choice state's nested `Choices` array. This finds the literal
   * `"<name>":{` key occurrence and returns exactly the matching `{...}` value.
   */
  function stateBody(stateName: string): string {
    const marker = `"${stateName}":{`;
    const idx = def.indexOf(marker);
    expect(idx).toBeGreaterThanOrEqual(0);
    const start = idx + marker.length - 1;
    let depth = 0;
    let i = start;
    for (; i < def.length; i++) {
      if (def[i] === '{') depth++;
      else if (def[i] === '}') {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
    return def.slice(start, i);
  }

  it('the guard states exist and precede SelfCleanupDeleteWorker', () => {
    const describeIdx = def.indexOf('"SelfCleanupDescribeOwnResource":{');
    const guardIdx = def.indexOf('"SelfCleanupGuard":{');
    const deleteWorkerIdx = def.indexOf('"SelfCleanupDeleteWorker":{');
    expect(describeIdx).toBeGreaterThanOrEqual(0);
    expect(guardIdx).toBeGreaterThanOrEqual(0);
    expect(deleteWorkerIdx).toBeGreaterThanOrEqual(0);
    expect(describeIdx).toBeLessThan(deleteWorkerIdx);
    expect(guardIdx).toBeLessThan(deleteWorkerIdx);
  });

  it('the describe call targets DescribeStackResource, on the state machine\'s own logical id', () => {
    const block = stateBody('SelfCleanupDescribeOwnResource');
    expect(block).toContain('aws-sdk:cloudformation:describeStackResource');
    expect(block).toContain('"StackName"');
    // The Lazy-resolved logical id of the SweeperWorkflow's own `StateMachine` construct — proves
    // the guard queries the state machine's own resource, not a hardcoded/wrong logical id.
    expect(block).toMatch(/"LogicalResourceId":"\w*StateMachine\w*"/);
  });

  it('resource still present (no error) reaches Succeed without deleting', () => {
    const describeBlock = stateBody('SelfCleanupDescribeOwnResource');
    // Normal (non-error) transition goes straight to the guard, never to SelfCleanupDeleteWorker.
    expect(describeBlock).toContain('"Next":"SelfCleanupGuard"');

    const guardBlock = stateBody('SelfCleanupGuard');
    // The Choice's default branch (resource present / no notFound flag set) goes to Succeed.
    expect(guardBlock).toContain('"Default":"Succeed"');
    // Succeed itself carries no delete action — it's a distinct, terminal state.
    expect(def).toContain('"Succeed":{"Type":"Succeed"');
  });

  it('resource absent (ValidationError) proceeds to self-cleanup', () => {
    const describeBlock = stateBody('SelfCleanupDescribeOwnResource');
    expect(describeBlock).toContain('cloudformation.ValidationError');
    expect(describeBlock).toContain('"SelfCleanupCaptureNotFound"');

    const captureBlock = stateBody('SelfCleanupCaptureNotFound');
    expect(captureBlock).toContain('"Next":"SelfCleanupGuard"');
    expect(captureBlock).toContain('"notFound":true');

    const guardBlock = stateBody('SelfCleanupGuard');
    expect(guardBlock).toContain('"IsPresent":true');
    expect(guardBlock).toContain('$.selfCheck.notFound');
    expect(guardBlock).toContain('"Next":"SelfCleanupDeleteWorker"');
  });

  it('grants cloudformation:DescribeStackResource, scoped to the stack ARN, on the execution policy', () => {
    const stmt = statementsOfNamedPolicy(template, 'sweeper-execution-policy').find((s) =>
      actionsOf(s).includes('cloudformation:DescribeStackResource'),
    );
    expect(stmt).toBeDefined();
    const resources = resourcesOf(stmt!);
    expect(resources).not.toContain('*');
    // Aws.STACK_ID renders as {"Ref":"AWS::StackId"} — an exact stack ARN pseudo-parameter.
    expect(resources[0]).toEqual({ Ref: 'AWS::StackId' });
  });

  it('grants cloudformation:DescribeStackResource, scoped to the stack ARN, on the permissions boundary too', () => {
    const managedPolicies = template.findResources('AWS::IAM::ManagedPolicy');
    const boundaryStatements = Object.values(managedPolicies)
      .map((p) => statementsOfDocument(p.Properties?.PolicyDocument))
      .find((statements) => statements.some((s) => actionsOf(s).includes('cloudformation:DescribeStackResource')));
    expect(boundaryStatements).toBeDefined();

    const stmt = boundaryStatements!.find((s) => actionsOf(s).includes('cloudformation:DescribeStackResource'));
    const resources = resourcesOf(stmt!);
    expect(resources).not.toContain('*');
    expect(resources[0]).toEqual({ Ref: 'AWS::StackId' });

    // A boundary is a ceiling: the executing role also needs this grant in its own policy, checked
    // in the sibling test above — this only proves the boundary doesn't deny it.
  });
});
