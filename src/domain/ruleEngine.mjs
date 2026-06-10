import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { planSapAction } from "./sapPlanner.mjs";

const RULEBOOK_PATH = resolve("data", "rulebook.json");

export async function loadRulebook(rulebookPath = RULEBOOK_PATH) {
  return JSON.parse(await readFile(rulebookPath, "utf8"));
}

export function applyRules(extracted, customer, rulebook, config = {}) {
  const productRule = findProductRule(extracted.request.product, rulebook);
  const customerRule = findCustomerRule(customer.tier, rulebook);
  const quantity = extracted.request.quantity.value;
  const price = extracted.request.targetPrice.amount;
  const currency = extracted.request.targetPrice.currency || rulebook.currency;
  const totalValue = quantity && price ? quantity * price : null;
  const issues = [];
  const sapAction = planSapAction(extracted, config, rulebook);

  if (!productRule) {
    issues.push("Product is not configured in the rulebook.");
  }
  if (!quantity) {
    issues.push("Requested quantity is missing.");
  }
  if (!price) {
    issues.push("Target price per unit is missing.");
  }
  if (extracted.confidence < rulebook.autoCreatePolicy.minimumConfidence) {
    issues.push("Extraction confidence is below the auto-create threshold.");
  }
  if (customer.status === "new" && !rulebook.autoCreatePolicy.allowNewCustomers) {
    issues.push("Customer is new and requires business partner review.");
  }

  const effectiveMinPrice = productRule
    ? productRule.minPricePerTon * (customerRule?.priceFloorMultiplier || 1)
    : null;
  if (effectiveMinPrice && price && currency !== rulebook.currency) {
    issues.push(`Currency ${currency} differs from rulebook currency ${rulebook.currency}; price floor needs review.`);
  } else if (effectiveMinPrice && price && price < effectiveMinPrice) {
    issues.push(`Target price ${price} ${currency} is below the minimum ${effectiveMinPrice} ${currency}.`);
  }
  if (productRule?.requiresApprovalQuantityAbove && quantity > productRule.requiresApprovalQuantityAbove) {
    issues.push(`Quantity ${quantity} exceeds the auto-approval limit ${productRule.requiresApprovalQuantityAbove}.`);
  }
  if (productRule?.maxAutoValue && totalValue > productRule.maxAutoValue) {
    issues.push(`Total value ${totalValue} ${currency} exceeds the auto-create limit ${productRule.maxAutoValue}.`);
  }
  if (customerRule?.requiresApproval) {
    issues.push(`Customer tier ${customer.tier} requires approval.`);
  }

  const canAutoCreate = issues.length === 0;
  const documentType = sapAction.documentType;

  return {
    action: canAutoCreate ? "auto_create" : "create_draft_for_review",
    documentType,
    requestDirection: extracted.request.direction,
    createDocument: Boolean(canAutoCreate && productRule && quantity && price && sapAction.createSapDocument),
    reasons: issues,
    sapAction,
    productRule,
    customerRule,
    commercial: {
      quantity,
      unit: extracted.request.quantity.unit || productRule?.unit || rulebook.defaultUnit,
      pricePerUnit: price,
      currency,
      totalValue,
      effectiveMinPrice
    }
  };
}

function findProductRule(product, rulebook) {
  const normalized = normalize(product);
  return rulebook.products.find((rule) => {
    const names = [rule.name, ...(rule.aliases || [])].map(normalize);
    return names.includes(normalized) || names.some((name) => normalized.includes(name));
  });
}

function findCustomerRule(tier, rulebook) {
  return rulebook.customerRules.find((rule) => rule.tier === tier);
}

function normalize(value = "") {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}
