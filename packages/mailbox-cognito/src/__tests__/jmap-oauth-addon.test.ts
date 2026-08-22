/**
 * CDK Synth Tests — JmapOAuthAddon (Phase 7, jmap-oauth-dcr-poc registration plan)
 *
 * Exercises the real `JmapOAuthAddon` instance returned by
 * `MailboxUserPool.createJmapApiAddons()` — the exact production wiring path used by
 * `mailbox.ts` — rather than hand-constructing the addon, so these tests also cover the
 * `MailboxUserPoolProps.enableDynamicClientRegistration` threading.
 *
 * Covers:
 *  1. Registration enabled -> POST /oauth/register route exists, no authorizer.
 *  2. Registration disabled -> zero registration resources (route + DCR Lambda both absent).
 *  3. Discovery document content: registration_endpoint absent when registration is off,
 *     present and correct when registration is on.
 *  4. Per-route throttle settings (burst 5 / rate 2) on the stage.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { HttpApi } from 'aws-cdk-lib/aws-apigatewayv2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { PinnedResolver } from '@serverlessinbox/mailbox-cdk-shared';
import { MailboxUserPool } from '../auth/mailbox-user-pool';
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

/** Builds a stack with a real MailboxUserPool + the real JmapOAuthAddon it produces via
 *  createJmapApiAddons() — the same call mailbox.ts makes. Discovery is always enabled here
 *  (required for the addon to be constructed at all); the `enableDynamicClientRegistration`
 *  flag is the thing under test. */
function buildHarness(enableDynamicClientRegistration: boolean): Harness {
  const app = new App();
  setUpArtifactContext(app);
  const stack = new cdk.Stack(app, 'TestJmapOAuthAddonStack', {
    env: { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });

  const resolver = PinnedResolver.loadFromArtifactMetadata(stack);
  resolver.registerPackages(['mailbox-cognito', 'mailbox-cdk', 'mailbox']);

  const pool = new MailboxUserPool(stack, 'user-pool', {
    domain: { kind: 'cognito', cognitoDomainPrefix: 'test-oauth' },
    artifactResolver: resolver,
    enableJmapOAuthDiscovery: true,
    enableDynamicClientRegistration,
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

/** The openid-configuration document is written via StaticContentDeployer as a `Custom::ContentDeployment`
 *  resource whose `Properties.sources[0].body` is the JSON.stringify'd document. Some document fields
 *  (issuer, authorization_endpoint, token_endpoint, userinfo_endpoint) embed CDK tokens (region,
 *  userPoolId), so the resolved `body` is a CloudFormation `Fn::Join` rather than a plain string. This
 *  flattens it back to searchable text by concatenating only the literal string fragments — sufficient
 *  because `registration_endpoint`'s value (apiBaseUrl + literal path, both token-free in this test) is
 *  never split across a token boundary. */
function findDiscoveryDocumentBody(template: Template): string {
  const resources = template.findResources('Custom::ContentDeployment');
  for (const resource of Object.values(resources)) {
    const sources = (resource as any).Properties?.sources as Array<Record<string, unknown>> | undefined;
    const match = sources?.find((s) => s.key === '.well-known/openid-configuration');
    if (match) {
      return flattenToSearchableText(match.body);
    }
  }
  throw new Error('openid-configuration Custom::ContentDeployment resource not found in template');
}

function flattenToSearchableText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'Fn::Join' in (value as Record<string, unknown>)) {
    const [, parts] = (value as { 'Fn::Join': [string, unknown[]] })['Fn::Join'];
    return parts.map((p) => (typeof p === 'string' ? p : '')).join('');
  }
  return '';
}

describe('JmapOAuthAddon — Phase 7 (DCR route, registration_endpoint, throttling)', () => {
  it('registration enabled: POST /oauth/register route exists with no authorizer', () => {
    const { stack, addon, api } = buildHarness(true);
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

  it('registration disabled: zero registration resources (no route, no DCR Lambda)', () => {
    const { stack, addon, api } = buildHarness(false);
    addon.addRoutes(api);

    const template = Template.fromStack(stack);

    const routes = template.findResources('AWS::ApiGatewayV2::Route', {
      Properties: Match.objectLike({ RouteKey: REGISTRATION_ROUTE_KEY }),
    });
    expect(Object.keys(routes)).toHaveLength(0);

    // The DCR Lambda (JmapOAuthDcrLambda) is the only function in this stack whose
    // environment carries IDENTITY_PROVISIONER_FUNCTION_NAME — a reliable, non-token
    // discriminator (functionName/description both embed unresolved CDK tokens).
    const dcrFunctions = template.findResources('AWS::Lambda::Function', {
      Properties: Match.objectLike({
        Environment: Match.objectLike({
          Variables: Match.objectLike({ IDENTITY_PROVISIONER_FUNCTION_NAME: Match.anyValue() }),
        }),
      }),
    });
    expect(Object.keys(dcrFunctions)).toHaveLength(0);
  });

  describe('discovery document — registration_endpoint', () => {
    it('is absent when discovery is enabled but registration is disabled', () => {
      const { stack } = buildHarness(false);
      const body = findDiscoveryDocumentBody(Template.fromStack(stack));
      expect(body).not.toContain('registration_endpoint');
    });

    it('is present and equals apiBaseUrl + /oauth/register when registration is enabled', () => {
      const { stack } = buildHarness(true);
      const body = findDiscoveryDocumentBody(Template.fromStack(stack));
      expect(body).toContain(`"registration_endpoint":"${API_BASE_URL}/oauth/register"`);
    });
  });

  it('carries the per-route throttle (burst 5 / rate 2) on POST /oauth/register', () => {
    const { stack, addon, api } = buildHarness(true);
    addon.addRoutes(api);

    const template = Template.fromStack(stack);
    const stages = template.findResources('AWS::ApiGatewayV2::Stage', {
      Properties: Match.objectLike({
        RouteSettings: Match.objectLike({
          [REGISTRATION_ROUTE_KEY]: Match.objectLike({
            throttlingBurstLimit: 5,
            throttlingRateLimit: 2,
          }),
        }),
      }),
    });
    expect(Object.keys(stages)).toHaveLength(1);
  });
});
