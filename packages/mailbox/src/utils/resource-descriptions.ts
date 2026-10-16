import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as events from 'aws-cdk-lib/aws-events';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { IConstruct } from 'constructs';
import { ServerlessInboxTagKeys } from '@serverlessinbox/mailbox-cdk-shared';

/** AWS tag-value maximum length. */
const MAX_TAG_VALUE_LENGTH = 256;

/**
 * Maps the construct-tree group name (segment immediately under Mailbox) to the
 * serverless-inbox:component value used in the fallback description text.
 */
const GROUP_TO_COMPONENT: Record<string, string> = {
  data:   'data',
  auth:   'auth',
  edge:   'edge',
  ui:     'ui',
  email:  'email',
  apis:   'api',
  search: 'search',
  ops:    'ops',
};

/**
 * One sentence per component, keyed by the construct id (the path segment after the group).
 * Propagated to every resource in that component's subtree; the resource's structural role
 * is appended for the description tag. Draft copy — do not rewrite (owner refines later).
 */
const COMPONENT_DESCRIPTIONS: Record<string, string> = {
  'data-deployer': 'Provisions and retains the data tier (DynamoDB tables + S3 blob store) as a separate stack so mailbox data survives app-stack replacement.',
  'auth-key-store': 'Stores OIDC signing keys (JWKS) in DynamoDB for the Lambda@Edge authorizer to validate JWTs at the CDN edge.',
  'bootstrap': 'Runs one-time deploy-time setup: SES identity/receipt config, OIDC/OAuth client registration, and config/DNS seeding.',
  'stack-deployer': 'Deploys the us-east-1 edge stack (Lambda@Edge / CloudFront Functions) needed for CDN auth and routing.',
  'blob-cdn': 'CloudFront CDN serving authenticated blob and attachment downloads, authorized at the edge.',
  'regional-api-certificate': 'Regional ACM certificate covering the api, jmap, ws and mcp endpoints.',
  'cert-waiter-lambda': 'On stack deletion, waits until the regional certificate is no longer in use before removal, avoiding CloudFormation delete failures.',
  'regional-cert-waiter': 'Custom resource that blocks certificate deletion until ACM reports it unused.',
  'dns': 'Route 53 records mapping the admin, webmail, api, jmap, ws and cdn subdomains to their endpoints.',
  'admin-ui': 'Admin web console — S3-hosted static site behind CloudFront with an OAuth token-exchange backend (BFF).',
  'webmail-ui': 'Webmail client — S3-hosted static site behind CloudFront with an OAuth token-exchange backend (BFF).',
  'email-processor-lambda': 'Inbound email processing — parses MIME, stores raw content to S3, and indexes messages into the mailbox.',
  'ses-rules': 'SES receipt rules that deliver inbound mail to S3 and enqueue it for processing.',
  'ses-event-processing': 'Handles SES delivery, bounce and complaint notifications and records sender feedback.',
  'email-sending': 'Outbound email submission — queues messages and sends them via SES.',
  'jmap-api': 'JMAP protocol API — the mail client endpoint for sync, query and message submission.',
  'admin-api': 'Administrative API for managing domains, users, configuration and audit.',
  'mcp-api': 'Model Context Protocol (MCP) endpoint exposing mailbox tools to AI clients.',
  'websocket-push': 'WebSocket push service delivering real-time JMAP state changes to connected clients.',
  'tantivy-search': 'Full-text search — Tantivy (Rust) indexer Lambdas maintaining a search index in S3.',
  'stack-helpers': 'Deploy-time helper custom resources (e.g. deriving the domain name from the hosted zone).',
  'audit-writing': 'Audit logging pipeline — buffers audit events via SQS and writes them to the audit DynamoDB table.',
  'license-refresh': 'Periodically refreshes the product license from the license server.',
  'identity-provisioner': 'Provisions new mailbox users — creates their mailbox structure and initial state.',
};

/**
 * Returns the path tail starting from the segment after the given anchor segment.
 * e.g. anchor='Mailbox', path='Stack/Mailbox/apis/jmap-api/handler' → 'apis/jmap-api/handler'
 * Returns the full path if the anchor is not found.
 */
function pathTailAfter(node: IConstruct, anchor: string): string {
  const parts = node.node.path.split('/');
  const idx = parts.indexOf(anchor);
  if (idx === -1 || idx === parts.length - 1) return node.node.path;
  return parts.slice(idx + 1).join('/');
}

