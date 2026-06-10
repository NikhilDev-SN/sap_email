import test from "node:test";
import assert from "node:assert/strict";
import { buildWhatsAppInquiry, isRelevantWhatsAppSalesOrderText } from "../src/whatsapp/whatsappClient.mjs";

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
