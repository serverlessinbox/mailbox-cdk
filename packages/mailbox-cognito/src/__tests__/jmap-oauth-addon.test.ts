/**
 * CDK Synth Tests — JmapOAuthAddon (DCR gating: `dynamicClientRegistration`)
 *
 * Exercises the real `JmapOAuthAddon` instance returned by
 * `MailboxUserPool.createJmapApiAddons()` — the exact production wiring path used by
 * `mailbox.ts` — rather than hand-constructing the addon, so these tests also cover the
 * `MailboxUserPoolProps.dynamicClientRegistration` threading.
 *
 * `dynamicClientRegistration` is a real jsii `DynamicClientRegistrationMode` enum
 * (`ENABLED`/`DISABLED`). A CFN-parameter token is still supported by casting the parameter's
 * `valueAsString` through the enum type at the call site — the value is only resolvable at deploy
 * time. Behavior differs by which:
 *  - Literal `DISABLED` (or omitted, the default) turns DCR fully off AT SYNTH: no DCR Lambda,
 *    no route, no `CfnCondition`, and a plain (non-`Fn::If`) discovery body with no
 *    `registration_endpoint`.
 *  - Literal `ENABLED` or an unresolved token (cast through the enum) both take the gated path: a
 *    `CfnCondition` is built via `Fn::Equals`, the DCR Lambda is constructed unconditionally and
 *    gated (along with its route/integration) via an Aspect, and the discovery body is an
 *    `Fn::If` selecting between with/without `registration_endpoint`.
 *  - Any other value cast through the enum (e.g. leftover `'true'`/`'false'`) throws at synth.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { HttpApi } from 'aws-cdk-lib/aws-apigatewayv2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { PinnedResolver } from '@serverlessinbox/mailbox-cdk-shared';
import { MailboxUserPool, DynamicClientRegistrationMode } from '../auth/mailbox-user-pool';
import { JmapOAuthAddon } from '../api/jmap-oauth-addon';

const API_BASE_URL = 'https://api.example.com';
const REGISTRATION_ROUTE_KEY = 'POST /oauth/register';

function setUpArtifactContext(app: App): void {
  app.node.setContext('artifacts', {
    bucketBase: 'test-artifacts',
    packages: {
      'mailbox-cognito': { kind: 'release', version: '0.0.1-test' },
      'mailbox-cdk': { kind: 'release', version: '0.0.1-test' },
      'mailbox': { kind: 'release', version: '0.0.1-test' },
      'mailbox-cdk-shared': { kind: 'release', version: '0.0.1-test' },
    },
  });
  app.node.setContext('artifactVersions', {});
}

interface Harness {
  stack: cdk.Stack;
  addon: JmapOAuthAddon;
  api: HttpApi;
}

/**
 * Builds a stack with a real MailboxUserPool + the real JmapOAuthAddon it produces via
 * createJmapApiAddons() — the same call mailbox.ts makes. Discovery is always enabled here
 * (required for the addon to be constructed at all); `dynamicClientRegistration` is the thing
 * under test.
 *
 * `dynamicClientRegistration` may be:
 *  - omitted entirely (tests the `@default DynamicClientRegistrationMode.DISABLED` behavior)
 *  - an enum member (or an arbitrary string cast through the enum, to exercise the invalid-value
 *    throw path)
 *  - a factory `(stack) => DynamicClientRegistrationMode` for building a value that needs the
 *    stack first (e.g. a real `CfnParameter`'s `valueAsString`, cast through the enum)
 */