/**
 * Returns the fallback component label by reading the group segment (one level under the anchor).
 * e.g. path tail 'apis/jmap-api/handler' → group 'apis' → 'api'
 */
function fallbackComponentFromPath(tail: string): string {
  const group = tail.split('/')[0];
  return GROUP_TO_COMPONENT[group] ?? group;
}

/**
 * Humanizes a CFN resource type into a readable role, e.g. `AWS::Foo::BarBaz` → 'foo bar baz'.
 */
function humanizeCfnType(cfnType: string): string {
  const parts = cfnType.split('::');
  const service = parts.length >= 2 ? parts[parts.length - 2] : '';
  const resource = parts[parts.length - 1] ?? cfnType;
  const spaced = resource
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return service ? `${service.toLowerCase()} ${spaced}`.trim() : spaced;
}

/**
 * Derives a structural role from the CFN resource type (and the resource id for DLQ detection).
 */
function structuralRole(cfnType: string, id: string): string {
  // Custom resources: Custom::* or *::CustomResource
  if (cfnType.startsWith('Custom::') || cfnType.endsWith('::CustomResource')) {
    return 'custom resource';
  }
  switch (cfnType) {
    case 'AWS::Lambda::Function':
      return 'Lambda function';
    case 'AWS::IAM::Role':
      return 'execution role';
    case 'AWS::IAM::Policy':
      return 'IAM policy';
    case 'AWS::Logs::LogGroup':
      return 'log group';
    case 'AWS::DynamoDB::Table':
      return 'DynamoDB table';
    case 'AWS::SQS::Queue':
      return id.toLowerCase().includes('dlq') ? 'dead-letter queue' : 'queue';
    case 'AWS::S3::Bucket':
      return 'S3 bucket';
    case 'AWS::CloudFront::Distribution':
      return 'CloudFront distribution';
    case 'AWS::ApiGatewayV2::Api':
      return 'API';
    case 'AWS::ApiGatewayV2::Stage':
      return 'API stage';
    case 'AWS::Events::Rule':
      return 'event/schedule rule';
    case 'AWS::StepFunctions::StateMachine':
      return 'state machine';
    case 'AWS::CertificateManager::Certificate':
      return 'ACM certificate';
    default:
      return humanizeCfnType(cfnType);
  }
}

/**
 * Strips a trailing `/Resource` or `/Default` segment from a path tail (CDK L1 wrapper segments).
 */
function stripDefaultChildSegment(tail: string): string {
  return tail.replace(/\/(Resource|Default)$/, '');
}

/**
 * Sanitizes a string for use as an AWS tag VALUE. Tag values only allow unicode letters, digits,
 * whitespace and the set `_ . : / = + - @`; commas, parentheses, semicolons, apostrophes and
 * em/en dashes are rejected. This is applied ONLY to the description tag value — native
 * Description/Comment fields accept full prose and are left untouched.
 */
function sanitizeTagValue(s: string): string {
  return s
    .replace(/[—–]/g, '-')                       // em/en dash → hyphen
    .replace(/[^\p{L}\p{N}\s_.:/=+@-]/gu, ' ')    // drop anything not in the AWS tag charset
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TAG_VALUE_LENGTH);
}

/**
 * Sanitizes a string for use as a native CFN description/comment field. These allow full prose
 * (commas, parentheses, semicolons, apostrophes) but IAM Role `description` restricts to Latin-1
 * (`[\t\n -~¡-ÿ]*`), so em/en dashes (U+2013/2014) and other out-of-range characters must
 * be normalized/dropped. Kept separate from `sanitizeTagValue`, which strips a stricter charset.
 */
function sanitizeDescription(s: string): string {
  return s
    .replace(/[—–]/g, '-')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\t\n -~¡-ÿ]/g, '')
    .slice(0, MAX_TAG_VALUE_LENGTH);
}

/**
 * CDK Aspect that adds identity metadata to every L1 resource under the Mailbox construct so the
 * stack is self-explanatory in a customer's AWS console.
 *
 * Per visited L1:
 * - `Name` tag = path tail under Mailbox (trailing `/Resource` or `/Default` stripped).
 * - `serverless-inbox:description` tag = `"<component sentence> (<structural role>)"`, clamped to
 *   256 chars — on every taggable resource (universal; shows in the Tags tab for tables/queues/etc).
 * - Native `Description` / `Comment` = the component sentence (no role suffix), only if currently
 *   unset, on lambda.CfnFunction, iam.CfnRole, apigatewayv2.CfnApi, apigatewayv2.CfnStage,
 *   events.CfnRule, and cloudfront.CfnDistribution.
 * - iam.CfnManagedPolicy is intentionally skipped (Description triggers replacement).
 *
 * All tags are written via TagManager.setTag (guarded by isTaggable), never `Tags.of()`, which
 * would spawn a Tag sub-aspect and trip CDK's aspect-ordering / infinite-loop guards.
 */
