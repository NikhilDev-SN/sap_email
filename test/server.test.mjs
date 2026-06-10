import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.SAP_MODE = "mock";
process.env.SAP_DOCUMENT_TYPE = "auto";
process.env.DISABLE_NVIDIA = "true";
process.env.OPPORTUNITY_STORE_PATH = join(tmpdir(), `sap-inquiry-agent-test-${Date.now()}.json`);
process.env.HANA_AUTH_MODE = "password";
process.env.HANA_INSTANCE_STATUS = "";
process.env.HANA_HOST = "";
process.env.HANA_USER = "";
process.env.HANA_PASSWORD = "";
process.env.HANA_UAA_URL = "";
process.env.HANA_CLIENT_ID = "";
process.env.HANA_CLIENT_SECRET = "";
const { server } = await import("../src/index.mjs");

test("serves the inquiry UI", async () => {
  const baseUrl = await listen();
  try {
    const response = await fetch(baseUrl);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /MSPL Offline Opportunities Portal/);
    assert.match(html, /WhatsApp sales orders/);
    assert.match(html, /Approval/);
    assert.match(html, /Review dashboard/);
  } finally {
    await close();
  }
});

test("serves a natural language agent summary", async () => {
  const baseUrl = await listen();
  try {
    const response = await fetch(`${baseUrl}/agent/summary`);
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(typeof result.reply, "string");
    assert.match(result.reply, /ready to help/i);
    assert.equal(result.opportunities, undefined);
  } finally {
    await close();
  }
});

test("serves WhatsApp dashboard status without starting a session", async () => {
  const baseUrl = await listen();
  try {
    const response = await fetch(`${baseUrl}/whatsapp/status`);
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.enabled, true);
    assert.equal(result.ready, false);
    assert.equal(result.status, "idle");
    assert.ok(result.search.terms.includes("minning sales order"));
  } finally {
    await close();
  }
});

test("processes inquiries through HTTP", async () => {
  const baseUrl = await listen();
  try {
    const response = await fetch(`${baseUrl}/inquiries/process`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "procurement@realcustomer.example",
        subject: "Iron ore requirement",
        body: "I need 1100 tons of Iron ore / Real customer for a price of 11000 Per ton"
      })
    });
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.decision.action, "auto_create");
    assert.equal(result.opportunity.businessFlow, "customer_opportunity");
    assert.equal(result.sapResult.documentType, "salesInquiry");
  } finally {
    await close();
  }
});

test("approval moves records forward and tracks pending SAP send", async () => {
  const baseUrl = await listen();
  try {
    const inquiryResponse = await fetch(`${baseUrl}/inquiries/process`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "procurement@realcustomer.example",
        subject: "Iron ore requirement",
        body: "I need 1100 tons of Iron ore / Real customer for a price of 11000 Per ton"
      })
    });
    const inquiry = await inquiryResponse.json();

    const tagResponse = await fetch(`${baseUrl}/opportunities/${encodeURIComponent(inquiry.persisted.id)}/tag`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ tag: "needs_review" })
    });
    const tagged = await tagResponse.json();

    assert.equal(tagResponse.status, 200);
    assert.equal(tagged.ok, true);
    assert.equal(tagged.record.approval.tag, "needs_review");

    const acceptedResponse = await fetch(`${baseUrl}/opportunities/${encodeURIComponent(inquiry.persisted.id)}/accept`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ tag: "pre_approved" })
    });
    const accepted = await acceptedResponse.json();

    assert.equal(acceptedResponse.status, 200);
    assert.equal(accepted.ok, true);
    assert.equal(accepted.record.approval.status, "review");
    assert.equal(accepted.record.approval.tag, "pre_approved");
    assert.equal(accepted.record.sapStorage.status, "waiting_review");

    const unconfirmedResponse = await fetch(
      `${baseUrl}/opportunities/${encodeURIComponent(inquiry.persisted.id)}/confirm-sap-store`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ confirm: false })
      }
    );
    const unconfirmed = await unconfirmedResponse.json();

    assert.equal(unconfirmedResponse.status, 400);
    assert.equal(unconfirmed.ok, false);
    assert.match(unconfirmed.message, /Approval is required/i);

    const confirmedResponse = await fetch(
      `${baseUrl}/opportunities/${encodeURIComponent(inquiry.persisted.id)}/confirm-sap-store`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ confirm: true })
      }
    );
    const confirmed = await confirmedResponse.json();

    assert.equal(confirmedResponse.status, 200);
    assert.equal(confirmed.ok, true);
    assert.equal(confirmed.record.approval.status, "approved");
    assert.equal(confirmed.record.sapStorage.status, "send_pending");
    assert.ok(confirmed.record.sapStorage.missing.includes("HANA_USER"));
    assert.ok(confirmed.record.sapStorage.missing.includes("HANA_PASSWORD"));
  } finally {
    await close();
  }
});

function listen() {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close() {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
    server.closeAllConnections?.();
  });
}
