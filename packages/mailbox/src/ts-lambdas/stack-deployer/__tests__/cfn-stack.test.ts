import { isTerminalSuccess, isTerminalFailure } from '../cfn-stack';

describe('isTerminalSuccess', () => {
  it('returns true for CREATE_COMPLETE', () => {
    expect(isTerminalSuccess('CREATE_COMPLETE')).toBe(true);
  });

  it('returns true for UPDATE_COMPLETE', () => {
    expect(isTerminalSuccess('UPDATE_COMPLETE')).toBe(true);
  });

  it('returns false for DELETE_COMPLETE (not a deploy success)', () => {
    expect(isTerminalSuccess('DELETE_COMPLETE')).toBe(false);
  });

  it('returns false for UPDATE_ROLLBACK_COMPLETE', () => {
    expect(isTerminalSuccess('UPDATE_ROLLBACK_COMPLETE')).toBe(false);
  });

  it('returns false for CREATE_ROLLBACK_COMPLETE', () => {
    expect(isTerminalSuccess('CREATE_ROLLBACK_COMPLETE')).toBe(false);
  });

  it('returns false for DELETE_IN_PROGRESS', () => {
    expect(isTerminalSuccess('DELETE_IN_PROGRESS')).toBe(false);
  });

  it('returns false for DELETE_FAILED', () => {
    expect(isTerminalSuccess('DELETE_FAILED')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isTerminalSuccess(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isTerminalSuccess('')).toBe(false);
  });
});

describe('isTerminalFailure', () => {
  it('returns true for CREATE_FAILED', () => {
    expect(isTerminalFailure('CREATE_FAILED')).toBe(true);
  });

  it('returns true for UPDATE_FAILED', () => {
    expect(isTerminalFailure('UPDATE_FAILED')).toBe(true);
  });

  it('returns true for UPDATE_ROLLBACK_COMPLETE', () => {
    expect(isTerminalFailure('UPDATE_ROLLBACK_COMPLETE')).toBe(true);
  });

  it('returns true for DELETE_FAILED', () => {
    expect(isTerminalFailure('DELETE_FAILED')).toBe(true);
  });

  it('returns false for CREATE_IN_PROGRESS', () => {
    expect(isTerminalFailure('CREATE_IN_PROGRESS')).toBe(false);
  });

  it('returns false for DELETE_IN_PROGRESS', () => {
    expect(isTerminalFailure('DELETE_IN_PROGRESS')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isTerminalFailure(undefined)).toBe(false);
  });
});
