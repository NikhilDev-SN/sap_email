import { callNvidiaChat, selectAgentModel } from "../ai/nvidiaClient.mjs";
import { syncMailOpportunities } from "../mail/inquirySync.mjs";
import { listOpportunities } from "../storage/opportunityStore.mjs";

const AGENT_GREETING = "Hi, I am ready to help with PO opportunities.";

export async function runOpportunityAgent(message, config) {
  const normalizedMessage = String(message || "").trim();
  const actions = [];

  if (shouldSyncMail(normalizedMessage)) {
    const syncResult = await syncMailOpportunities(config, { trigger: "agent" });
    actions.push(
      `I checked Gmail, processed ${syncResult.processed || 0} message${
        syncResult.processed === 1 ? "" : "s"
      }, and added ${syncResult.readyForApproval || syncResult.processed || 0} opportunit${
        (syncResult.readyForApproval || syncResult.processed) === 1 ? "y" : "ies"
      } to the approval dashboard.`
    );
    return {
      reply: actions[0],
      actions,
      opportunities: await listOpportunities({ limit: 20 })
    };
  }

  const opportunities = await listOpportunities({ limit: 20 });
  const directReply = buildDirectInsightReply(normalizedMessage, opportunities, config);
  if (directReply) {
    return {
      reply: directReply,
      actions,
      opportunities
    };
  }

  const reply = await buildNaturalLanguageReply({
    message: normalizedMessage,
    actions,
    opportunities,
    config
  });

  return {
    reply,
    actions,
    opportunities
  };
}

export async function getAgentOpeningSummary() {
  return {
    reply: AGENT_GREETING
  };
}

async function buildNaturalLanguageReply({ message, actions, opportunities, config }) {
  const context = buildOpportunityContext(opportunities, config);
  const model = selectAgentModel(config, inferModelRole(message));

  try {
    const response = await callNvidiaChat({
      config,
      model,
      messages: [
        {
          role: "system",
          content:
            "You are an SAP opportunity intake agent. Reply in plain natural language only. Do not output JSON, code, markdown, bullets, tables, asterisks, headings, or backend field dumps. Answer questions about PO opportunities, customer names, requested amounts, rulebook readiness, delivery/commercial ability, and next business action using only the supplied records. Do not invent stock, capacity, shipment promises, or SAP document IDs. Keep it concise and human."
        },
        {
          role: "user",
          content: [
            `User message: ${message || "Status"}`,
            actions.length ? `Actions performed: ${actions.join(" ")}` : "Actions performed: none",
            `Opportunity context:\n${context}`
          ].join("\n\n")
        }
      ],
      maxTokens: 700
    });

    return cleanAssistantText(response.content);
  } catch (error) {
    return deterministicReply({ actions, opportunities });
  }
}

function buildOpportunityContext(opportunities, config) {
  if (!opportunities.length) {
    return "No opportunities are currently available.";
  }

  return opportunities
    .slice(0, 5)
    .map((record, index) => {
      const opportunity = record.opportunity;
      const reasons = record.decision?.reasons?.join("; ") || "No rule exceptions.";
      const approvalStatus = record.approval?.status || (record.sapStorage?.status === "stored" ? "approved" : "pending");
      const approvalTag = record.approval?.tag === "pre_approved" ? "pre-approved" : "needs review";
      return [
        `${index + 1}. ${opportunity.name}`,
        `Customer: ${getDisplayCustomerName(record)}`,
        `Queue: ${getQueueName(approvalStatus)}`,
        `Approval tag: ${approvalTag}`,
        `PO reference: ${opportunity.request.customerPurchaseOrderReference || "none"}`,
        `Requested amount: ${formatInrMoney(opportunity.commercial?.totalValue, opportunity.commercial?.currency, config)}`,
        `Quantity and price: ${opportunity.request.quantity || "-"} ${opportunity.request.unit || ""} at ${opportunity.request.targetPrice || "-"} ${opportunity.request.currency || ""}`,
        `Approval status: ${approvalStatus}`,
        `Business readiness: ${summarizeDeliveryAbility(record)}`,
        `Reasons: ${reasons}`,
        `Email text: ${String(record.extracted?.rawSummary || "").slice(0, 1800)}`
      ].join("\n");
    })
    .join("\n\n");
}

function getQueueName(status) {
  if (status === "approved") {
    return "approved list";
  }
  if (status === "review") {
    return "review dashboard";
  }
  if (status === "rejected") {
    return "ignored";
  }
  return "approval dashboard";
}

function buildDirectInsightReply(message, opportunities, config) {
  if (!opportunities.length) {
    return "I do not have any PO opportunities available yet.";
  }

  if (/\b(highest|largest|biggest|max(?:imum)?)\b/i.test(message) && /\b(amount|value|request|po|order)\b/i.test(message)) {
    const highest = opportunities
      .filter((record) => Number.isFinite(Number(record.opportunity?.commercial?.totalValue)))
      .sort(
        (a, b) =>
          toInrValue(b.opportunity.commercial.totalValue, b.opportunity.commercial.currency, config) -
          toInrValue(a.opportunity.commercial.totalValue, a.opportunity.commercial.currency, config)
      )[0];

    if (!highest) {
      return "I do not have a requested amount on the PO opportunities yet.";
    }

    const opportunity = highest.opportunity;
    return `${getDisplayCustomerName(highest)} has the highest requested amount: ${formatInrMoney(
      opportunity.commercial.totalValue,
      opportunity.commercial.currency,
      config
    )} for ${opportunity.request.product || "the requested product"}${
      opportunity.request.customerPurchaseOrderReference ? ` under ${opportunity.request.customerPurchaseOrderReference}` : ""
    }.`;
  }

  if (/\b(deliver|supply|fulfill|fulfil|can we|able|ability|ready)\b/i.test(message)) {
    const record = findMentionedOpportunity(message, opportunities) || opportunities[0];
    const opportunity = record.opportunity;
    const reference = opportunity.request.customerPurchaseOrderReference
      ? opportunity.request.customerPurchaseOrderReference
      : "the latest PO opportunity";
    return `${getDisplayCustomerName(record)} ${reference}: ${summarizeDeliveryAbility(record)}`;
  }

  return null;
}

