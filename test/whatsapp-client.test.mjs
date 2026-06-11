import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getConfig } from "../src/config.mjs";
import {
  buildWhatsAppCloudInquiry,
  buildWhatsAppInquiry,
  isRecentWhatsAppMessage,
  isRelevantWhatsAppSalesOrderText,
  processWhatsAppCloudWebhook,
  startWhatsAppClient,
  syncWhatsAppSalesOrderMessages,
  verifyWhatsAppCloudWebhook
} from "../src/whatsapp/whatsappClient.mjs";

test("whatsapp scan matches minning sales order messages", () => {
  const match = isRelevantWhatsAppSalesOrderText(
    "Minning sales order: need 500 MT of Iron Ore Fines at INR 9000 / MT",
    ["minning sales order"]
  );

  assert.equal(match.matched, true);
  assert.ok(match.reasons.some((reason) => /configured term/i.test(reason)));
});

test("whatsapp scan matches mining material order context", () => {
  const match = isRelevantWhatsAppSalesOrderText("Please confirm purchase order for 1200 tons coal.", []);

  assert.equal(match.matched, true);
  assert.ok(match.reasons.includes("Sales order intent"));
  assert.ok(match.reasons.includes("Mining material context"));
});

test("whatsapp messages become inquiry input with stable source ids", () => {
  const inquiry = buildWhatsAppInquiry(
    {
      id: { _serialized: "message-1" },
      from: "919999999999@c.us",
      timestamp: 1780300800,
      body: "Mining sales order for 700 tons iron ore at INR 10000 per ton"
    },
    {
      id: { _serialized: "919999999999@c.us" },
      name: "Apex Mining"
    }
  );

  assert.equal(inquiry.provider, "whatsapp");
  assert.equal(inquiry.messageId, "whatsapp:message-1");
  assert.equal(inquiry.threadId, "whatsapp:919999999999@c.us");
  assert.match(inquiry.from, /Apex Mining/);
  assert.match(inquiry.body, /Mining sales order/);
});

test("serverless whatsapp start returns personal bridge status without loading browser client", async () => {
  const status = await startWhatsAppClient(
    getConfig({
      NETLIFY: "true",
      WHATSAPP_ENABLED: "true"
    })
  );

  assert.equal(status.enabled, true);
  assert.equal(status.connector, "personal-bridge");
  assert.equal(status.status, "bridge_setup_required");
  assert.equal(status.web.enabled, false);
  assert.equal(status.personalBridge.enabled, true);
  assert.match(status.lastError, /WHATSAPP_PERSONAL_BRIDGE_URL/i);
});

test("whatsapp recent filter keeps only messages inside the scan window", () => {
  const since = new Date("2026-06-11T10:00:00.000Z");

  assert.equal(isRecentWhatsAppMessage({ timestamp: 1781172000 }, since), true);
  assert.equal(isRecentWhatsAppMessage({ timestamp: 1781171999 }, since), false);
  assert.equal(isRecentWhatsAppMessage({}, since), false);
});