export interface MailboxResourceDescriptionsOptions {
  /**
   * Component sentence used whenever the COMPONENT_DESCRIPTIONS lookup misses (e.g. sub-stack
   * resources whose ids aren't in the main-stack component map). Defaults to a path-derived string.
   */
  readonly fallbackDescription?: string;
}

export class MailboxResourceDescriptions implements cdk.IAspect {
  private readonly fallbackDescription?: string;

  /**
   * @param anchorId  Construct id that marks each stack's own root in the node path; `pathTailAfter`
   *                  computes the tail relative to it (e.g. 'Mailbox' for the main construct, or the
   *                  stack id for a sub-stack applied at stack scope).
   * @param options   Optional overrides (e.g. `fallbackDescription` for sub-stacks).
   */
  constructor(private readonly anchorId: string, options: MailboxResourceDescriptionsOptions = {}) {
    this.fallbackDescription = options.fallbackDescription;
  }

  public visit(node: IConstruct): void {
    if (!(node instanceof cdk.CfnResource)) return;

    const tail = pathTailAfter(node, this.anchorId);

    // Component id = the path segment after the group (tail = `<group>/<component>/...`).
    const componentId = tail.split('/')[1];
    const componentSentence = (componentId && COMPONENT_DESCRIPTIONS[componentId])
      ?? this.fallbackDescription
      ?? `ServerlessInbox · ${fallbackComponentFromPath(tail)} · ${tail}`;

    const role = structuralRole(node.cfnResourceType, node.node.id);
    // Tag values can't contain parentheses/commas/etc., so use a hyphen delimiter and sanitize
    // (clamps to 256 internally).
    const descriptionTagValue = sanitizeTagValue(`${componentSentence} - ${role}`);
    // Native Description/Comment fields allow rich prose but require Latin-1 (IAM Role), so
    // normalize out-of-range characters (em/en dash → hyphen) while keeping commas/parens.
    const nativeDescription = sanitizeDescription(componentSentence);

    // Name tag (strip CDK wrapper segments, then tag-sanitize — route ids contain `{proxy+}` whose
    // braces are outside the AWS tag charset) + universal description tag — written directly to the
    // resource's TagManager, never via cdk.Tags.of(...) (that spawns a sub-aspect → loop guard).
    if (cdk.TagManager.isTaggable(node)) {
      node.tags.setTag(ServerlessInboxTagKeys.name, sanitizeTagValue(stripDefaultChildSegment(tail)));
      node.tags.setTag(ServerlessInboxTagKeys.description, descriptionTagValue);
    }

    // Native description — the component sentence only, where the field exists and only when unset.
    if (node instanceof lambda.CfnFunction) {
      if (!node.description) {
        node.description = nativeDescription;
      }
    } else if (node instanceof iam.CfnRole) {
      if (!node.description) {
        node.description = nativeDescription;
      }
    } else if (node instanceof apigatewayv2.CfnApi) {
      if (!node.description) {
        node.description = nativeDescription;
      }
    } else if (node instanceof apigatewayv2.CfnStage) {
      if (!node.description) {
        node.description = nativeDescription;
      }
    } else if (node instanceof events.CfnRule) {
      if (!node.description) {
        node.description = nativeDescription;
      }
    } else if (node instanceof cloudfront.CfnDistribution) {
      // CfnDistribution uses DistributionConfig.Comment for the description field.
      // distributionConfig may be IResolvable at synth time, so use addPropertyOverride
      // to set the Comment only when it hasn't already been set via L2 props.
      const cfgProp = node.distributionConfig;
      const existingComment = cdk.Token.isUnresolved(cfgProp)
        ? undefined
        : (cfgProp as cloudfront.CfnDistribution.DistributionConfigProperty).comment;
      if (!existingComment) {
        node.addPropertyOverride('DistributionConfig.Comment', nativeDescription);
      }
    }
    // iam.CfnManagedPolicy is intentionally excluded: setting Description forces replacement.
  }
}
