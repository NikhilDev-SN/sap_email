export function buildStoredOpportunityRecord(result, existingRecord = null) {
  const sourceMessageId = result.opportunity.sourceMessageId;

  return {
    id: existingRecord?.id || result.opportunity.id,
    opportunity: existingRecord
      ? {
          ...result.opportunity,
          id: existingRecord.id,
          createdAt: existingRecord.opportunity.createdAt
        }
      : result.opportunity,
    extracted: result.extracted,
    customer: result.customer,
    decision: result.decision,
    sapResult: existingRecord ? { ...result.sapResult, opportunityId: existingRecord.id } : result.sapResult,
    sapStorage: result.sapStorage || existingRecord?.sapStorage || null,
    approval: result.approval || existingRecord?.approval || null,
    storedAt: new Date().toISOString(),
    sourceMessageId
  };
}
