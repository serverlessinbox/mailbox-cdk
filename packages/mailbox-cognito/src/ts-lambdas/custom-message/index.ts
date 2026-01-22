type CognitoCustomMessageEvent = {
  triggerSource: string;
  userName?: string;
  request?: {
    codeParameter?: string;
    usernameParameter?: string;
  };
  response: {
    emailSubject?: string;
    emailMessage?: string;
    smsMessage?: string;
  };
};

import {
  DEFAULT_ADMIN_CREATE_USER_MESSAGE,
  DEFAULT_ADMIN_CREATE_USER_SUBJECT,
  DEFAULT_FORGOT_PASSWORD_MESSAGE,
  DEFAULT_FORGOT_PASSWORD_SUBJECT,
} from './messages';

function applyTemplate(template: string, tokens: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => tokens[key] ?? '');
}

function normalizeBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function nl2br(value: string): string {
  return value.replace(/\n/g, '<br/>');
}

export const handler = async (event: CognitoCustomMessageEvent): Promise<CognitoCustomMessageEvent> => {
  const username = event?.request?.usernameParameter ?? event?.userName ?? '';
  const code = event?.request?.codeParameter ?? '';

  const loginUrl = process.env.LOGIN_URL ?? '';
  const supportText = process.env.SUPPORT_TEXT ?? '';

  const escapedLoginUrl = escapeHtml(loginUrl);
  const signInSection = loginUrl
    ? `Sign in: ${escapedLoginUrl}\nOpen: <a href="${escapedLoginUrl}">${escapedLoginUrl}</a>`
    : '';

  const tokens = {
    username: escapeHtml(username),
    code: escapeHtml(code),
    loginUrl: escapedLoginUrl,
    signInSection,
  };

  const appendSupportHtml = (html: string): string => {
    if (!supportText) return html;
    const support = nl2br(escapeHtml(supportText));
    return `${html}<br/><br/>${support}`;
  };

  switch (event.triggerSource) {
    case 'CustomMessage_AdminCreateUser': {
      const subject = DEFAULT_ADMIN_CREATE_USER_SUBJECT;
      const message = DEFAULT_ADMIN_CREATE_USER_MESSAGE;

      event.response.emailSubject = applyTemplate(subject, tokens);

      const rendered = applyTemplate(message, tokens);
      event.response.emailMessage = appendSupportHtml(nl2br(normalizeBlankLines(rendered)));
      break;
    }

    case 'CustomMessage_ForgotPassword': {
      const subject = DEFAULT_FORGOT_PASSWORD_SUBJECT;
      const message = DEFAULT_FORGOT_PASSWORD_MESSAGE;

      event.response.emailSubject = applyTemplate(subject, tokens);
      event.response.emailMessage = appendSupportHtml(nl2br(normalizeBlankLines(applyTemplate(message, tokens))));
      break;
    }

    default:
      break;
  }

  return event;
};
