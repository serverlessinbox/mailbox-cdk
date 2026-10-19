import { Aws, Fn } from 'aws-cdk-lib';
import { CfnGroup } from 'aws-cdk-lib/aws-resourcegroups';
import { Construct } from 'constructs';
import { ServerlessInboxTagKeys } from './serverless-inbox-tags';

/** Options for `addServerlessInboxResourceGroup`. */
export interface ServerlessInboxResourceGroupProps {
  /**
   * Value the group's tag-filter matches on `serverless-inbox:root-stack`. All resources tagged
   * with this root-stack value (in this region) are collected into the group. Defaults to
   * `Aws.STACK_NAME` (the stack this group is created in is its own root).
   */
  readonly rootStackValue?: string;

  /**
   * Group name. Defaults to `${AWS::StackName}-serverless-inbox`. AWS Resource Group names allow
   * letters, digits, hyphens, underscores and periods — stack names already satisfy this.
   */
  readonly groupName?: string;
}

/**
 * Creates a per-region AWS Resource Group that collects every resource carrying the
 * `serverless-inbox:root-stack = <rootStackValue>` tag, giving customers a single console view of
 * all of a deployment's resources in that region.
 *
 * Uses a `TAG_FILTERS_1_0` query over `AWS::AllSupported`.
 */
export function addServerlessInboxResourceGroup(
  scope: Construct,
  id: string,
  props: ServerlessInboxResourceGroupProps = {},
): CfnGroup {
  const rootStackValue = props.rootStackValue ?? Aws.STACK_NAME;
  const groupName = props.groupName ?? Fn.join('', [Aws.STACK_NAME, '-serverless-inbox']);

  return new CfnGroup(scope, id, {
    name: groupName,
    // AWS::ResourceGroups::Group description charset is strict: [\sa-zA-Z0-9_.-]* only.
    // No parentheses, no em/en dash, no ':' or '/'. Keep this literal within that set.
    description: 'ServerlessInbox - all resources for this deployment matched by the root-stack tag.',
    resourceQuery: {
      type: 'TAG_FILTERS_1_0',
      query: {
        resourceTypeFilters: ['AWS::AllSupported'],
        tagFilters: [
          {
            key: ServerlessInboxTagKeys.rootStack,
            values: [rootStackValue],
          },
        ],
      },
    },
  });
}
