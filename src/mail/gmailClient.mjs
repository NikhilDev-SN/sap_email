import { getGoogleAccessToken } from "../auth/googleOAuth.mjs";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export async function fetchGmailInquiryEmails(config) {
  const accessToken = await getGoogleAccessToken(config);
  const messageRefs = await listMessages(accessToken, config);
  const messages = [];

  for (const messageRef of messageRefs) {
    const message = await getMessage(accessToken, messageRef.id);
    messages.push(toEmail(message));
  }

  return messages;
}

async function listMessages(accessToken, config) {
  const params = new URLSearchParams({
    maxResults: String(config.gmailSyncMaxResults || 10),
    q: config.gmailSyncQuery || "newer_than:30d"
  });

  const response = await fetch(`${GMAIL_API}/messages?${params.toString()}`, {
    headers: authHeaders(accessToken)
  });
  const body = await readJsonResponse(response, "Gmail message list");
  return body.messages || [];
}

async function getMessage(accessToken, messageId) {
  const params = new URLSearchParams({
    format: "full"
  });

  const response = await fetch(`${GMAIL_API}/messages/${encodeURIComponent(messageId)}?${params.toString()}`, {
    headers: authHeaders(accessToken)
  });
  return readJsonResponse(response, "Gmail message read");
}

function toEmail(message) {
  const headers = message.payload?.headers || [];
  const header = (name) =>
    headers.find((item) => normalizeHeaderName(item?.name) === normalizeHeaderName(name))?.value || "";

  return {
    messageId: message.id,
    threadId: message.threadId,
    from: header("From"),
    subject: header("Subject"),
    date: header("Date"),
    body: extractBody(message.payload) || message.snippet || ""
  };
}

function normalizeHeaderName(value) {
  return String(value || "").toLowerCase();
}

function extractBody(part) {
  if (!part) {
    return "";
  }

  if (part.mimeType === "text/plain" && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }

  for (const child of part.parts || []) {
    const body = extractBody(child);
    if (body) {
      return body;
    }
  }

  if (part.mimeType === "text/html" && part.body?.data) {
    return stripHtml(decodeBase64Url(part.body.data));
  }

  return "";
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function stripHtml(value) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function authHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json"
  };
}

async function readJsonResponse(response, label) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label} failed with ${response.status}: ${text}`);
  }

  return text ? JSON.parse(text) : {};
}
