import { ServerlessInboxTagKeys, type LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import type { RootStack } from './removal';

/** One key/value tag as the ACM, EventBridge and IAM tag listings return it. */
export interface TagEntry {
  readonly Key?: string;
  readonly Value?: string;
}

/** The root-stack tags a resource carries; either may be absent. */
interface RootStackTags {
  readonly id: string | undefined;
  readonly name: string | undefined;
}

/**
 * Decides whether a resource belongs to a root stack. A resource that carries a `root-stack-id` tag
 * belongs to the stack whose guid it names, whatever its `root-stack` name says. A resource without one
 * belongs to the stack whose name its `root-stack` tag holds. Every other root stack, and a resource with
 * no root-stack tag at all, is a mismatch.
 */
export class RootStackMembership {
  constructor(private readonly logger: LoggerBuffer) {}

  /**
   * Checks a resource whose tags are a list of key/value entries against `rootStack`. Returns
   * undefined when the resource belongs to that stack; otherwise logs a warning labelled `resourceLabel`
   * and returns the mismatch reason.
   */
  public mismatchInTagList(
    rootStack: RootStack,
    resourceLabel: string,
    tags: readonly TagEntry[] | undefined,
  ): string | undefined {
    const valueOf = (key: string): string | undefined => (tags ?? []).find((tag) => tag.Key === key)?.Value;
    return this.mismatchReason(rootStack, resourceLabel, this.rootStackTagsOf(valueOf));
  }

  /**
   * Checks a resource whose tags are a key-to-value map against `rootStack`. Returns undefined
   * when the resource belongs to that stack; otherwise logs a warning labelled `resourceLabel` and returns
   * the mismatch reason.
   */
  public mismatchInTagMap(
    rootStack: RootStack,
    resourceLabel: string,
    tags: Readonly<Record<string, string>> | undefined,
  ): string | undefined {
    const valueOf = (key: string): string | undefined => (tags ?? {})[key];
    return this.mismatchReason(rootStack, resourceLabel, this.rootStackTagsOf(valueOf));
  }

  private rootStackTagsOf(valueOf: (key: string) => string | undefined): RootStackTags {
    return { id: valueOf(ServerlessInboxTagKeys.rootStackId), name: valueOf(ServerlessInboxTagKeys.rootStack) };
  }

  private mismatchReason(rootStack: RootStack, resourceLabel: string, tags: RootStackTags): string | undefined {
    if (this.belongsToRootStack(rootStack, tags)) {
      return undefined;
    }

    this.logger.warn(`${resourceLabel} root stack mismatch`, {
      expectedStackId: rootStack.rootStackId,
      expectedStack: rootStack.rootStackName,
      actualStackId: tags.id,
      actualStack: tags.name,
    });
    return `Root stack mismatch (expected ${rootStack.rootStackName} / ${rootStack.rootStackId}, got ${tags.name} / ${tags.id})`;
  }

  // An id tag decides alone, so a recreated stack of the same name never claims its predecessor's resources.
  // Only a resource that predates the id tag falls back to the name.
  private belongsToRootStack(rootStack: RootStack, tags: RootStackTags): boolean {
    if (tags.id !== undefined) {
      return tags.id === rootStack.rootStackId;
    }
    return tags.name === rootStack.rootStackName;
  }
}
