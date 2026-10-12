export const GMAIL_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.labels",
] as const;

export const GMAIL_SCOPE_STRING = GMAIL_OAUTH_SCOPES.join(" ");
