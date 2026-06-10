export function buildOpportunity({ extracted, customer, decision }) {
  const product = extracted.request.product || "Unknown product";
  const customerName = customer.name || extracted.customer.name || "Unknown customer";

  return {
    id: `OPP-${Date.now()}`,
    source: extracted.source.provider || "email",
    sourceMessageId: extracted.source.messageId || null,
    name: `${customerName} - ${product}`,
    stage: decision.action === "auto_create" ? "qualified" : "review",
    businessFlow: decision.sapAction.businessFlow,
    nextBestAction: decision.sapAction.intent,
    customer: {
      id: customer.id,
      name: customerName,
      status: customer.status,
      tier: customer.tier,
      sapBusinessPartner: customer.sapBusinessPartner || null
    },
    request: {
      type: extracted.request.type,
      direction: extracted.request.direction,
      product,
      quantity: decision.commercial.quantity,
      unit: decision.commercial.unit,
      targetPrice: decision.commercial.pricePerUnit,
      currency: decision.commercial.currency,
      customerPurchaseOrderReference: extracted.request.customerPurchaseOrderReference || null
    },
    commercial: decision.commercial,
    ruleDecision: {
      action: decision.action,
      reasons: decision.reasons
    },
    createdAt: new Date().toISOString()
  };
}