function buildHarness(
  dynamicClientRegistration?: DynamicClientRegistrationMode | ((stack: cdk.Stack) => DynamicClientRegistrationMode),
): Harness {
  const app = new App();
  setUpArtifactContext(app);
  const stack = new cdk.Stack(app, 'TestJmapOAuthAddonStack', {
    env: { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });

  const resolver = PinnedResolver.loadFromArtifactMetadata(stack);
  resolver.registerPackages(['mailbox-cognito', 'mailbox-cdk', 'mailbox']);

  const mode = typeof dynamicClientRegistration === 'function'
    ? dynamicClientRegistration(stack)
    : dynamicClientRegistration;

  const pool = new MailboxUserPool(stack, 'user-pool', {
    domain: { kind: 'cognito', cognitoDomainPrefix: 'test-oauth' },
    artifactResolver: resolver,
    enableJmapOAuthDiscovery: true,
    ...(mode !== undefined ? { dynamicClientRegistration: mode } : {}),
  });

  const identityProvisionerFn = new lambda.Function(stack, 'identity-provisioner-stub', {
    runtime: lambda.Runtime.NODEJS_24_X,
    handler: 'index.handler',
    code: lambda.Code.fromInline('exports.handler = async () => {};'),
  });

  const [addon] = pool.createJmapApiAddons(stack, {
    apiBaseUrl: API_BASE_URL,
    identityProvisionerFunction: identityProvisionerFn,
  });

  const api = new HttpApi(stack, 'test-api');

  return { stack, addon: addon as JmapOAuthAddon, api };
}

/** The single CfnCondition JmapOAuthAddon creates (when DCR isn't fully disabled) to gate DCR
 *  resources takes the shape `{"Fn::Equals": [<flag>, "enabled"]}`. Finds it (there must be
 *  exactly one in the template), asserts its first operand matches the flag value the harness was
 *  built with — proving the condition is genuinely wired to the prop rather than a hardcoded
 *  literal — and returns its logical ID so callers can assert individual resources carry it as
 *  their `Condition`. `expectedFlag` is compared with `toEqual` so it can be either a literal
 *  string or a resolved `{ Ref: ... }` token shape. */
function findGatingConditionLogicalId(template: Template, expectedFlag: unknown): string {
  const conditions = (template.toJSON().Conditions ?? {}) as Record<string, { 'Fn::Equals'?: [unknown, unknown] }>;
  const matches = Object.entries(conditions).filter(
    ([, expr]) => Array.isArray(expr['Fn::Equals']) && expr['Fn::Equals']![1] === DynamicClientRegistrationMode.ENABLED,
  );
  expect(matches).toHaveLength(1);
  const [logicalId, expr] = matches[0];
  expect(expr['Fn::Equals']![0]).toEqual(expectedFlag);
  return logicalId;
}

/** The DCR Lambda (JmapOAuthDcrLambda) is the only function in this stack whose environment
 *  carries IDENTITY_PROVISIONER_FUNCTION_NAME — a reliable, non-token discriminator
 *  (functionName/description both embed unresolved CDK tokens and never string-match). */
function findDcrFunctionEntries(template: Template): unknown[] {
  const dcrFunctions = template.findResources('AWS::Lambda::Function', {
    Properties: Match.objectLike({
      Environment: Match.objectLike({
        Variables: Match.objectLike({ IDENTITY_PROVISIONER_FUNCTION_NAME: Match.anyValue() }),
      }),
    }),
  });
  return Object.values(dcrFunctions);
}

/** The openid-configuration document is written via StaticContentDeployer as a `Custom::ContentDeployment`
 *  resource whose `Properties.sources[0].body` holds the document — either a plain (Fn::Join'd)
 *  value when DCR is fully disabled at synth, or an `Fn::If` selecting between two complete,
 *  JSON.stringify'd document variants (with/without `registration_endpoint`) when gated. */
function findDiscoveryDocumentBody(template: Template): unknown {
  const resources = template.findResources('Custom::ContentDeployment');
  for (const resource of Object.values(resources)) {
    const sources = (resource as any).Properties?.sources as Array<Record<string, unknown>> | undefined;
    const match = sources?.find((s) => s.key === '.well-known/openid-configuration');
    if (match) return match.body;
  }
  throw new Error('openid-configuration Custom::ContentDeployment resource not found in template');
}

function isFnIf(value: unknown): value is { 'Fn::If': [string, unknown, unknown] } {
  return !!value && typeof value === 'object' && 'Fn::If' in (value as Record<string, unknown>);
}

/** Asserts the discovery body is gated (`Fn::If`) and returns its two branches. */
function findDiscoveryDocumentFnIfBranches(template: Template): { trueBranch: unknown; falseBranch: unknown } {
  const body = findDiscoveryDocumentBody(template);
  if (!isFnIf(body)) throw new Error('expected discovery document body to be an Fn::If');
  const [, trueBranch, falseBranch] = body['Fn::If'];
  return { trueBranch, falseBranch };
}

/** Flattens a resolved CFN value back to searchable text by concatenating only the literal string
 *  fragments of an `Fn::Join` (dropping token refs) — sufficient for substring/key-name checks
 *  because doc keys are always literal, even where some field values are token-derived. */
function flattenToSearchableText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'Fn::Join' in (value as Record<string, unknown>)) {
    const [, parts] = (value as { 'Fn::Join': [string, unknown[]] })['Fn::Join'];
    return parts.map((p) => (typeof p === 'string' ? p : '')).join('');
  }
  return '';
}

