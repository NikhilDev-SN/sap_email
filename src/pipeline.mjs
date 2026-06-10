import { getConfig } from "./config.mjs";
import { extractInquiry } from "./ai/extractor.mjs";
import { lookupCustomer } from "./domain/customerLookup.mjs";
import { buildOpportunity } from "./domain/opportunityBuilder.mjs";
import { applyRules, loadRulebook } from "./domain/ruleEngine.mjs";
import { createSapDocument } from "./sap/documentAdapter.mjs";

export async function processInquiry(email, overrides = {}) {
  const config = {
    ...getConfig(),
    ...overrides
  };

  const extracted = await extractInquiry(email, config);
  const customer = await lookupCustomer(extracted);
  const rulebook = await loadRulebook();
  const decision = applyRules(extracted, customer, rulebook, config);
  const opportunity = buildOpportunity({ extracted, customer, decision });

  const sapResult = decision.createDocument
    ? await createSapDocument({ extracted, customer, decision, opportunity }, config)
    : {
        mode: config.sapMode,
        documentType: decision.documentType,
        skipped: true,
        reason: decision.reasons[0] || decision.sapAction.reasons[0] || "SAP document creation needs review.",
        opportunityId: opportunity.id
      };

  return {
    extracted,
    customer,
    opportunity,
    decision,
    sapResult
  };
}
