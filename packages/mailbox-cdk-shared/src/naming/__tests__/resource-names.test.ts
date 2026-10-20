import { App, Stack }                     from 'aws-cdk-lib';
import { Construct }                      from 'constructs';

import { PositionHash }                   from '../position-hash';
import { makePhysicalName, slugifyLabel } from '../resource-names';
import { StackIdentity }                  from '../stack-identity';

/**
 * Pins the physical-name scheme `<account>-<stack slug>-<suffix slug>-<position hash>-<guid prefix>`
 * and its length cap. Physical names of deployed resources derive from it, so a changed scheme renames
 * them; dropping the position hash lets a moved resource collide with its retained original, and
 * dropping the guid prefix lets two installs in one account collide.
 */
function newStack(): Stack {
  return new Stack(new App(), 'TestStack', { env: { account: '111122223333', region: 'eu-west-1' } });
}

/** A name made of a literal head and the deploy-time guid prefix, as the stack renders it. */
interface RenderedName {
  readonly head: string;
  readonly guidPrefix: unknown;
}

function render(stack: Stack, name: string): RenderedName {
  // cast: Stack.resolve returns untyped template JSON; this is the one framework boundary.
  const joined             = stack.resolve(name) as { 'Fn::Join': [string, [string, unknown]] };
  const [head, guidPrefix] = joined['Fn::Join'][1];
  return { head, guidPrefix };
}

describe('makePhysicalName', () => {
  it('joins the account, the sanitized stack name, the slugged suffix, the position hash and the guid prefix', () => {
    const stack = newStack();

    const rendered = render(stack, makePhysicalName(stack, 'Admin UI'));

    expect(rendered.head).toBe(`111122223333-teststack-admin-ui-${PositionHash.ofChild(stack, 'Admin UI')}-`);
    expect(rendered.guidPrefix).toEqual(stack.resolve(StackIdentity.guidPrefix));
  });

  it('leaves a readable part within maxLength minus the 18 identifier characters unchanged', () => {
    const stack = newStack();

    const rendered = render(stack, makePhysicalName(stack, 'Admin UI', { maxLength: 31 + 18 }));

    expect(rendered.head).toBe(`111122223333-teststack-admin-ui-${PositionHash.ofChild(stack, 'Admin UI')}-`);
  });

  it('shortens the readable part to maxLength minus 18, ending in a hash of the full readable part', () => {
    const stack = newStack();

    const rendered = render(stack, makePhysicalName(stack, 'a-long-suffix-for-the-name', { maxLength: 30 + 18 }));

    expect(rendered.head).toMatch(/^111122223333-teststac-[0-9a-f]{8}-[0-9a-f]{8}-$/);
  });

  it('keeps the whole name within maxLength once the 8-character guid prefix resolves', () => {
    const stack = newStack();

    const rendered = render(stack, makePhysicalName(stack, 'a-long-suffix-for-the-name', { maxLength: 64 }));

    expect(rendered.head.length + 8).toBeLessThanOrEqual(64);
  });

  it('keeps two long names that share their first characters distinct', () => {
    const stack = newStack();

    const first  = render(stack, makePhysicalName(stack, 'a-long-suffix-one', { maxLength: 48 }));
    const second = render(stack, makePhysicalName(stack, 'a-long-suffix-two', { maxLength: 48 }));

    expect(first.head).not.toBe(second.head);
  });

  it('gives the same suffix a different name under a different parent', () => {
    const stack = newStack();

    const underFirst  = render(stack, makePhysicalName(new Construct(stack, 'first'), 'jobs'));
    const underSecond = render(stack, makePhysicalName(new Construct(stack, 'second'), 'jobs'));

    expect(underFirst.head).not.toBe(underSecond.head);
  });
});

describe('slugifyLabel', () => {
  it('turns a label into a lowercase hyphenated slug', () => {
    expect(slugifyLabel('Admin UI')).toBe('admin-ui');
  });

  it('collapses runs of separators and drops edge hyphens', () => {
    expect(slugifyLabel(' -Admin  &  UI- ')).toBe('admin-ui');
  });
});
