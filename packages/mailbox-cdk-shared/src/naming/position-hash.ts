import { Stack } from 'aws-cdk-lib';
import type { IConstruct } from 'constructs';
import { createHash } from 'node:crypto';

/**
 * A short hash of where a construct sits in its stack's tree. Physical names built from it change
 * when the construct moves to another parent, so the replacement and the retained original of a
 * moved resource never share a name.
 *
 * The hash covers the path relative to the stack, so it is the same for the same position in two
 * stacks and is computed at synth, never from token text. It does not tell two installs apart; that
 * is `StackIdentity`.
 */
export class PositionHash {
  /** The first 8 hex characters of the sha256 of the construct's path relative to its stack. */
  static of(construct: IConstruct): string {
    return PositionHash.hashOfPath(PositionHash.pathRelativeToStack(construct));
  }

  /**
   * The hash of a child that is not constructed yet: the same value `of` returns for a construct
   * created as `new X(parent, id)`. For a name that has to be known before the base class constructor runs.
   */
  static ofChild(parent: IConstruct, id: string): string {
    const parentPath = PositionHash.pathRelativeToStack(parent);
    return PositionHash.hashOfPath(parentPath === '' ? id : `${parentPath}/${id}`);
  }

  private static pathRelativeToStack(construct: IConstruct): string {
    const stackPath = Stack.of(construct).node.path;
    if (construct.node.path === stackPath) {
      return '';
    }
    return construct.node.path.slice(stackPath.length + 1);
  }

  private static hashOfPath(relativePath: string): string {
    return createHash('sha256').update(relativePath).digest('hex').slice(0, 8);
  }
}