/** Extracts the ordered list of JSON object key names from flattened document text. Key names are
 *  always literal (never token-derived), so this survives token fragments dropped by
 *  flattenToSearchableText — letting the two Fn::If branches be compared by key set rather than by
 *  brittle whole-string matching. */
function extractDocumentKeys(flattenedText: string): string[] {
  const keys: string[] = [];
  const keyPattern = /"([a-zA-Z_]+)":/g;
  let match: RegExpExecArray | null;
  while ((match = keyPattern.exec(flattenedText)) !== null) {
    keys.push(match[1]);
  }
  return keys;
}

/** Shared assertions for both ways DCR ends up fully disabled at synth (DISABLED literal, and
 *  the omitted-prop default) — no Lambda, no route, no CfnCondition, plain discovery body. */
function assertDcrFullyDisabled(harness: Harness): void {
  const { stack, addon, api } = harness;
  addon.addRoutes(api);
  const template = Template.fromStack(stack);

  const routes = template.findResources('AWS::ApiGatewayV2::Route', {
    Properties: Match.objectLike({ RouteKey: REGISTRATION_ROUTE_KEY }),
  });
  expect(Object.values(routes)).toHaveLength(0);

  expect(findDcrFunctionEntries(template)).toHaveLength(0);

  const conditions = template.toJSON().Conditions ?? {};
  expect(Object.keys(conditions)).toHaveLength(0);

  const body = findDiscoveryDocumentBody(template);
  expect(isFnIf(body)).toBe(false);
  const keys = extractDocumentKeys(flattenToSearchableText(body));
  expect(keys).not.toContain('registration_endpoint');
}

