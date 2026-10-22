/**
 * Pins what `StackFailureDetectionInfra` provisions for the detector: physical names that fit the
 * IAM/Lambda 64-char limit, retention of every resource the detector needs after a create rollback,
 * the EventBridge rule that triggers it, and a role whose only policy is the one explicit detector
 * policy.
 *
 * Name length: a name that embeds an unbounded part, such as a construct id or the full 36-char stack
 * GUID, fails the deploy with "roleName failed to satisfy constraint: Member must have length less
 * than or equal to 64" once that part is long, while a synth that asserts nothing about length passes.
 *
 * Name identity: each name carries the position hash of the role or function it names, so moving the
 * construct or giving the resource a new id changes the name and the retained original never shares a
 * name with its replacement.
 *
 * Retention: loosening a retained resource to the default policy lets CloudFormation delete the detector
 * while it reports the very rollback that triggered it.
 *
 * Single policy: the role is deleted by name together with its one named policy; a second, implicit
 * `DefaultPolicy` cannot be removed that way, so the role could never be deleted.
 */

import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin, IArtifactResolver }  from '@serverlessinbox/artifact-registry-cdk';
import { PositionHash }                         from '@serverlessinbox/mailbox-cdk-shared';
import { Template }                             from 'aws-cdk-lib/assertions';
import * as cdk                                 from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }        from 'aws-cdk-lib';
import { Construct }                            from 'constructs';

import { StackFailureDetectionInfra }           from '../stack-failure-detection-infra';

const VENDOR_ACCOUNT_ID    = '444455556666';
const DETECTOR_POLICY_NAME = 'stack-failure-detector-policy';

/** A physical name built with `Fn.join('', [...])`, as far as these assertions read it. */
interface JoinToken {
  readonly 'Fn::Join': [string, unknown[]];
}

/** An `Fn.select(index, Fn.split(delimiter, source))` token. */
interface SelectToken {
  readonly 'Fn::Select': [number, { readonly 'Fn::Split': [string, unknown] }];
}

/** The parts of a synthesized CFN resource these assertions read. */
interface SynthesizedResource {
  readonly DeletionPolicy?:      string;
  readonly UpdateReplacePolicy?: string;
  readonly Properties:           {
    readonly RoleName?:     JoinToken;
    readonly FunctionName?: JoinToken;
    readonly Name?:         string;
    readonly PolicyName?:   string;
    readonly LogGroupName?: unknown;
  };
}

type NamedProperty = 'RoleName' | 'FunctionName';

function createTestArtifactResolver(stack: cdk.Stack): IArtifactResolver {
  const packages: Record<string, ArtifactPin> = {
    'mailbox-cdk': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
    'mailbox-go':  { version: '1.0.0', zone: ArtifactZone.REGIONAL },
  };
  return new PinnedArtifactResolver({
    packages,
    location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
    deploymentRegion: stack.region,
  });
}

interface SynthesizedDetection {
  readonly template: Template;
  readonly infra:    StackFailureDetectionInfra;
}

function synthesizeDetection(parentId: string): SynthesizedDetection {
  const app   = new App();
  const stack = new cdk.Stack(app, 'test-stack-diag-name-length', {
    env:         { account: '111122223333', region: 'us-east-1' },
    synthesizer: new BootstraplessSynthesizer(),
  });

  const parent = new Construct(stack, parentId);
  const infra  = new StackFailureDetectionInfra(parent, 'infra', {
    artifactResolver: createTestArtifactResolver(stack),
    vendorAccountIds: [VENDOR_ACCOUNT_ID],
  });

  return { template: Template.fromStack(stack), infra };
}

function synthesizeDetectionTemplate(): Template {
  return synthesizeDetection('stack-failure-detection').template;
}

function resourcesOfType(template: Template, type: string): SynthesizedResource[] {
  // cast: CDK's findResources returns untyped template JSON; this is the one framework boundary.
  return Object.values(template.findResources(type)) as SynthesizedResource[];
}

