import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getConfig } from "../src/config.mjs";
import {
  buildWhatsAppCloudInquiry,
  buildWhatsAppInquiry,
  isRelevantWhatsAppSalesOrderText,
  processWhatsAppCloudWebhook,
  startWhatsAppClient,
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

test("serverless whatsapp start returns cloud status without loading browser client", async () => {
  const status = await startWhatsAppClient(
    getConfig({
      NETLIFY: "true",
      WHATSAPP_ENABLED: "true"
    })
  );

  assert.equal(status.enabled, true);
  assert.equal(status.connector, "cloud-api");
  assert.equal(status.status, "cloud_setup_required");
  assert.equal(status.web.enabled, false);
  assert.equal(status.cloudApi.enabled, true);
  assert.match(status.lastError, /WHATSAPP_CLOUD_VERIFY_TOKEN/i);
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
