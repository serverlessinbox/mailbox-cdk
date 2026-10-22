import { SsmActions } from '../ssm-actions';

describe('SsmActions', () => {
  it('reads a parameter through the single-parameter GetParameter API and nothing broader', () => {
    expect(SsmActions.read).toEqual(['ssm:GetParameter']);
  });
});