test("personal bridge sync makes one recent-window request to the worker", async () => {
  let requestCount = 0;
  let requestBody = null;
  let authorization = "";
  const worker = createServer(async (request, response) => {
    requestCount += 1;
    authorization = request.headers.authorization || "";
    let body = "";
    for await (const chunk of request) {
      body += chunk;
    }
    requestBody = JSON.parse(body);
    response.writeHead(200, {
      "Content-Type": "application/json",
      "Connection": "close"
    });
    response.end(
      JSON.stringify({
        scannedChats: 2,
        scannedMessages: 3,
        matched: 1,
        processed: 1,
        readyForApproval: 1,
        since: "2026-06-11T09:55:00.000Z",
        opportunities: [],
        matches: [
          {
            recordId: "record-1",
            preview: "Mining sales order for 700 tons iron ore"
          }
        ]
      })
    );
  });
  const workerUrl = await listenWorker(worker);

  try {
    const result = await syncWhatsAppSalesOrderMessages(
      getConfig({
        WHATSAPP_CONNECTOR: "personal-bridge",
        WHATSAPP_ENABLED: "true",
        WHATSAPP_PERSONAL_BRIDGE_URL: workerUrl,
        WHATSAPP_PERSONAL_BRIDGE_TOKEN: "bridge-token",
        WHATSAPP_RECENT_MINUTES: "7",
        WHATSAPP_CHAT_LIMIT: "40",
        WHATSAPP_LOOKBACK_LIMIT: "60",
        WHATSAPP_PROCESS_LIMIT: "9"
      })
    );

    assert.equal(requestCount, 1);
    assert.equal(authorization, "Bearer bridge-token");
    assert.equal(requestBody.recentMinutes, 7);
    assert.equal(requestBody.chatLimit, 40);
    assert.equal(requestBody.lookbackLimit, 60);
    assert.equal(requestBody.processLimit, 9);
    assert.equal(result.connector, "personal-bridge");
    assert.equal(result.matched, 1);
    assert.equal(result.processed, 1);
    assert.match(result.matches[0].preview, /Mining sales order/i);
  } finally {
    await closeWorker(worker);
  }
});

test("whatsapp cloud webhook verification returns the Meta challenge", () => {
  const config = getConfig({
    WHATSAPP_CONNECTOR: "cloud-api",
    WHATSAPP_ENABLED: "true",
    WHATSAPP_CLOUD_VERIFY_TOKEN: "verify-me"
  });
  const url = new URL("/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc123", "https://example.com");

  const result = verifyWhatsAppCloudWebhook(config, url);

  assert.equal(result.statusCode, 200);
  assert.equal(result.body, "abc123");
});

test("whatsapp cloud messages become inquiry input with stable source ids", () => {
  const inquiry = buildWhatsAppCloudInquiry({
    message: {
      id: "wamid.123",
      from: "919999999999",
      timestamp: "1780300800",
      text: {
        body: "Mining sales order for 700 tons iron ore at INR 10000 per ton"
      }
    },
    contact: {
      wa_id: "919999999999",
      profile: {
        name: "Apex Mining"
      }
    },
    metadata: {
      display_phone_number: "15550000000"
    }
  });

  assert.equal(inquiry.provider, "whatsapp-cloud");
  assert.equal(inquiry.messageId, "whatsapp-cloud:wamid.123");
  assert.equal(inquiry.threadId, "whatsapp:919999999999");
  assert.match(inquiry.from, /Apex Mining/);
  assert.match(inquiry.body, /Mining sales order/);
});

test("whatsapp cloud webhook processes mining sales order messages", async () => {
  process.env.OPPORTUNITY_STORE_PATH = join(tmpdir(), `sap-whatsapp-cloud-${Date.now()}.json`);
  const result = await processWhatsAppCloudWebhook(
    getConfig({
      WHATSAPP_CONNECTOR: "cloud-api",
      WHATSAPP_ENABLED: "true",
      WHATSAPP_CLOUD_VERIFY_TOKEN: "verify-me",
      SAP_MODE: "mock",
      SAP_DOCUMENT_TYPE: "auto",
      DISABLE_NVIDIA: "true"
    }),
    {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                metadata: {
                  display_phone_number: "15550000000",
                  phone_number_id: "phone-1"
                },
                contacts: [
                  {
                    wa_id: "919999999999",
                    profile: {
                      name: "Apex Mining"
                    }
                  }
                ],
                messages: [
                  {
                    id: "wamid.order-1",
                    from: "919999999999",
                    timestamp: "1780300800",
                    type: "text",
                    text: {
                      body: "Mining sales order for 700 tons iron ore at INR 10000 per ton"
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.received, 1);
  assert.equal(result.matched, 1);
  assert.equal(result.processed, 1);
  assert.equal(result.opportunities.length, 1);
  assert.match(result.matches[0].preview, /Mining sales order/);
});

function listenWorker(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function closeWorker(server) {
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
