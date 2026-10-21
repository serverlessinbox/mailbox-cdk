import type { IConstruct } from 'constructs';

/**
 * The sentence a construct gives for the component it is. A resource is described by the nearest
 * described construct above it (or itself). The sentence is stored on the construct object under a
 * global symbol, so every bundled copy of this module reads the same value, and nothing is added to
 * the construct tree, the cloud assembly or the template.
 */
export class ComponentDescription {
  private static readonly sentenceKey = Symbol.for('@serverlessinbox/component-description');

  /** Records the sentence for the component `construct` is. */
  public static describe(construct: IConstruct, sentence: string): void {
    Object.defineProperty(construct, ComponentDescription.sentenceKey, {
      value:        sentence,
      enumerable:   false,
      configurable: true,
    });
  }

  /** Returns the sentence of the nearest described construct, starting at `construct` itself and walking up. */
  public static nearest(construct: IConstruct): string | undefined {
    const scopesFromRoot = construct.node.scopes;
    for (let index = scopesFromRoot.length - 1; index >= 0; index--) {
      const sentence = ComponentDescription.sentenceOf(scopesFromRoot[index]);
      if (sentence !== undefined) {
        return sentence;
      }
    }
    return undefined;
  }

  private static sentenceOf(construct: IConstruct): string | undefined {
    const sentence: unknown = Reflect.get(construct, ComponentDescription.sentenceKey);
    return typeof sentence === 'string' ? sentence : undefined;
  }
}
