/**
 * Pins how a synthesized template value is rendered for assertions: tests compare ARN patterns
 * through this string, so a join that drops its separator or a token that is not marked would let a
 * wrongly scoped resource pass an equality check.
 */

import { renderLiteralText, renderWithRefs, renderWithTokens } from '../render-with-tokens';

describe('renderLiteralText', () => {
  it('returns a plain string as it is', () => {
    expect(renderLiteralText('{"StartAt":"Wait"}')).toBe('{"StartAt":"Wait"}');
  });

  it('concatenates only the literal parts of an Fn::Join, without its separator', () => {
    const value = { 'Fn::Join': ['-', ['{"Arn":"', { Ref: 'AWS::StackId' }, '"}']] };

    expect(renderLiteralText(value)).toBe('{"Arn":""}');
  });

  it('drops a join nested inside a join', () => {
    expect(renderLiteralText({ 'Fn::Join': ['', ['a', { 'Fn::Join': ['', ['b']] }, 'c']] })).toBe('ac');
  });

  it('returns an empty string for an intrinsic function that is not a join', () => {
    expect(renderLiteralText({ Ref: 'AWS::StackId' })).toBe('');
  });
});

describe('renderWithTokens', () => {
  it('returns a plain string as it is', () => {
    expect(renderWithTokens('arn:aws:s3:::bucket/*')).toBe('arn:aws:s3:::bucket/*');
  });

  it('joins the parts of an Fn::Join with its separator', () => {
    expect(renderWithTokens({ 'Fn::Join': ['-', ['arn', 'aws', 'stack']] })).toBe('arn-aws-stack');
  });

  it('renders an intrinsic function inside a join as <token>', () => {
    const value = { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':s3:::', { 'Fn::GetAtt': ['Bucket', 'Arn'] }]] };

    expect(renderWithTokens(value)).toBe('arn:<token>:s3:::<token>');
  });

  it('flattens a join nested inside a join', () => {
    const value = { 'Fn::Join': ['/', ['stack', { 'Fn::Join': [':', ['a', { Ref: 'X' }, 'b']] }]] };

    expect(renderWithTokens(value)).toBe('stack/a:<token>:b');
  });

  it('renders an intrinsic function that is not a join as <token>', () => {
    expect(renderWithTokens({ Ref: 'AWS::StackId' })).toBe('<token>');
  });
});

describe('renderWithRefs', () => {
  it('keeps a Ref inside an Fn::Join as its JSON between the literal parts', () => {
    const value = { 'Fn::Join': ['', ['{"Name":"', { Ref: 'AWS::StackName' }, '-jobs"}']] };

    expect(renderWithRefs(value)).toBe('{"Name":"{"Ref":"AWS::StackName"}-jobs"}');
  });

  it('renders a lone Ref that is not inside a join as its JSON', () => {
    expect(renderWithRefs({ Ref: 'AWS::StackName' })).toBe('{"Ref":"AWS::StackName"}');
  });
});
