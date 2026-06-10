export function prepareApprovalRecord(record) {
  const currentStatus = getApprovalStatus(record);
  if (currentStatus === "approved" || currentStatus === "rejected" || currentStatus === "review") {
    return withApprovalState(record, { status: currentStatus });
  }

  return {
    ...withApprovalState(record, { status: "pending" }),
    sapStorage: {
      status: "waiting_approval",
      checkedAt: new Date().toISOString(),
      message: "Waiting for approval."
    }
  };
}

export function markApproved(record) {
  return withApprovalState(record, {
    status: "approved",
    approvedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    message: "Approved and sent to SAP."
  });
}

export function markInReview(record) {
  const now = new Date().toISOString();
  return {
    ...withApprovalState(record, {
      status: "review",
      acceptedAt: now,
      updatedAt: now,
      message: "Accepted for review."
    }),
    sapStorage: {
      status: "waiting_review",
      checkedAt: now,
      message: "Waiting for final review."
    }
  };
}

export function markRejected(record) {
  return {
    ...withApprovalState(record, {
      status: "rejected",
      rejectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      message: "Rejected and ignored."
    }),
    sapStorage: {
      status: "rejected",
      checkedAt: new Date().toISOString(),
      message: "Rejected by approver."
    }
  };
}

export function setApprovalTag(record, tag) {
  return withApprovalState(record, {
    tag: normalizeTag(tag),
    updatedAt: new Date().toISOString()
  });
}

export function withApprovalState(record, overrides = {}) {
  const tag = getApprovalTag(record);
  const existing = record.approval || {};
  const status = overrides.status || existing.status || inferApprovalStatus(record);

  return {
    ...record,
    approval: {
      tag,
      status,
      message: getApprovalMessage(tag, status),
      ...existing,
      ...overrides,
      updatedAt: overrides.updatedAt || existing.updatedAt || new Date().toISOString()
    }
  };
}

export function getApprovalTag(record) {
  const explicitTag = normalizeTag(record?.approval?.tag);
  if (explicitTag) {
    return explicitTag;
  }
  const reasons = record?.decision?.reasons || record?.opportunity?.ruleDecision?.reasons || [];
  return needsManualProduct(record) || reasons.length ? "needs_review" : "pre_approved";
}

export function getApprovalStatus(record) {
  return String(record?.approval?.status || inferApprovalStatus(record)).toLowerCase();
}

export function isApproved(record) {
  return getApprovalStatus(record) === "approved";
}

export function isRejected(record) {
  return getApprovalStatus(record) === "rejected";
}

export function needsManualProduct(record) {
  const product = String(record?.opportunity?.request?.product || record?.extracted?.request?.product || "").trim();
  return !product || /^unknown product$/i.test(product);
}

function inferApprovalStatus(record) {
  const storageStatus = String(record?.sapStorage?.status || "").toLowerCase();
  if (storageStatus === "stored") {
    return "approved";
  }
  if (storageStatus === "rejected") {
    return "rejected";
  }
  return "pending";
}

function getApprovalMessage(tag, status) {
  if (status === "approved") {
    return "Approved and sent to SAP.";
  }
  if (status === "rejected") {
    return "Rejected and ignored.";
  }
  if (status === "review") {
    return "Accepted for review.";
  }
  return tag === "pre_approved" ? "Rulebook checks passed." : "Business review is needed before approval.";
}

function normalizeTag(tag) {
  const value = String(tag || "").toLowerCase().replace(/-/g, "_").trim();
  if (value === "pre_approved" || value === "needs_review") {
    return value;
  }
  return "";
}