function deterministicReply({ actions, opportunities }) {
  const latest = opportunities[0];
  const intro = actions.length ? actions.join(" ") : "I checked the current opportunity queue.";

  if (!latest) {
    return `${intro} There are no opportunities yet. Ask me to sync Gmail when a PO email is ready.`;
  }

  const opportunity = latest.opportunity;
  const reasons = latest.decision?.reasons?.length
    ? `It needs a business check because ${latest.decision.reasons.join("; ")}.`
    : "It is ready for the planned SAP action.";

  return [
    intro,
    `The latest opportunity is from ${getDisplayCustomerName(latest)} for ${opportunity.request.product || "the requested product"}.`,
    `PO ${opportunity.request.customerPurchaseOrderReference || "reference not found"} is for ${opportunity.request.quantity || "-"} ${opportunity.request.unit || ""} at ${opportunity.request.targetPrice || "-"} ${opportunity.request.currency || ""}.`,
    reasons,
    "The full email text is attached in the dashboard detail view."
  ].join(" ");
}

function shouldSyncMail(message) {
  return /\b(sync|fetch|pull|refresh|update|gmail|mail|email|inbox)\b/i.test(message);
}

function cleanAssistantText(value) {
  return String(value || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function inferModelRole(message) {
  if (/\b(why|reason|rule|rulebook|approval|review|price|pricing|margin|cost|sap)\b/i.test(message)) {
    return "reasoning";
  }

  if (/\b(quick|brief|status|summary)\b/i.test(message)) {
    return "fast";
  }

  return "orchestrator";
}

function findMentionedOpportunity(message, opportunities) {
  const poMatch = message.match(/\bPO-\d{4,}[-A-Z0-9]*\b/i);
  if (poMatch) {
    const po = poMatch[0].toUpperCase();
    return opportunities.find(
      (record) => String(record.opportunity?.request?.customerPurchaseOrderReference || "").toUpperCase() === po
    );
  }

  const lowered = message.toLowerCase();
  return opportunities.find((record) => {
    const values = [
      getDisplayCustomerName(record),
      record.opportunity?.request?.product,
      record.opportunity?.name
    ].map((value) => String(value || "").toLowerCase());
    return values.some((value) => value && lowered.includes(value));
  });
}

function summarizeDeliveryAbility(record) {
  const reasons = record.decision?.reasons || [];
  const opportunity = record.opportunity || {};

  if (!reasons.length && opportunity.stage === "qualified") {
    return "Based on the rulebook, this looks ready to proceed: the customer is accepted, the product is configured, the price is within the allowed floor, and the quantity is inside the automatic limit.";
  }

  if (!reasons.length) {
    return "I do not see rulebook exceptions, but the business team should confirm schedule and capacity before promising delivery.";
  }

  return `I would not commit delivery automatically yet. It needs a business check because ${formatReasonText(reasons)}.`;
}

function getDisplayCustomerName(record) {
  const existingName = record.opportunity?.customer?.name || record.customer?.name || record.extracted?.customer?.name;
  if (existingName && !/^gmail$/i.test(existingName)) {
    return existingName;
  }

  const text = `${record.extracted?.source?.subject || ""}\n${record.extracted?.rawSummary || ""}`;
  const fromBody = text.match(/\bPurchase Order\s+PO-[A-Z0-9-]+\s+from\s+(.+?)(?:\s+for\b|\.|\r|\n)/i);
  if (fromBody) {
    return titleCase(fromBody[1].trim());
  }

  const fromSubject = text.match(/\bPurchase Order(?:\s+Issued|\s+Attached)?:\s*PO-[A-Z0-9-]+(?:\s*[-|]\s*)([^\r\n]+)/i);
  return fromSubject ? titleCase(fromSubject[1].trim()) : existingName || "Unknown customer";
}

function titleCase(value) {
  return String(value || "").replace(/\w\S*/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
}

function formatReasonText(reasons) {
  return reasons
    .map(cleanBusinessReason)
    .filter(Boolean)
    .join("; ");
}

function cleanBusinessReason(reason) {
  return String(reason || "")
    .trim()
    .replace(/[.]+$/, "")
    .replace(/requires business partner review/i, "needs business partner approval")
    .replace(/needs review/i, "needs checking")
    .replace(/\breview\b/gi, "check");
}

function formatInrMoney(value, currency, config) {
  const inrValue = toInrValue(value, currency, config);
  if (!Number.isFinite(inrValue)) {
    return "amount not available";
  }
  return `₹${Math.round(inrValue).toLocaleString("en-IN")}`;
}

function toInrValue(value, currency, config) {
  if (value === null || value === undefined || value === "") {
    return NaN;
  }
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return NaN;
  }
  if (String(currency || "INR").toUpperCase() === "USD") {
    return numericValue * Number(config.displayUsdToInrRate || 83.5);
  }
  return numericValue;
}
