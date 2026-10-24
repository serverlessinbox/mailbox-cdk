import { align }              from './align';
import { eventsImport }       from './events-import';
import { iamStatementHome }   from './iam-statement-home';
import { kitIsolation }       from './kit-isolation';
import { logicalIdHome }      from './logical-id-home';
import { planLabels }         from './plan-labels';
import { removalHome }        from './removal-home';
import { resourceKindHome }   from './resource-kind-home';
import { zoneImports }        from './zone-imports';

export const mailboxRules = {
  align,
  'events-import':      eventsImport,
  'iam-statement-home': iamStatementHome,
  'kit-isolation':      kitIsolation,
  'logical-id-home':    logicalIdHome,
  'plan-labels':        planLabels,
  'removal-home':       removalHome,
  'resource-kind-home': resourceKindHome,
  'zone-imports':       zoneImports,
};