describe('JmapOAuthAddon — dynamicClientRegistration gating', () => {
  it("enabled: registration route exists with no authorizer", () => {
    const { stack, addon, api } = buildHarness(DynamicClientRegistrationMode.ENABLED);
    addon.addRoutes(api);

    const template = Template.fromStack(stack);
    const routes = template.findResources('AWS::ApiGatewayV2::Route', {
      Properties: Match.objectLike({ RouteKey: REGISTRATION_ROUTE_KEY }),
    });

    const matches = Object.values(routes);
    expect(matches).toHaveLength(1);

    const props = (matches[0] as any).Properties;
    expect(props.AuthorizerId).toBeUndefined();
    expect(['NONE', undefined]).toContain(props.AuthorizationType);
  });

  it('enabled: DCR route, Lambda, and integration all carry the gating condition', () => {
    const { stack, addon, api } = buildHarness(DynamicClientRegistrationMode.ENABLED);
    addon.addRoutes(api);

    const template = Template.fromStack(stack);
    const conditionId = findGatingConditionLogicalId(template, DynamicClientRegistrationMode.ENABLED);

    // Route: mounted, and gated
    const routes = template.findResources('AWS::ApiGatewayV2::Route', {
      Properties: Match.objectLike({ RouteKey: REGISTRATION_ROUTE_KEY }),
    });
    const routeEntries = Object.values(routes);
    expect(routeEntries).toHaveLength(1);
    expect((routeEntries[0] as any).Condition).toBe(conditionId);

    // DCR Lambda: mounted, and gated
    const dcrFunctionEntries = findDcrFunctionEntries(template);
    expect(dcrFunctionEntries).toHaveLength(1);
    expect((dcrFunctionEntries[0] as any).Condition).toBe(conditionId);

    // Its API Gateway Lambda integration: gated (the GET /.well-known integration must NOT carry
    // this condition — asserting exactly one match proves that).
    const integrations = template.findResources('AWS::ApiGatewayV2::Integration');
    const gatedIntegrations = Object.values(integrations).filter((r: any) => r.Condition === conditionId);
    expect(gatedIntegrations).toHaveLength(1);
  });

  it('enabled: discovery document — the true branch adds exactly one key (registration_endpoint) versus the false branch', () => {
    const { stack } = buildHarness(DynamicClientRegistrationMode.ENABLED);
    const template = Template.fromStack(stack);
    const { trueBranch, falseBranch } = findDiscoveryDocumentFnIfBranches(template);

    const trueText = flattenToSearchableText(trueBranch);
    const falseText = flattenToSearchableText(falseBranch);

    const trueKeys = extractDocumentKeys(trueText);
    const falseKeys = extractDocumentKeys(falseText);

    expect(new Set(trueKeys)).toEqual(new Set([...falseKeys, 'registration_endpoint']));
    expect(trueKeys.filter((k) => k !== 'registration_endpoint')).toEqual(falseKeys);
    expect(trueText).toContain(`"registration_endpoint":"${API_BASE_URL}/oauth/register"`);
  });

  it('enabled: carries the per-route throttle (burst 5 / rate 2) on POST /oauth/register, gated via the same Fn::If', () => {
    const { stack, addon, api } = buildHarness(DynamicClientRegistrationMode.ENABLED);
    addon.addRoutes(api);

    const template = Template.fromStack(stack);
    const conditionId = findGatingConditionLogicalId(template, DynamicClientRegistrationMode.ENABLED);

    const stages = template.findResources('AWS::ApiGatewayV2::Stage');
    const stageEntries = Object.values(stages);
    expect(stageEntries).toHaveLength(1);

    const routeSettings = (stageEntries[0] as any).Properties.RouteSettings;
    expect(routeSettings[REGISTRATION_ROUTE_KEY]).toEqual({
      'Fn::If': [conditionId, { throttlingBurstLimit: 5, throttlingRateLimit: 2 }, { Ref: 'AWS::NoValue' }],
    });
  });

  it("disabled literal: DCR fully off at synth — no Lambda, no route, no CfnCondition, plain discovery body", () => {
    assertDcrFullyDisabled(buildHarness(DynamicClientRegistrationMode.DISABLED));
  });

  it('omitted dynamicClientRegistration: defaults to fully disabled, same as the disabled literal', () => {
    assertDcrFullyDisabled(buildHarness());
  });

  it('a CFN-parameter token behaves like enabled — condition created, resources gated — and does not throw', () => {
    let param!: cdk.CfnParameter;
    let harness!: Harness;

    expect(() => {
      harness = buildHarness((stack) => {
        param = new cdk.CfnParameter(stack, 'DcrModeParam', { type: 'String', default: 'enabled' });
        return param.valueAsString as DynamicClientRegistrationMode;
      });
    }).not.toThrow();

    const { stack, addon, api } = harness;
    addon.addRoutes(api);

    const template = Template.fromStack(stack);
    const expectedFlag = { Ref: stack.getLogicalId(param) };
    const conditionId = findGatingConditionLogicalId(template, expectedFlag);

    const dcrFunctionEntries = findDcrFunctionEntries(template);
    expect(dcrFunctionEntries).toHaveLength(1);
    expect((dcrFunctionEntries[0] as any).Condition).toBe(conditionId);

    const routes = template.findResources('AWS::ApiGatewayV2::Route', {
      Properties: Match.objectLike({ RouteKey: REGISTRATION_ROUTE_KEY }),
    });
    expect((Object.values(routes)[0] as any).Condition).toBe(conditionId);
  });

  it("an invalid value ('true') cast through the enum throws at synth with a clear message", () => {
    expect(() => buildHarness('true' as DynamicClientRegistrationMode)).toThrow(/dynamicClientRegistration must be 'enabled' or 'disabled'/);
  });
});
