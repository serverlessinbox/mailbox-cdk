import { App }                              from 'aws-cdk-lib';
import { Construct }                        from 'constructs';

import { ComponentDescription }             from '../component-description';
import type * as ComponentDescriptionModule from '../component-description';

/** Builds a fresh tree root -> outer -> inner -> leaf, so no test sees another test's sentences. */
function chain(): { outer: Construct; inner: Construct; leaf: Construct } {
  const outer = new Construct(new App(), 'outer');
  const inner = new Construct(outer, 'inner');
  const leaf  = new Construct(inner, 'leaf');
  return { outer, inner, leaf };
}

describe('ComponentDescription', () => {
  it('returns the sentence of the construct itself', () => {
    const { leaf } = chain();
    ComponentDescription.describe(leaf, 'self sentence');

    expect(ComponentDescription.nearest(leaf)).toBe('self sentence');
  });

  it('returns the sentence of a described ancestor for an undescribed descendant', () => {
    const { outer, leaf } = chain();
    ComponentDescription.describe(outer, 'ancestor sentence');

    expect(ComponentDescription.nearest(leaf)).toBe('ancestor sentence');
  });

  it('prefers the nearer of two described ancestors', () => {
    const { outer, inner, leaf } = chain();
    ComponentDescription.describe(outer, 'outer sentence');
    ComponentDescription.describe(inner, 'inner sentence');

    expect(ComponentDescription.nearest(leaf)).toBe('inner sentence');
  });

  it('returns undefined when no construct on the path is described', () => {
    const { leaf } = chain();

    expect(ComponentDescription.nearest(leaf)).toBeUndefined();
  });

  it('is read across independently loaded copies of the module, as bundled copies of the kit are', () => {
    const { leaf } = chain();
    ComponentDescription.describe(leaf, 'sentence from the first copy');

    let secondCopy: typeof ComponentDescription | undefined;
    jest.isolateModules(() => {
      secondCopy = jest.requireActual<typeof ComponentDescriptionModule>('../component-description').ComponentDescription;
    });

    expect(secondCopy).toBeDefined();
    expect(secondCopy).not.toBe(ComponentDescription);
    expect(secondCopy?.nearest(leaf)).toBe('sentence from the first copy');

    secondCopy?.describe(leaf, 'sentence from the second copy');
    expect(ComponentDescription.nearest(leaf)).toBe('sentence from the second copy');
  });
});
