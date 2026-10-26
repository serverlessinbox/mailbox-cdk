import { StackStatus } from '../stack-status';

/**
 * Pins how the worker classifies a CloudFormation stack status. A status filed on the wrong side sends the
 * deployment the wrong way: a rollback read as success answers CloudFormation that a failed stack deployed,
 * and a delete read as a deploy outcome answers a Delete wrongly.
 */
describe('StackStatus', () => {
  describe('isTerminalSuccess', () => {
    it.each(['CREATE_COMPLETE', 'UPDATE_COMPLETE', 'UPDATE_COMPLETE_CLEANUP_IN_PROGRESS'] as const)('is true for %s', (status) => {
      expect(new StackStatus(status).isTerminalSuccess()).toBe(true);
    });

    it.each(['DELETE_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS', 'ROLLBACK_COMPLETE', 'DELETE_IN_PROGRESS', 'DELETE_FAILED', 'CREATE_IN_PROGRESS', undefined] as const)(
      'is false for %s',
      (status) => {
        expect(new StackStatus(status).isTerminalSuccess()).toBe(false);
      },
    );
  });

  describe('isDeploymentFailed', () => {
    it.each(['CREATE_FAILED', 'UPDATE_FAILED', 'UPDATE_ROLLBACK_COMPLETE', 'DELETE_FAILED', 'ROLLBACK_IN_PROGRESS', 'UPDATE_ROLLBACK_IN_PROGRESS', 'UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS'] as const)(
      'is true for %s',
      (status) => {
        expect(new StackStatus(status).isDeploymentFailed()).toBe(true);
      },
    );

    it.each(['CREATE_IN_PROGRESS', 'DELETE_IN_PROGRESS', 'CREATE_COMPLETE', undefined] as const)('is false for %s', (status) => {
      expect(new StackStatus(status).isDeploymentFailed()).toBe(false);
    });
  });

  describe('requiresRecreate', () => {
    it.each(['ROLLBACK_FAILED', 'ROLLBACK_COMPLETE'] as const)('is true for %s', (status) => {
      expect(new StackStatus(status).requiresRecreate()).toBe(true);
    });

    it.each(['ROLLBACK_IN_PROGRESS', 'CREATE_FAILED', 'UPDATE_ROLLBACK_COMPLETE', undefined] as const)('is false for %s', (status) => {
      expect(new StackStatus(status).requiresRecreate()).toBe(false);
    });

    it.each([['ROLLBACK_FAILED', true], ['ROLLBACK_COMPLETE', true], ['CREATE_FAILED', false], [undefined, false]] as const)(
      'answers the same from the static for %s',
      (status, expected) => {
        expect(StackStatus.requiresRecreate(status)).toBe(expected);
      },
    );
  });

  describe('isRollbackInProgress', () => {
    it('is true only for ROLLBACK_IN_PROGRESS', () => {
      expect(new StackStatus('ROLLBACK_IN_PROGRESS').isRollbackInProgress()).toBe(true);
      expect(new StackStatus('UPDATE_ROLLBACK_IN_PROGRESS').isRollbackInProgress()).toBe(false);
    });
  });

  describe('isDeleting', () => {
    it.each(['DELETE_IN_PROGRESS', 'DELETE_COMPLETE', 'DELETE_FAILED'] as const)('is true for %s', (status) => {
      expect(new StackStatus(status).isDeleting()).toBe(true);
    });

    it.each(['CREATE_COMPLETE', 'ROLLBACK_COMPLETE', undefined] as const)('is false for %s', (status) => {
      expect(new StackStatus(status).isDeleting()).toBe(false);
    });
  });

  describe('isDeleteFailed', () => {
    it('is true only for DELETE_FAILED', () => {
      expect(new StackStatus('DELETE_FAILED').isDeleteFailed()).toBe(true);
      expect(new StackStatus('DELETE_IN_PROGRESS').isDeleteFailed()).toBe(false);
    });
  });
});
