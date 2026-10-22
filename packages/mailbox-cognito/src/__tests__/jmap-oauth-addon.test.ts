/// <reference types="jest" />

/**
 * CDK synth tests of JmapOAuthAddon: the gating of Dynamic Client Registration by `dynamicClientRegistration`.
 *
 * The addon is the one `MailboxUserPool.createJmapApiAddons()` returns, the wiring `mailbox.ts` uses, so the tests
 * also cover how `MailboxUserPoolProps.dynamicClientRegistration` reaches it. A CFN-parameter token is supported
 * by casting the parameter's `valueAsString` through the enum; its value is only known at deploy time.
 * - Literal `DISABLED` (or omitted) turns DCR off at synth: no DCR Lambda, no route, no `CfnCondition`, and a
 *   plain discovery body without `registration_endpoint`.
 * - Literal `ENABLED` or a token take the gated path: a `CfnCondition` on `Fn::Equals`, the DCR Lambda and its
 *   route and integration gated by an Aspect, and a discovery body that is an `Fn::If` between the variants with
 *   and without `registration_endpoint`.
 * - Any other value cast through the enum throws at synth.
 *
 * A route setting that API Gateway rejects fails the deploy and cannot be seen in a unit test of the construct,
 * so the template is asserted: the throttle keys are the PascalCase keys CloudFormation reads, and the stage
 * depends on every route it has settings for.
 */

import { renderLiteralText }                  from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { MailboxArtifactResolverFactory }     from '@serverlessinbox/mailbox-cdk-shared';
import { Template, Match }                    from 'aws-cdk-lib/assertions';
import { HttpApi }                            from 'aws-cdk-lib/aws-apigatewayv2';
import * as lambda                            from 'aws-cdk-lib/aws-lambda';
import * as cdk                               from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }      from 'aws-cdk-lib';
import * as t                                 from 'typanion';
import type { StrictValidator }               from 'typanion';

import { JmapOAuthAddon }                     from '../jmap-oauth-addon';
import { loadMailboxCognitoArtifactVersions } from '../mailbox-cognito-artifact-versions';
import { loadMailboxCognitoRegistryRecord }   from '../mailbox-cognito-registry-record';
import { SUPPORTED_SCOPES }                   from '../runtime/jmap-oauth-dcr/supported-scopes';
import { DynamicClientRegistrationMode }      from '../user-pool/dynamic-client-registration-mode';
import { MailboxUserPool }                    from '../user-pool/mailbox-user-pool';

const API_BASE_URL           = 'https://api.example.com';
const REGISTRATION_ROUTE_KEY = 'POST /oauth/register';

const isIntrinsicOrString = t.isOneOf([t.isString(), t.isPartial({ Ref: t.isOptional(t.isString()) })]);

const isEqualsCondition = t.isPartial({ 'Fn::Equals': t.isOptional(t.isTuple([isIntrinsicOrString, isIntrinsicOrString])) });

const isConditions = t.isRecord(isEqualsCondition);

const isStage = t.isPartial({
  DependsOn:  t.isOptional(t.isArray(t.isString())),
  Properties: t.isPartial({ RouteSettings: t.isRecord(t.isPartial({})) }),
});

const isRoute = t.isPartial({ Properties: t.isPartial({ RouteKey: t.isString() }) });

const isContentDeployment = t.isPartial({
  Properties: t.isPartial({
    sources: t.isOptional(t.isArray(t.isPartial({ key: t.isOptional(t.isString()), body: t.isOptional(isIntrinsicOrString) }))),
  }),
});

const isFnIfBody = t.isPartial({ 'Fn::If': t.isTuple([t.isString(), isIntrinsicOrString, isIntrinsicOrString]) });

function setUpArtifactContext(app: App): void {
  app.node.setContext('serverlessinbox:artifacts', {
    bucketBase: 'test-artifacts',
    packages:   {
      'mailbox-cognito':    { zone: 'regional', version: '0.0.1-test' },
      'mailbox-cdk':        { zone: 'regional', version: '0.0.1-test' },
      'mailbox':            { zone: 'regional', version: '0.0.1-test' },
      'mailbox-cdk-shared': { zone: 'regional', version: '0.0.1-test' },
    },
  });
  app.node.setContext('serverlessinbox:artifact_versions', {});
}

/** The synthesized stack with the addon under test and the HTTP API it mounts its routes on. */
interface Harness {
  readonly stack: cdk.Stack;
  readonly addon: JmapOAuthAddon;
  readonly api:   HttpApi;
}

/** A synthesized resource or template section that has to match `validator`, so that the tests read typed values; a mismatch throws, naming what is wrong. */
function validated<Value>(value: unknown, validator: StrictValidator<unknown, Value>, what: string): Value {
  const errors: string[] = [];
  if (!validator(value, { errors })) {
    throw new Error(`${what} has an unexpected shape: ${errors.join('; ')}`);
  }
  return value;
}

