import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fetchGmailInquiryEmails } from "../src/mail/gmailClient.mjs";

test("gmail sync tolerates null header names", async () => {
  const originalFetch = globalThis.fetch;
  const dir = await mkdtemp(join(tmpdir(), "sap-gmail-test-"));
  const tokenPath = join(dir, "token.json");

  await writeFile(
    tokenPath,
    JSON.stringify({
      access_token: "access-token",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    })
  );

  globalThis.fetch = async (url) => {
    const requestUrl = String(url);

    if (requestUrl.includes("/messages?")) {
      return jsonResponse({
        messages: [{ id: "gmail-message-1" }]
      });
    }

    if (requestUrl.includes("/messages/gmail-message-1?")) {
      return jsonResponse({
        id: "gmail-message-1",
        threadId: "thread-1",
        snippet: "I need 1100 tons of Iron ore for a price of 11000 per ton",
        payload: {
          headers: [
            { name: null, value: "ignored" },
            { name: "From", value: "sojanikhil@gmail.com" },
            { name: "Subject", value: "PO opportunity" }
          ],
          mimeType: "text/plain",
          body: {
            data: Buffer.from("I need 1100 tons of Iron ore for a price of 11000 per ton").toString("base64url")
          }
        }
      });
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const emails = await fetchGmailInquiryEmails({
      googleOAuthTokenPath: tokenPath,
      gmailSyncQuery: "from:sojanikhil@gmail.com newer_than:30d",
      gmailSyncMaxResults: 10
    });

    assert.equal(emails.length, 1);
    assert.equal(emails[0].from, "sojanikhil@gmail.com");
    assert.equal(emails[0].subject, "PO opportunity");
    assert.match(emails[0].body, /1100 tons/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
