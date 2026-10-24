import { align }              from './align';
import { eventsImport }       from './events-import';
import { kitIsolation }       from './kit-isolation';
import { planLabels }         from './plan-labels';
import { resourceKindHome }   from './resource-kind-home';
import { zoneImports }        from './zone-imports';

export const mailboxRules = {
  align,
  'events-import':      eventsImport,
  'kit-isolation':      kitIsolation,
  'plan-labels':        planLabels,
  'resource-kind-home': resourceKindHome,
  'zone-imports':       zoneImports,
};
