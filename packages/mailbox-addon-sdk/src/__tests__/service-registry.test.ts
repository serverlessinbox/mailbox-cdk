import { ServiceRegistry }   from '../service-registry';
import type { ServiceSpec }  from '../service-spec';

/*
 * Pins how services are found by path. A request path is typed by clients in whatever case and slash style
 * they like; a lookup that misses a registered service answers 404 for a service that exists.
 */

function serviceSpec(basePath: string, serviceName: string): ServiceSpec {
  return { basePath, serviceName, methods: {} };
}

describe('ServiceRegistry', () => {
  describe('get', () => {
    it('finds a service by base path and service name regardless of case', () => {
      const registry = new ServiceRegistry();
      registry.register(serviceSpec('/Idp-Users', 'IdpUsers'));

      expect(registry.get('/idp-users', 'idpusers')?.serviceName).toBe('IdpUsers');
    });

    it('finds a service whatever slashes surround the base path on registration or lookup', () => {
      const registry = new ServiceRegistry();
      registry.register(serviceSpec('idp-users/', 'IdpUsers'));

      expect(registry.get('/idp-users//', 'IdpUsers')).toBeDefined();
      expect(registry.get('idp-users', 'IdpUsers')).toBeDefined();
    });

    it('stores the base path in its normalized form', () => {
      const registry = new ServiceRegistry();
      registry.register(serviceSpec('idp-users/', 'IdpUsers'));

      expect(registry.get('/idp-users', 'IdpUsers')?.basePath).toBe('/idp-users');
    });

    it('answers nothing for an unknown base path or service name', () => {
      const registry = new ServiceRegistry();
      registry.register(serviceSpec('/idp-users', 'IdpUsers'));

      expect(registry.get('/other', 'IdpUsers')).toBeUndefined();
      expect(registry.get('/idp-users', 'Other')).toBeUndefined();
    });

    it('keeps several services under one base path and lets a later registration replace one of them', () => {
      const registry = new ServiceRegistry();
      const first    = serviceSpec('/api', 'First');
      const second   = serviceSpec('/api', 'Second');
      const replaced = { ...first, methods: { Call: { name: 'Call', validate: (req: unknown) => req, handler: () => Promise.resolve(1) } } };
      registry.register(first);
      registry.register(second);
      registry.register(replaced);

      expect(registry.get('/api', 'Second')).toMatchObject({ serviceName: 'Second' });
      expect(Object.keys(registry.get('/api', 'First')?.methods ?? {})).toEqual(['Call']);
    });
  });

  describe('getDefault', () => {
    it('answers the only service registered under the base path', () => {
      const registry = new ServiceRegistry();
      registry.register(serviceSpec('/idp-users', 'IdpUsers'));

      expect(registry.getDefault('idp-users/')?.serviceName).toBe('IdpUsers');
    });

    it('answers nothing for a base path without services', () => {
      const registry = new ServiceRegistry();

      expect(registry.getDefault('/idp-users')).toBeUndefined();
    });

    it('answers nothing when the base path has several services, as none is the default', () => {
      const registry = new ServiceRegistry();
      registry.register(serviceSpec('/api', 'First'));
      registry.register(serviceSpec('/api', 'Second'));

      expect(registry.getDefault('/api')).toBeUndefined();
    });
  });
});
