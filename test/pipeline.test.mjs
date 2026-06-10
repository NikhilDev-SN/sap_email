import test from "node:test";
import assert from "node:assert/strict";
import { processInquiry } from "../src/pipeline.mjs";

test("iron ore inquiry can be auto-created as a SAP sales inquiry", async () => {
  const result = await processInquiry(
    {
      from: "procurement@realcustomer.example",
      subject: "Iron ore requirement",
      body: "I need 1100 tons of Iron ore / Real customer for a price of 11000 Per ton"
    },
    {
      aiProvider: "heuristic",
      sapMode: "mock",
      sapDocumentType: "auto"
    }
  );

  assert.equal(result.extracted.request.direction, "customer_buy_request");
  assert.equal(result.extracted.request.product, "Iron Ore");
  assert.equal(result.extracted.request.quantity.value, 1100);
  assert.equal(result.extracted.request.targetPrice.amount, 11000);
  assert.equal(result.customer.status, "existing");
  assert.match(result.opportunity.id, /^OPP-/);
  assert.equal(result.opportunity.businessFlow, "customer_opportunity");
  assert.equal(result.decision.action, "auto_create");
  assert.equal(result.decision.sapAction.requestedDocumentType, "auto");
  assert.equal(result.sapResult.mode, "mock");
  assert.equal(result.sapResult.documentType, "salesInquiry");
  assert.match(result.sapResult.documentId, /^MOCK-SI-/);
});

test("unknown customers are routed to draft review", async () => {
  const result = await processInquiry(
    {
      from: "newbuyer@example.com",
      subject: "Iron ore requirement",
      body: "I need 1100 tons of Iron ore for a price of 11000 per ton"
    },
    {
      aiProvider: "heuristic",
      sapMode: "mock",
      sapDocumentType: "auto"
    }
  );

  assert.equal(result.customer.status, "new");
  assert.equal(result.decision.action, "create_draft_for_review");
  assert.equal(result.sapResult.skipped, true);
  assert.ok(result.decision.reasons.some((reason) => reason.includes("Customer is new")));
});

test("customer inquiries are not turned into SAP purchase orders", async () => {
  const result = await processInquiry(
    {
      from: "procurement@realcustomer.example",
      subject: "Iron ore requirement",
      body: "I need 1100 tons of Iron ore / Real customer for a price of 11000 Per ton"
    },
    {
      aiProvider: "heuristic",
      sapMode: "mock",
      sapDocumentType: "purchaseOrder"
    }
  );

  assert.equal(result.decision.sapAction.businessFlow, "customer_opportunity");
  assert.equal(result.decision.sapAction.requestedDocumentType, "purchaseOrder");
  assert.equal(result.decision.documentType, "salesInquiry");
  assert.equal(result.sapResult.documentType, "salesInquiry");
  assert.ok(result.decision.sapAction.reasons.some((reason) => reason.includes("customer buy request")));
});

test("customer PO emails without line details become review opportunities", async () => {
  const result = await processInquiry(
    {
      from: "NIKHIL SOJA <sojanikhil@gmail.com>",
      subject: "Purchase Order Issued: PO-2026-89412 | Apex Ore Mining Corp",
      body: "Dear Mr. Nikhil, Please find attached Purchase Order PO-2026-89412 from Apex Ore Mining Corp."
    },
    {
      aiProvider: "heuristic",
      sapMode: "mock",
      sapDocumentType: "auto"
    }
  );

  assert.equal(result.extracted.request.direction, "customer_buy_request");
  assert.equal(result.extracted.request.customerPurchaseOrderReference, "PO-2026-89412");
  assert.equal(result.opportunity.businessFlow, "customer_opportunity");
  assert.equal(result.decision.action, "create_draft_for_review");
  assert.equal(result.sapResult.skipped, true);
  assert.ok(result.decision.reasons.some((reason) => reason.includes("Product is not configured")));
});

test("customer PO line items extract product quantity and unit price", async () => {
  const result = await processInquiry(
    {
      from: "NIKHIL SOJA <sojanikhil@gmail.com>",
      subject: "Purchase Order Issued: PO-2026-89412 | Apex Ore Mining Corp",
      body: `Dear Mr. Nikhil,
Please find attached Purchase Order PO-2026-89412 from Apex Ore Mining & Minerals Corp.
Key Line Items
1. Iron Ore Fines (0-8 mm): 5,000 MT @ $85.00/MT
2. Calibrated Lump Ore (10-40 mm): 2,500 MT @ $110.00/MT`
    },
    {
      aiProvider: "heuristic",
      sapMode: "mock",
      sapDocumentType: "auto"
    }
  );

  assert.equal(result.extracted.customer.name, "Apex Ore Mining Corp");
  assert.equal(result.extracted.request.customerPurchaseOrderReference, "PO-2026-89412");
  assert.match(result.extracted.request.product, /Iron Ore Fines/);
  assert.equal(result.extracted.request.quantity.value, 5000);
  assert.equal(result.extracted.request.quantity.unit, "ton");
  assert.equal(result.extracted.request.targetPrice.amount, 85);
  assert.equal(result.extracted.request.targetPrice.currency, "USD");
  assert.equal(result.decision.productRule.name, "Iron ore");
  assert.ok(result.decision.reasons.some((reason) => reason.includes("Currency USD differs")));
});
