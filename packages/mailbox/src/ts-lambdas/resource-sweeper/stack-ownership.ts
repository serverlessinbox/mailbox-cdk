import type { LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

/** One key/value tag as the ACM, EventBridge and IAM tag listings return it. */
export interface TagEntry {
  readonly Key?: string;
  readonly Value?: string;
}

/**
 * Decides whether a resource carries a given root-stack tag: every other owner, or no owner tag at
 * all, is a mismatch.
 */
export class StackOwnership {
  private static readonly OWNER_TAG_KEY = 'serverless-inbox:root-stack';

  constructor(private readonly logger: LoggerBuffer) {}

  /**
   * Checks a resource whose tags are a list of key/value entries against `rootStackName`. Returns
   * undefined when that stack owns it; otherwise logs a warning labelled `resourceLabel` and returns
   * the mismatch reason.
   */
  public mismatchInTagList(
    rootStackName: string,
    resourceLabel: string,
    tags: readonly TagEntry[] | undefined,
  ): string | undefined {
    const owner = (tags ?? []).find((tag) => tag.Key === StackOwnership.OWNER_TAG_KEY)?.Value;
    return this.mismatchReason(rootStackName, resourceLabel, owner);
  }

  /**
   * Checks a resource whose tags are a key-to-value map against `rootStackName`. Returns undefined
   * when that stack owns it; otherwise logs a warning labelled `resourceLabel` and returns the
   * mismatch reason.
   */
  public mismatchInTagMap(
    rootStackName: string,
    resourceLabel: string,
    tags: Readonly<Record<string, string>> | undefined,
  ): string | undefined {
    const owner = (tags ?? {})[StackOwnership.OWNER_TAG_KEY];
    return this.mismatchReason(rootStackName, resourceLabel, owner);
  }

  private mismatchReason(rootStackName: string, resourceLabel: string, owner: string | undefined): string | undefined {
    // Only an owner tag naming this root stack is ownership; a foreign owner and a missing tag are the same mismatch.
    if (owner === rootStackName) {
      return undefined;
    }

    this.logger.warn(`${resourceLabel} ownership mismatch`, {
      expectedStack: rootStackName,
      actualStack: owner,
    });
    return `Ownership mismatch (expected ${rootStackName}, got ${owner})`;
  }
}
