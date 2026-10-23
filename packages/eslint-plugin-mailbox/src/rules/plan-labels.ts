import { createRule } from './create-rule';

const planLabelPattern = /\bsubplan\b|\bPhase [A-Z0-9]\b|\bplan-[a-e]\b|\.claude\/|\bmoved (to|from)\b|\bpreviously\b|\bno longer\b/i;

export const planLabels = createRule({
  name:           'plan-labels',
  meta:           {
    type:     'problem',
    docs:     {
      description: 'disallow plan labels and change narration in comments',
    },
    schema:   [],
    messages: {
      planLabel: 'Found plan label or change narration in comment: "{{text}}"',
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      Program() {
        context.sourceCode.getAllComments().forEach((comment) => {
          if (planLabelPattern.test(comment.value)) {
            context.report({ loc: comment.loc, messageId: 'planLabel', data: { text: comment.value.trim() } });
          }
        });
      },
    };
  },
});
