/**
 * Thin Gmail API client. Tokens never logged.
 */

export type GmailSendInput = {
  accessToken: string;
  from: string;
  to: string;
  subject: string;
  bodyText: string;
  threadId?: string;
};

export type GmailSendResult =
  | { status: "SENT"; messageId: string; threadId: string }
  | { status: "AMBIGUOUS"; error: string }
  | { status: "FAILED"; error: string };

function toBase64Url(raw: string): string {
  return Buffer.from(raw, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function buildRawMime(input: {
  from: string;
  to: string;
  subject: string;
  bodyText: string;
}): string {
  const lines = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    input.bodyText,
  ];
  return toBase64Url(lines.join("\r\n"));
}

export async function gmailSend(
  input: GmailSendInput,
): Promise<GmailSendResult> {
  try {
    const raw = buildRawMime(input);
    const res = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          raw,
          ...(input.threadId ? { threadId: input.threadId } : {}),
        }),
      },
    );

    if (res.status >= 500 || res.status === 429) {
      return {
        status: "AMBIGUOUS",
        error: `Gmail API transient HTTP ${res.status}`,
      };
    }
    if (!res.ok) {
      return { status: "FAILED", error: `Gmail API HTTP ${res.status}` };
    }
    const data = (await res.json()) as { id?: string; threadId?: string };
    if (!data.id || !data.threadId) {
      return {
        status: "AMBIGUOUS",
        error: "Gmail response missing message/thread id",
      };
    }
    return { status: "SENT", messageId: data.id, threadId: data.threadId };
  } catch (e) {
    return {
      status: "AMBIGUOUS",
      error: e instanceof Error ? e.message : "Unknown send error",
    };
  }
}

/** Check Sent mailbox for an idempotency/subject marker before retry. */
export async function findSentByQuery(input: {
  accessToken: string;
  query: string;
}): Promise<Array<{ id: string; threadId: string }>> {
  const url = new URL(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages",
  );
  url.searchParams.set("q", `in:sent ${input.query}`);
  url.searchParams.set("maxResults", "5");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${input.accessToken}` },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    messages?: Array<{ id: string; threadId: string }>;
  };
  return data.messages ?? [];
}

export async function ensureBiddifyLabels(accessToken: string): Promise<{
  created: string[];
  existing: string[];
}> {
  const wanted = [
    "Biddify",
    "Biddify/Sourcing",
    "Biddify/Quote Received",
    "Biddify/Needs Review",
    "Biddify/Completed",
  ];
  const listRes = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/labels",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!listRes.ok) return { created: [], existing: [] };
  const list = (await listRes.json()) as {
    labels?: Array<{ id: string; name: string }>;
  };
  const existingNames = new Set((list.labels ?? []).map((l) => l.name));
  const created: string[] = [];
  const existing: string[] = [];
  for (const name of wanted) {
    if (existingNames.has(name)) {
      existing.push(name);
      continue;
    }
    const createRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/labels",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          labelListVisibility: "labelShow",
          messageListVisibility: "show",
        }),
      },
    );
    if (createRes.ok) created.push(name);
  }
  return { created, existing };
}
