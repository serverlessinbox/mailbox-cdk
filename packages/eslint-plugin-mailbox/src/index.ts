import { align }      from './rules/align';
import { planLabels } from './rules/plan-labels';

const plugin = {
  meta:    {
    name:    '@serverlessinbox/eslint-plugin-mailbox',
    version: '0.0.0',
  },
  rules:   {
    align,
    'plan-labels': planLabels,
  },
  configs: {},
};

export = plugin;
