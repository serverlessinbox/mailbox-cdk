import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as events from 'aws-cdk-lib/aws-events';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { IConstruct } from 'constructs';

/**
 * Maps the construct-tree group name (segment immediately under Mailbox) to the
 * serverless-inbox:component value used in descriptions.
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
 * Returns the component label by reading the group segment (one level under the anchor).
 * e.g. path tail 'apis/jmap-api/handler' → group 'apis' → 'api'
 */
function componentFromPath(tail: string): string {
  const group = tail.split('/')[0];
  return GROUP_TO_COMPONENT[group] ?? group;
}

/**
 * CDK Aspect that adds a `Name` tag and optional native description to every L1 resource
 * under the Mailbox construct.
 *
 * - Name tag: concise path tail under Mailbox (e.g. `apis/jmap-api/authorizer`).
 * - Native description (only if currently unset): `ServerlessInbox · <component> · <path-tail>`
 *   on lambda.CfnFunction, iam.CfnRole, apigatewayv2.CfnApi, apigatewayv2.CfnStage,
 *   events.CfnRule, and cloudfront.CfnDistribution.
 * - iam.CfnManagedPolicy is intentionally skipped (Description triggers replacement).
 */
export class MailboxResourceDescriptions implements cdk.IAspect {
  constructor(private readonly mailboxId: string) {}

  public visit(node: IConstruct): void {
    if (!(node instanceof cdk.CfnResource)) return;

    const tail = pathTailAfter(node, this.mailboxId);
    const component = componentFromPath(tail);
    const description = `ServerlessInbox · ${component} · ${tail}`;

    // Universal Name tag for console display. Write directly to the resource's TagManager
    // rather than via cdk.Tags.of(...).add(...), which would spawn a fresh Tag sub-aspect on
    // every node each pass and trip CDK's infinite-loop guard during aspect invocation.
    if (cdk.TagManager.isTaggable(node)) {
      node.tags.setTag('Name', tail);
    }

    // Native description — only where the field exists and only when currently unset.
    if (node instanceof lambda.CfnFunction) {
      if (!node.description) {
        node.description = description;
      }
    } else if (node instanceof iam.CfnRole) {
      if (!node.description) {
        node.description = description;
      }
    } else if (node instanceof apigatewayv2.CfnApi) {
      if (!node.description) {
        node.description = description;
      }
    } else if (node instanceof apigatewayv2.CfnStage) {
      if (!node.description) {
        node.description = description;
      }
    } else if (node instanceof events.CfnRule) {
      if (!node.description) {
        node.description = description;
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
        node.addPropertyOverride('DistributionConfig.Comment', description);
      }
    }
    // iam.CfnManagedPolicy is intentionally excluded: setting Description forces replacement.
  }
}
