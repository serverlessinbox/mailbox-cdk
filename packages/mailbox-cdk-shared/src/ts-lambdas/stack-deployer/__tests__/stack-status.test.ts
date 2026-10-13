import { StackStatus } from '../stack-status';

/**
 * Pins how the worker classifies a CloudFormation stack status. A status filed on the wrong side sends the
 * deployment the wrong way: a rollback read as success answers CloudFormation that a failed stack deployed,
 * and a delete read as a deploy outcome answers a Delete wrongly.
 */
describe('StackStatus', () => {
  describe('isTerminalSuccess', () => {
    it.each(['CREATE_COMPLETE', 'UPDATE_COMPLETE'])('is true for %s', (status) => {
      expect(new StackStatus(status).isTerminalSuccess()).toBe(true);
    });

    it.each(['DELETE_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE', 'CREATE_ROLLBACK_COMPLETE', 'DELETE_IN_PROGRESS', 'DELETE_FAILED', 'CREATE_IN_PROGRESS', '', undefined])(
      'is false for %s',
      (status) => {
        expect(new StackStatus(status).isTerminalSuccess()).toBe(false);
      },
    );
  });

  describe('isTerminalFailure', () => {
    it.each(['CREATE_FAILED', 'UPDATE_FAILED', 'UPDATE_ROLLBACK_COMPLETE', 'DELETE_FAILED', 'ROLLBACK_IN_PROGRESS'])('is true for %s', (status) => {
      expect(new StackStatus(status).isTerminalFailure()).toBe(true);
    });

    it.each(['CREATE_IN_PROGRESS', 'DELETE_IN_PROGRESS', 'CREATE_COMPLETE', '', undefined])('is false for %s', (status) => {
      expect(new StackStatus(status).isTerminalFailure()).toBe(false);
    });
  });

  describe('requiresRecreate', () => {
    it.each(['ROLLBACK_FAILED', 'ROLLBACK_COMPLETE'])('is true for %s', (status) => {
      expect(new StackStatus(status).requiresRecreate()).toBe(true);
    });

    it.each(['ROLLBACK_IN_PROGRESS', 'CREATE_FAILED', 'UPDATE_ROLLBACK_COMPLETE', '', undefined])('is false for %s', (status) => {
      expect(new StackStatus(status).requiresRecreate()).toBe(false);
    });
  });

  describe('isRollbackInProgress', () => {
    it('is true only for ROLLBACK_IN_PROGRESS', () => {
      expect(new StackStatus('ROLLBACK_IN_PROGRESS').isRollbackInProgress()).toBe(true);
      expect(new StackStatus('UPDATE_ROLLBACK_IN_PROGRESS').isRollbackInProgress()).toBe(false);
    });
  });

  describe('isDeleting', () => {
    it.each(['DELETE_IN_PROGRESS', 'DELETE_COMPLETE', 'DELETE_FAILED'])('is true for %s', (status) => {
      expect(new StackStatus(status).isDeleting()).toBe(true);
    });

    it.each(['CREATE_COMPLETE', 'ROLLBACK_COMPLETE', undefined])('is false for %s', (status) => {
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
