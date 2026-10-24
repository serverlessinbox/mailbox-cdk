import { App, Stack }                     from 'aws-cdk-lib';
import { Construct }                      from 'constructs';

import { PositionHash }                   from '../position-hash';
import { makePhysicalName, slugifyLabel } from '../resource-names';
import { MAX_ROOT_STACK_NAME_LENGTH }     from '../root-stack-name-limit';
import { StackIdentity }                  from '../stack-identity';

/**
 * Pins the physical-name scheme `<root stack name>-<suffix slug>-<position hash>-<guid prefix>`. The root
 * stack name is a deploy-time reference, so the name never carries a synth-time stack or account value.
 * Physical names of deployed resources derive from it, so a changed scheme renames them; dropping the
 * position hash lets a moved resource collide with its retained original, and dropping the guid prefix
 * lets two installs in one account collide.
 */
function newStack(): Stack {
  return new Stack(new App(), 'TestStack', { env: { account: '111122223333', region: 'eu-west-1' } });
}

function renderedNameOf(stack: Stack, name: string): string {
  return JSON.stringify(stack.resolve(name));
}

describe('makePhysicalName', () => {
  it('takes the root stack name from a deploy-time reference, never the synth-time stack name or account', () => {
    const stack = newStack();

    const rendered = renderedNameOf(stack, makePhysicalName(stack, 'Admin UI'));

    expect(rendered).toContain('{"Ref":"AWS::StackName"}');
    expect(rendered).not.toContain('TestStack');
    expect(rendered).not.toContain('111122223333');
  });

  it('joins the slugged suffix, the position hash and the guid prefix after the stack name reference', () => {
    const stack = newStack();

    const rendered = renderedNameOf(stack, makePhysicalName(stack, 'Admin UI'));

    expect(rendered).toContain(`-admin-ui-${PositionHash.ofChild(stack, 'Admin UI')}-`);
    expect(rendered).toContain(JSON.stringify(stack.resolve(StackIdentity.guidPrefix)));
  });

  it('gives the same suffix a different name under a different parent', () => {
    const stack = newStack();

    const underFirst  = renderedNameOf(stack, makePhysicalName(new Construct(stack, 'first'), 'jobs'));
    const underSecond = renderedNameOf(stack, makePhysicalName(new Construct(stack, 'second'), 'jobs'));

    expect(underFirst).not.toBe(underSecond);
  });

  it('accepts a label that fits maxLength at the longest root stack name', () => {
    const stack      = newStack();
    const labelLimit = 80 - 19 - MAX_ROOT_STACK_NAME_LENGTH;

    expect(() => makePhysicalName(stack, 'a'.repeat(labelLimit), { maxLength: 80 })).not.toThrow();
  });

  it('throws naming the label, the bound and the arithmetic when a label is one character too long', () => {
    const stack      = newStack();
    const labelLimit = 80 - 19 - MAX_ROOT_STACK_NAME_LENGTH;

    expect(() => makePhysicalName(stack, 'a'.repeat(labelLimit + 1), { maxLength: 80 }))
      .toThrow(`is ${labelLimit + 1} label characters + 19 separator and identifier characters + ${MAX_ROOT_STACK_NAME_LENGTH} root stack name characters = 81 at most, above the limit of 80`);
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