/**
 * Length of an `Fn::Select` token used inside these names, keyed off which selection it actually
 * performs rather than assumed — the construct uses two `Fn::Select` shapes with very different
 * lengths, and conflating them would hide the exact bug this suite exists to catch:
 * - `Fn.select(2, Fn.split('/', AWS::StackId))` — the raw stack GUID, always the fixed 36-char UUID
 *   format (`8-4-4-4-12`).
 * - `Fn.select(0, Fn.split('-', <that 36-char GUID>))` — just the UUID's first 8-char segment.
 * Both lengths are fixed by the UUID format, not by anything CloudFormation could vary at deploy time,
 * so each is a genuine worst case for its shape.
 */
function selectedTokenLength(token: SelectToken): number {
  const [index, source] = token['Fn::Select'];
  const splitDelimiter  = source['Fn::Split'][0];
  if (index === 2 && splitDelimiter === '/') {
    return 36;
  }
  if (index === 0 && splitDelimiter === '-') {
    return 8;
  }
  throw new Error(`Unrecognized Fn::Select token shape: ${JSON.stringify(token)}`);
}

/**
 * Worst-case concrete length of a physical name built as `Fn.join('', [...])`. Every literal string
 * part contributes its real length; every `Fn::Select` part contributes `selectedTokenLength` above.
 */
function worstCaseJoinLength(name: JoinToken | undefined): number {
  if (!name) {
    throw new Error('Expected an explicit Fn::Join name, found none');
  }
  const [delimiter, parts] = name['Fn::Join'];
  if (delimiter !== '') {
    throw new Error(`Expected an empty Fn::Join delimiter, got ${JSON.stringify(delimiter)}`);
  }
  return parts.reduce<number>((sum, part) => {
    if (typeof part === 'string') {
      return sum + part.length;
    }
    if (typeof part === 'object' && part !== null && 'Fn::Select' in part) {
      // cast: narrowed by the 'Fn::Select' key check above; the token shape is validated in selectedTokenLength.
      return sum + selectedTokenLength(part as SelectToken);
    }
    throw new Error(`Unexpected Fn::Join part shape: ${JSON.stringify(part)}`);
  }, 0);
}

/**
 * Picks out the resource whose explicit name (an `Fn::Join` token) starts with `prefix` — rather than
 * assuming exactly one resource of a given type is explicitly named.
 */
function findByNamePrefix(resources: SynthesizedResource[], propertyName: NamedProperty, prefix: string): SynthesizedResource {
  const match = resources.find((resource) => {
    const firstPart = resource.Properties[propertyName]?.['Fn::Join'][1][0];
    return typeof firstPart === 'string' && firstPart.startsWith(prefix);
  });
  if (!match) {
    throw new Error(`No resource found with an explicit ${propertyName} starting with ${JSON.stringify(prefix)}`);
  }
  return match;
}

describe('StackFailureDetectionInfra — physical name length', () => {
  let template: Template;

  beforeEach(() => {
    template = synthesizeDetectionTemplate();
  });

  it('the detector function name fits the Lambda function-name limit (64 chars)', () => {
    const detectorFn = findByNamePrefix(resourcesOfType(template, 'AWS::Lambda::Function'), 'FunctionName', 'mailbox-diag-fn-');

    const length = worstCaseJoinLength(detectorFn.Properties.FunctionName);
    expect(length).toBeLessThanOrEqual(64);
  });

  it('the detector role name fits the IAM role-name limit (64 chars)', () => {
    const detectorRole = findByNamePrefix(resourcesOfType(template, 'AWS::IAM::Role'), 'RoleName', 'mailbox-diag-role-');

    const length = worstCaseJoinLength(detectorRole.Properties.RoleName);
    expect(length).toBeLessThanOrEqual(64);
  });

  it('each name ends in the position hash of the role or function it names and differs when the infra sits under another parent', () => {
    const first  = synthesizeDetection('group-one');
    const second = synthesizeDetection('group-two');

    const namesOf = (detection: SynthesizedDetection): [unknown, unknown] => [
      findByNamePrefix(resourcesOfType(detection.template, 'AWS::IAM::Role'), 'RoleName', 'mailbox-diag-role-').Properties.RoleName?.['Fn::Join'][1][0],
      findByNamePrefix(resourcesOfType(detection.template, 'AWS::Lambda::Function'), 'FunctionName', 'mailbox-diag-fn-').Properties.FunctionName?.['Fn::Join'][1][0],
    ];

    expect(namesOf(first)).toEqual([
      `mailbox-diag-role-${PositionHash.of(first.infra.node.findChild('detector-role-v2'))}-`,
      `mailbox-diag-fn-${PositionHash.of(first.infra.node.findChild('detector-v2'))}-`,
    ]);
    expect(namesOf(first)).not.toEqual(namesOf(second));
  });
});