/** The resources of one CloudFormation type in the template, each validated against `validator`. */
function resourcesOfType<Resource>(template: Template, type: string, validator: StrictValidator<unknown, Resource>): Record<string, Resource> {
  return Object.fromEntries(
    Object.entries(template.findResources(type)).map(([logicalId, resource]) => [logicalId, validated(resource, validator, `${type} ${logicalId}`)]),
  );
}

function conditionsOf(template: Template): t.InferType<typeof isConditions> {
  return validated(template.toJSON().Conditions ?? {}, isConditions, 'Conditions');
}

/**
 * Builds a stack with a real MailboxUserPool and the JmapOAuthAddon it produces. Discovery is always enabled, as
 * the addon is only constructed then; `dynamicClientRegistration` is what is under test. It is omitted (the
 * `@default DISABLED`), an enum member, an arbitrary string cast through the enum (the invalid-value path), or a
 * factory that builds the value from the stack, such as a `CfnParameter`'s `valueAsString`.
 */
function buildHarness(
  dynamicClientRegistration?: DynamicClientRegistrationMode | ((stack: cdk.Stack) => DynamicClientRegistrationMode),
): Harness {
  const app = new App();
  setUpArtifactContext(app);
  const stack = new cdk.Stack(app, 'TestJmapOAuthAddonStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });

  const resolver = MailboxArtifactResolverFactory.fromContext(stack, loadMailboxCognitoRegistryRecord(), loadMailboxCognitoArtifactVersions());

  const mode = typeof dynamicClientRegistration === 'function'
    ? dynamicClientRegistration(stack)
    : dynamicClientRegistration;

  const pool = new MailboxUserPool(stack, 'user-pool', {
    domain:                   { kind: 'cognito', cognitoDomainPrefix: 'test-oauth' },
    artifactResolver:         resolver,
    enableJmapOAuthDiscovery: true,
    ...(mode !== undefined ? { dynamicClientRegistration: mode } : {}),
  });

  const identityProvisionerFn = new lambda.Function(stack, 'identity-provisioner-stub', {
    runtime: lambda.Runtime.NODEJS_24_X,
    handler: 'index.handler',
    code:    lambda.Code.fromInline('exports.handler = async () => {};'),
  });

  const [addon] = pool.createJmapApiAddons(stack, {
    apiBaseUrl:          API_BASE_URL,
    identityProvisioner: identityProvisionerFn,
  });
  if (!(addon instanceof JmapOAuthAddon)) {
    throw new Error('the user pool did not create a JmapOAuthAddon');
  }

  return { stack, addon, api: new HttpApi(stack, 'test-api') };
}

/**
 * The one `CfnCondition` the addon creates, when DCR is not fully disabled, to gate its resources, of the shape
 * `{"Fn::Equals": [<flag>, "enabled"]}`. Asserts that its first operand is the flag the harness was built with,
 * which proves the condition is wired to the prop and not to a literal, and returns its logical ID so that a
 * resource can be asserted to carry it as its `Condition`. `expectedFlag` is a literal string or a `{ Ref }` token.
 */
function findGatingConditionLogicalId(template: Template, expectedFlag: unknown): string {
  const matches = Object.entries(conditionsOf(template)).filter((condition) => condition[1]['Fn::Equals']?.[1] === DynamicClientRegistrationMode.ENABLED);
  expect(matches).toHaveLength(1);

  const [logicalId, expression] = matches[0];
  expect(expression['Fn::Equals']?.[0]).toEqual(expectedFlag);
  return logicalId;
}

/**
 * The function of the DCR Lambda. It is the only function of the stack whose environment carries
 * IDENTITY_PROVISIONER_FUNCTION_NAME; its name and description hold unresolved tokens that cannot be matched.
 */
function findDcrFunctionEntries(template: Template): Array<Record<string, unknown>> {
  const dcrFunctions = template.findResources('AWS::Lambda::Function', {
    Properties: Match.objectLike({
      Environment: Match.objectLike({
        Variables: Match.objectLike({ IDENTITY_PROVISIONER_FUNCTION_NAME: Match.anyValue() }),
      }),
    }),
  });
  return Object.values(dcrFunctions);
}

function findRegistrationRoutes(template: Template): Array<Record<string, unknown>> {
  return Object.values(template.findResources('AWS::ApiGatewayV2::Route', {
    Properties: Match.objectLike({ RouteKey: REGISTRATION_ROUTE_KEY }),
  }));
}

/**
 * The openid-configuration document is written by the StaticContentDeployer as a `Custom::ContentDeployment`
 * whose `Properties.sources[0].body` is the document: a plain value when DCR is fully disabled at synth, or an
 * `Fn::If` between two complete serialized variants (with and without `registration_endpoint`) when gated.
 */
function findDiscoveryDocumentBody(template: Template): unknown {
  for (const resource of Object.values(resourcesOfType(template, 'Custom::ContentDeployment', isContentDeployment))) {
    const source = resource.Properties.sources?.find((candidate) => candidate.key === '.well-known/openid-configuration');
    if (source) {
      return source.body;
    }
  }
  throw new Error('openid-configuration Custom::ContentDeployment resource not found in template');
}

function isFnIf(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'Fn::If' in value;
}

function findDiscoveryDocumentFnIfBranches(template: Template): { trueBranch: unknown; falseBranch: unknown } {
  const body                        = validated(findDiscoveryDocumentBody(template), isFnIfBody, 'the discovery document body');
  const [, trueBranch, falseBranch] = body['Fn::If'];
  return { trueBranch, falseBranch };
}

/**
 * The ordered key names of a flattened JSON document. Key names are literal even where token fragments were
 * dropped by `renderLiteralText`, so the two `Fn::If` branches can be compared by their keys.
 */
function extractDocumentKeys(flattenedText: string): string[] {
  return Array.from(flattenedText.matchAll(/"([a-zA-Z_]+)":/g), (match) => match[1]);
}

/** The assertions for both ways DCR ends fully disabled at synth: the `DISABLED` literal and the omitted prop. */
function assertDcrFullyDisabled(harness: Harness): void {
  const { stack, addon, api } = harness;
  addon.addRoutes(api);
  const template = Template.fromStack(stack);

  expect(findRegistrationRoutes(template)).toHaveLength(0);
  expect(findDcrFunctionEntries(template)).toHaveLength(0);
  expect(Object.keys(conditionsOf(template))).toHaveLength(0);

  const body = findDiscoveryDocumentBody(template);
  expect(isFnIf(body)).toBe(false);
  expect(extractDocumentKeys(renderLiteralText(body))).not.toContain('registration_endpoint');
}

describe('JmapOAuthAddon: dynamicClientRegistration gating', () => {
  it('enabled: the registration route exists with no authorizer', () => {
    const { stack, addon, api } = buildHarness(DynamicClientRegistrationMode.ENABLED);
    addon.addRoutes(api);

    const routes = findRegistrationRoutes(Template.fromStack(stack));

    expect(routes).toHaveLength(1);
    expect(routes[0].Properties).not.toHaveProperty('AuthorizerId');
    expect(['NONE', undefined]).toContain((routes[0].Properties as Record<string, unknown>).AuthorizationType);
  });

  it('enabled: the DCR route, Lambda and integration all carry the gating condition', () => {
    const { stack, addon, api } = buildHarness(DynamicClientRegistrationMode.ENABLED);
    addon.addRoutes(api);

    const template    = Template.fromStack(stack);
    const conditionId = findGatingConditionLogicalId(template, DynamicClientRegistrationMode.ENABLED);

    const routes = findRegistrationRoutes(template);
    expect(routes).toHaveLength(1);
    expect(routes[0].Condition).toBe(conditionId);

    const dcrFunctionEntries = findDcrFunctionEntries(template);
    expect(dcrFunctionEntries).toHaveLength(1);
    expect(dcrFunctionEntries[0].Condition).toBe(conditionId);

    // The integration of GET /.well-known must not carry the condition; exactly one gated integration proves it.
    const gatedIntegrations = Object.values(template.findResources('AWS::ApiGatewayV2::Integration')).filter(
      (integration) => integration.Condition === conditionId,
    );
    expect(gatedIntegrations).toHaveLength(1);
  });

  it('enabled: the true branch of the discovery document adds exactly one key (registration_endpoint) to the false branch', () => {
    const { stack }                   = buildHarness(DynamicClientRegistrationMode.ENABLED);
    const { trueBranch, falseBranch } = findDiscoveryDocumentFnIfBranches(Template.fromStack(stack));

    const trueText  = renderLiteralText(trueBranch);
    const trueKeys  = extractDocumentKeys(trueText);
    const falseKeys = extractDocumentKeys(renderLiteralText(falseBranch));

    expect(new Set(trueKeys)).toEqual(new Set([...falseKeys, 'registration_endpoint']));
    expect(trueKeys.filter((key) => key !== 'registration_endpoint')).toEqual(falseKeys);
    expect(trueText).toContain(`"registration_endpoint":"${API_BASE_URL}/oauth/register"`);
  });

  // The keys of the throttles must be PascalCase: the map reaches CloudFormation unmapped, and camelCase fails
  // the deploy with `Unrecognized field "throttlingBurstLimit" ... not marked as ignorable`. A test of
  // camelCase keys once let that defect reach a real deploy.
  it('enabled: throttles POST /oauth/register (burst 5, rate 2) behind the same Fn::If, and the discovery route (burst 20, rate 10)', () => {
    const { stack, addon, api } = buildHarness(DynamicClientRegistrationMode.ENABLED);
    addon.addRoutes(api);

    const template    = Template.fromStack(stack);
    const conditionId = findGatingConditionLogicalId(template, DynamicClientRegistrationMode.ENABLED);
    const stages      = Object.values(resourcesOfType(template, 'AWS::ApiGatewayV2::Stage', isStage));
    expect(stages).toHaveLength(1);

    const routeSettings = stages[0].Properties.RouteSettings;
    expect(routeSettings[REGISTRATION_ROUTE_KEY]).toEqual({
      'Fn::If': [conditionId, { ThrottlingBurstLimit: 5, ThrottlingRateLimit: 2 }, { Ref: 'AWS::NoValue' }],
    });
    expect(routeSettings['GET /.well-known/openid-configuration']).toEqual({
      ThrottlingBurstLimit: 20,
      ThrottlingRateLimit:  10,
    });
  });

  // API Gateway rejects a RouteSettings entry whose route does not exist yet, and CloudFormation updates the Stage
  // before creating the Route unless it depends on it: "Unable to find Route by key POST /oauth/register within
  // the provided RouteSettings" failed a real deploy.
  it('enabled: the stage depends on every route it has settings for', () => {
    const { stack, addon, api } = buildHarness(DynamicClientRegistrationMode.ENABLED);
    addon.addRoutes(api);

    const template            = Template.fromStack(stack);
    const [stage]             = Object.values(resourcesOfType(template, 'AWS::ApiGatewayV2::Stage', isStage));
    const routeLogicalIdByKey = new Map<string, string>();
    for (const [logicalId, route] of Object.entries(resourcesOfType(template, 'AWS::ApiGatewayV2::Route', isRoute))) {
      routeLogicalIdByKey.set(route.Properties.RouteKey, logicalId);
    }

    for (const routeKey of Object.keys(stage.Properties.RouteSettings)) {
      const logicalId = routeLogicalIdByKey.get(routeKey);
      expect(logicalId).toBeDefined();
      expect(stage.DependsOn ?? []).toContain(logicalId);
    }
  });

  it('disabled literal: DCR is fully off at synth, with no Lambda, no route, no CfnCondition and a plain discovery body', () => {
    assertDcrFullyDisabled(buildHarness(DynamicClientRegistrationMode.DISABLED));
  });

  it('the discovery document advertises exactly the scopes the registration runtime supports', () => {
    const { stack, addon, api } = buildHarness(DynamicClientRegistrationMode.DISABLED);
    addon.addRoutes(api);

    const documentText            = renderLiteralText(findDiscoveryDocumentBody(Template.fromStack(stack)));
    const scopesMatch             = /"scopes_supported":(\[[^\]]*\])/.exec(documentText);
    const advertisedList: unknown = scopesMatch ? JSON.parse(scopesMatch[1]) : undefined;

    expect(advertisedList).toEqual([...SUPPORTED_SCOPES]);
  });

  it('omitted dynamicClientRegistration: defaults to fully disabled, like the disabled literal', () => {
    assertDcrFullyDisabled(buildHarness());
  });

  it('a CFN-parameter token behaves like enabled, with the condition created and the resources gated, and does not throw', () => {
    let parameter: cdk.CfnParameter | undefined;
    const harness = buildHarness((stack) => {
      parameter = new cdk.CfnParameter(stack, 'DcrModeParam', { type: 'String', default: 'enabled' });
      return parameter.valueAsString as DynamicClientRegistrationMode;
    });
    if (parameter === undefined) {
      throw new Error('the parameter was not created');
    }

    const { stack, addon, api } = harness;
    addon.addRoutes(api);

    const template    = Template.fromStack(stack);
    const conditionId = findGatingConditionLogicalId(template, { Ref: stack.getLogicalId(parameter) });

    const dcrFunctionEntries = findDcrFunctionEntries(template);
    expect(dcrFunctionEntries).toHaveLength(1);
    expect(dcrFunctionEntries[0].Condition).toBe(conditionId);
    expect(findRegistrationRoutes(template)[0].Condition).toBe(conditionId);
  });

  it("an invalid value ('true') cast through the enum throws at synth with a clear message", () => {
    expect(() => buildHarness('true' as DynamicClientRegistrationMode)).toThrow(/dynamicClientRegistration must be 'enabled' or 'disabled'/);
  });

  it('adding routes to an HTTP API without a default stage throws, naming the missing stage', () => {
    const { stack, addon } = buildHarness(DynamicClientRegistrationMode.ENABLED);

    expect(() => addon.addRoutes(new HttpApi(stack, 'api-without-stage', { createDefaultStage: false }))).toThrow(/no default stage/);
  });
});