describe('StackFailureDetectionInfra — retention on every operation', () => {
  let template: Template;

  beforeEach(() => {
    template = synthesizeDetectionTemplate();
  });

  it('the detector role, function and detector policy are retained', () => {
    const roles    = resourcesOfType(template, 'AWS::IAM::Role');
    const fns      = resourcesOfType(template, 'AWS::Lambda::Function');
    const policies = resourcesOfType(template, 'AWS::IAM::Policy').filter(
      (p) => p.Properties.PolicyName === DETECTOR_POLICY_NAME,
    );

    expect(policies).toHaveLength(1);
    expect(findByNamePrefix(roles, 'RoleName', 'mailbox-diag-role-')).toMatchObject({
      DeletionPolicy:      'Retain',
      UpdateReplacePolicy: 'Retain',
    });
    expect(findByNamePrefix(fns, 'FunctionName', 'mailbox-diag-fn-')).toMatchObject({
      DeletionPolicy:      'Retain',
      UpdateReplacePolicy: 'Retain',
    });
    expect(policies[0]).toMatchObject({ DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' });
  });

  it('the infra pipeline log group is retained', () => {
    const groups = resourcesOfType(template, 'AWS::Logs::LogGroup').filter((g) =>
      JSON.stringify(g.Properties.LogGroupName).includes('infra'),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' });
  });
});

describe('StackFailureDetectionInfra — detector role policies', () => {
  it('attaches exactly one policy, the explicit detector policy, so the role has no implicit DefaultPolicy', () => {
    const template = synthesizeDetectionTemplate();

    const policies = resourcesOfType(template, 'AWS::IAM::Policy');

    expect(policies.map((policy) => policy.Properties.PolicyName)).toEqual([DETECTOR_POLICY_NAME]);
  });
});

describe('StackFailureDetectionInfra — vendor license API access', () => {
  interface PolicyStatementJson {
    readonly Action:    string | string[];
    readonly Resource?: string | string[];
  }

  /** The synthesized IAM policy resource, as far as this suite reads it. */
  interface SynthesizedPolicy {
    readonly Properties: {
      readonly PolicyName:     string;
      readonly PolicyDocument: { readonly Statement: PolicyStatementJson[] };
    };
  }

  it('the detector policy grants execute-api:Invoke on the vendor issue-upload route only', () => {
    const template = synthesizeDetectionTemplate();
    // cast: CDK's findResources returns untyped template JSON; this is the one framework boundary.
    const policies = Object.values(template.findResources('AWS::IAM::Policy')) as SynthesizedPolicy[];

    const detectorPolicy = policies.find((p) => p.Properties.PolicyName === DETECTOR_POLICY_NAME);
    const invoke         = detectorPolicy?.Properties.PolicyDocument.Statement.find((s) =>
      [s.Action].flat().includes('execute-api:Invoke'),
    );

    expect([invoke?.Resource].flat()).toEqual([
      `arn:aws:execute-api:*:${VENDOR_ACCOUNT_ID}:*/*/POST/issue-stack-failure-upload`,
    ]);
  });
});
