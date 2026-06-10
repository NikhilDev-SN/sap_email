const navButtons = document.querySelectorAll(".nav-button");
const views = document.querySelectorAll(".view");
const messageList = document.querySelector("#message-list");
const chatForm = document.querySelector("#chat-form");
const chatInput = document.querySelector("#chat-input");
const chatSendButton = document.querySelector("#chat-send-button");
const refreshButton = document.querySelector("#refresh-button");
const approvalTableBody = document.querySelector("#approval-table-body");
const reviewTableBody = document.querySelector("#review-table-body");
const approvedTableBody = document.querySelector("#approved-table-body");
const approvalEmptyState = document.querySelector("#approval-empty-state");
const reviewEmptyState = document.querySelector("#review-empty-state");
const approvedEmptyState = document.querySelector("#approved-empty-state");
const approvalFilter = document.querySelector("#approval-filter");
const reviewFilter = document.querySelector("#review-filter");
const approvedFilter = document.querySelector("#approved-filter");
const actionStatus = document.querySelector("#action-status");
const customerVisual = document.querySelector("#customer-visual");
const productVisual = document.querySelector("#product-visual");
const customerChartList = document.querySelector("#customer-chart-list");
const productChartList = document.querySelector("#product-chart-list");
const runtimeStatusText = document.querySelector("#runtime-status-text");
const mailboxStatusText = document.querySelector("#mailbox-status-text");
const whatsappStatusText = document.querySelector("#whatsapp-status-text");
const syncStatusText = document.querySelector("#sync-status-text");
const backToDashboardButton = document.querySelector("#back-to-dashboard-button");
const recordHeading = document.querySelector("#record-heading");
const recordBanner = document.querySelector("#record-banner");
const recordTagSelect = document.querySelector("#record-tag-select");
const recordTagStatus = document.querySelector("#record-tag-status");
const recordCustomerList = document.querySelector("#record-customer-list");
const recordPoList = document.querySelector("#record-po-list");
const recordCommercialList = document.querySelector("#record-commercial-list");
const recordFulfillmentList = document.querySelector("#record-fulfillment-list");
const recordEmailBody = document.querySelector("#record-email-body");
const whatsappStartButton = document.querySelector("#whatsapp-start-button");
const whatsappScanButton = document.querySelector("#whatsapp-scan-button");
const whatsappActionStatus = document.querySelector("#whatsapp-action-status");
const whatsappLoginStatus = document.querySelector("#whatsapp-login-status");
const whatsappScanStatus = document.querySelector("#whatsapp-scan-status");
const whatsappQrImage = document.querySelector("#whatsapp-qr-image");
const whatsappQrPlaceholder = document.querySelector("#whatsapp-qr-placeholder");
const whatsappMetaList = document.querySelector("#whatsapp-meta-list");
const whatsappFilter = document.querySelector("#whatsapp-filter");
const whatsappTableBody = document.querySelector("#whatsapp-table-body");
const whatsappEmptyState = document.querySelector("#whatsapp-empty-state");

const kpis = {
  pending: document.querySelector("#kpi-pending"),
  review: document.querySelector("#kpi-review"),
  preApproved: document.querySelector("#kpi-pre-approved"),
  needsReview: document.querySelector("#kpi-needs-review"),
  reviewWaiting: document.querySelector("#kpi-review-waiting"),
  approved: document.querySelector("#kpi-approved"),
  reviewValue: document.querySelector("#kpi-review-value"),
  approvedValue: document.querySelector("#kpi-approved-value"),
  whatsappConnection: document.querySelector("#kpi-whatsapp-connection"),
  whatsappScanned: document.querySelector("#kpi-whatsapp-scanned"),
  whatsappMatched: document.querySelector("#kpi-whatsapp-matched"),
  whatsappProcessed: document.querySelector("#kpi-whatsapp-processed")
};

const chartColors = ["#0b7285", "#2f7d4f", "#4958a8", "#b7791f", "#c8553d", "#687789"];
const chartState = {
  customer: { mode: "bar" },
  product: { mode: "bar" }
};

let opportunities = [];
let selectedRecordId = null;
let lastDashboardView = "approval-view";
let usdToInrRate = 83.5;
let approvalQuery = "";
let reviewQuery = "";
let approvedQuery = "";
let whatsappQuery = "";
let whatsappStatus = null;
let whatsappPollTimer = null;

navButtons.forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

refreshButton.addEventListener("click", () => refreshDashboardFromGmail());
whatsappStartButton.addEventListener("click", () => startWhatsAppLogin());
whatsappScanButton.addEventListener("click", () => scanWhatsAppMessages());
approvalFilter.addEventListener("input", () => {
  approvalQuery = approvalFilter.value.trim().toLowerCase();
  renderTables();
});
reviewFilter.addEventListener("input", () => {
  reviewQuery = reviewFilter.value.trim().toLowerCase();
  renderTables();
});
approvedFilter.addEventListener("input", () => {
  approvedQuery = approvedFilter.value.trim().toLowerCase();
  renderTables();
});
whatsappFilter.addEventListener("input", () => {
  whatsappQuery = whatsappFilter.value.trim().toLowerCase();
  renderWhatsAppMatches();
});
approvalTableBody.addEventListener("click", handleApprovalTableClick);
approvalTableBody.addEventListener("change", handleTableTagChange);
reviewTableBody.addEventListener("click", handleReviewTableClick);
approvedTableBody.addEventListener("click", handleApprovedTableClick);
whatsappTableBody.addEventListener("click", handleWhatsAppTableClick);
backToDashboardButton.addEventListener("click", () => setView(lastDashboardView));
recordTagSelect.addEventListener("change", () => updateRecordTag(selectedRecordId, recordTagSelect.value, recordTagStatus));
document.querySelectorAll(".segmented button").forEach((button) => {
  button.addEventListener("click", () => setChartMode(button.dataset.chart, button.dataset.mode));
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message) {
    return;
  }
  chatInput.value = "";
  await sendAgentMessage(message);
});

setView("agent-view");
loadRuntimeStatus();
loadWhatsAppStatus();
loadOpportunities();
loadOpeningSummary();
window.setTimeout(() => refreshDashboardFromGmail({ initial: true }), 1200);
window.setInterval(() => {
  loadOpportunities();
  loadRuntimeStatus();
  loadWhatsAppStatus();
}, 20000);

function setView(viewId) {
  if (viewId === "approval-view" || viewId === "review-view") {
    lastDashboardView = viewId;
  }
  navButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewId);
  });
  views.forEach((view) => {
    view.classList.toggle("active", view.id === viewId);
  });
}

async function loadOpeningSummary() {
  try {
    const response = await fetch("/agent/summary");
    const result = await response.json();
    appendMessage("agent", result.reply || "Hi, I am ready to help with PO opportunities.");
  } catch {
    appendMessage("agent", "Hi, I am ready to help with PO opportunities.");
  }
}

async function refreshDashboardFromGmail(options = {}) {
  const originalLabel = refreshButton.textContent;
  refreshButton.disabled = true;
  refreshButton.textContent = options.initial ? "Syncing" : "Refreshing";

  try {
    const response = await fetch("/emails/sync", {
      method: "POST"
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Gmail sync failed.");
    }

    updateOpportunityState(result.opportunities?.length ? result.opportunities : opportunities);
    await loadOpportunities();
    await loadRuntimeStatus();
    setActionStatus("Email opportunities are ready for approval.");
    refreshButton.textContent = "Updated";
  } catch (error) {
    syncStatusText.textContent = error.message;
    refreshButton.textContent = "Refresh failed";
  } finally {
    window.setTimeout(() => {
      refreshButton.textContent = originalLabel;
      refreshButton.disabled = false;
    }, options.initial ? 900 : 1400);
  }
}

async function sendAgentMessage(message) {
  appendMessage("user", message);
  appendMessage("agent", "Checking the opportunity records...");
  setChatBusy(true);

  try {
    const response = await fetch("/agent/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message })
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Agent request failed.");
    }

    replaceLastAgentMessage(result.reply || "Done.");
    updateOpportunityState(result.opportunities || opportunities);
  } catch (error) {
    replaceLastAgentMessage(error.message);
  } finally {
    setChatBusy(false);
  }
}

async function loadRuntimeStatus() {
  try {
    const [runtimeResponse, syncResponse] = await Promise.all([
      fetch("/runtime-status", { cache: "no-store" }),
      fetch("/sync/status", { cache: "no-store" })
    ]);
    const status = await runtimeResponse.json();
    const sync = await syncResponse.json();

    usdToInrRate = Number(status.display?.usdToInrRate || usdToInrRate);
    runtimeStatusText.textContent = "Opportunities ready";
    mailboxStatusText.textContent = status.mailbox.secureAuthConfigured
      ? `Gmail connected: ${status.mailbox.address}`
      : `Gmail pending: ${status.mailbox.address || "not configured"}`;
    syncStatusText.textContent = formatSyncStatus(sync);
  } catch {
    runtimeStatusText.textContent = "Runtime unavailable";
    mailboxStatusText.textContent = "Gmail status unavailable";
    syncStatusText.textContent = "Sync status unavailable";
  }
}

async function loadWhatsAppStatus() {
  try {
    const response = await fetch(`/whatsapp/status?refresh=${Date.now()}`, {
      cache: "no-store"
    });
    const status = await response.json();
    if (!response.ok) {
      throw new Error(status.error || "WhatsApp status unavailable.");
    }
    updateWhatsAppStatus(status);
  } catch (error) {
    whatsappStatusText.textContent = "WhatsApp status unavailable";
    whatsappLoginStatus.textContent = error.message;
    whatsappScanButton.disabled = true;
  }
}

async function startWhatsAppLogin() {
  await runWhatsAppAction({
    button: whatsappStartButton,
    busyLabel: "Starting",
    request: () =>
      fetch("/whatsapp/start", {
        method: "POST"
      }),
    success: (status) =>
      !status.enabled
        ? "WhatsApp QR login is disabled in this deployment."
        : status.ready
        ? "WhatsApp is connected."
        : status.hasQr
          ? "QR code is ready."
          : "WhatsApp login is starting."
  });
  startWhatsAppPolling();
}

async function scanWhatsAppMessages() {
  await runWhatsAppAction({
    button: whatsappScanButton,
    busyLabel: "Scanning",
    request: () =>
      fetch("/whatsapp/sync", {
        method: "POST"
      }),
    success: (status) => {
      const processed = status.processed ?? status.sync?.lastProcessed ?? 0;
      const matched = status.matched ?? status.sync?.lastMatched ?? 0;
      return `WhatsApp scan complete: ${matched} matched, ${processed} processed.`;
    },
    afterSuccess: async (status) => {
      if (status.opportunities?.length) {
        updateOpportunityState(status.opportunities);
      }
      await loadOpportunities();
    }
  });
}

async function runWhatsAppAction({ button, busyLabel, request, success, afterSuccess }) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = busyLabel;
  whatsappActionStatus.textContent = "";

  try {
    const response = await request();
    const result = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(result.error || result.message || "WhatsApp action failed.");
    }

    updateWhatsAppStatus(result);
    whatsappActionStatus.textContent = typeof success === "function" ? success(result) : success;
    await afterSuccess?.(result);
  } catch (error) {
    whatsappActionStatus.textContent = error.message;
    await loadWhatsAppStatus();
  } finally {
    button.textContent = original;
    button.disabled =
      (button === whatsappScanButton && !whatsappStatus?.ready) ||
      (button === whatsappStartButton && Boolean(whatsappStatus?.starting));
  }
}

function updateWhatsAppStatus(status) {
  whatsappStatus = status;
  const sync = status.sync || {};
  const statusLabel = formatWhatsAppConnection(status);

  whatsappStatusText.textContent = `WhatsApp: ${statusLabel}`;
  whatsappLoginStatus.textContent = formatWhatsAppLoginStatus(status);
  whatsappScanStatus.textContent = formatWhatsAppScanStatus(status);
  whatsappScanButton.disabled = !status.ready || sync.running;
  whatsappStartButton.disabled = !status.enabled || status.starting;

  kpis.whatsappConnection.textContent = statusLabel;
  kpis.whatsappScanned.textContent = String(sync.lastScannedMessages || 0);
  kpis.whatsappMatched.textContent = String(sync.lastMatched || 0);
  kpis.whatsappProcessed.textContent = String(sync.lastProcessed || 0);

  if (status.qrDataUrl) {
    whatsappQrImage.src = status.qrDataUrl;
    whatsappQrImage.hidden = false;
    whatsappQrPlaceholder.hidden = true;
  } else {
    whatsappQrImage.removeAttribute("src");
    whatsappQrImage.hidden = true;
    whatsappQrPlaceholder.hidden = false;
    whatsappQrPlaceholder.textContent = status.ready ? "Connected" : "No QR code yet";
  }

  renderDefinitionList(whatsappMetaList, [
    ["Search", (status.search?.terms || []).join(", ") || "-"],
    ["Chat limit", status.search?.chatLimit || "-"],
    ["Messages per chat", status.search?.lookbackLimit || "-"],
    ["Last ready", formatDateTime(status.lastReadyAt)]
  ]);
  renderWhatsAppMatches();
}

function renderWhatsAppMatches() {
  const matches = filterWhatsAppMatches(whatsappStatus?.sync?.lastMatches || []);
  whatsappEmptyState.hidden = matches.length > 0;
  whatsappTableBody.innerHTML = matches.map(renderWhatsAppMatchRow).join("");
}

function renderWhatsAppMatchRow(match) {
  return `
    <tr class="record-row" data-record-id="${escapeHtml(match.recordId || "")}">
      <td>
        <strong>${escapeHtml(match.chatName || "WhatsApp chat")}</strong>
        <span>${escapeHtml(formatDateTime(match.receivedAt))}</span>
      </td>
      <td>${escapeHtml(match.preview || "-")}</td>
      <td>
        <strong>${escapeHtml((match.matchedTerms || []).join(", ") || "Rule match")}</strong>
        <span>${escapeHtml((match.reasons || []).join(" · "))}</span>
      </td>
      <td>
        <strong>${escapeHtml(match.opportunityName || "Processed opportunity")}</strong>
        <span>${escapeHtml(match.recordId ? "Open record" : "No record")}</span>
      </td>
    </tr>
  `;
}

function filterWhatsAppMatches(matches) {
  if (!whatsappQuery) {
    return matches;
  }
  return matches.filter((match) =>
    [
      match.chatName,
      match.preview,
      match.opportunityName,
      match.product,
      match.customer,
      ...(match.matchedTerms || []),
      ...(match.reasons || [])
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(whatsappQuery)
  );
}

function handleWhatsAppTableClick(event) {
  const row = event.target.closest(".record-row");
  const recordId = row?.dataset.recordId;
  if (recordId) {
    openRecord(recordId, "whatsapp-view");
  }
}

function startWhatsAppPolling() {
  window.clearTimeout(whatsappPollTimer);
  let attempts = 0;
  const poll = async () => {
    attempts += 1;
    await loadWhatsAppStatus();
    const activeStatus = whatsappStatus?.status;
    if (attempts < 80 && ["starting", "loading", "qr", "authenticated"].includes(activeStatus)) {
      whatsappPollTimer = window.setTimeout(poll, 2500);
    }
  };
  whatsappPollTimer = window.setTimeout(poll, 1200);
}

async function loadOpportunities() {
  try {
    const response = await fetch(`/opportunities?limit=100&refresh=${Date.now()}`, {
      cache: "no-store"
    });
    const result = await response.json();
    updateOpportunityState(result.opportunities || []);
  } catch {
    updateOpportunityState([]);
  }
}

function updateOpportunityState(records) {
  opportunities = records.map(normalizeApprovalRecord);
  renderAll();
}

function renderAll() {
  updateKpis();
  renderCharts();
  renderTables();
  if (selectedRecordId) {
    renderRecordPage(selectedRecordId);
  }
}

function updateKpis() {
  const approvalRecords = getApprovalRecords();
  const reviewRecords = getReviewRecords();
  const approvedRecords = getApprovedRecords();

  kpis.pending.textContent = String(approvalRecords.length);
  kpis.review.textContent = String(reviewRecords.length);
  kpis.preApproved.textContent = String(approvalRecords.filter((record) => getApprovalTag(record) === "pre_approved").length);
  kpis.needsReview.textContent = String(approvalRecords.filter((record) => getApprovalTag(record) === "needs_review").length);
  kpis.reviewWaiting.textContent = String(reviewRecords.length);
  kpis.approved.textContent = String(approvedRecords.length);
  kpis.reviewValue.textContent = formatInr(sumInrValue(reviewRecords));
  kpis.approvedValue.textContent = formatInr(sumInrValue(approvedRecords));
}

function renderTables() {
  const approvalRecords = filterRecords(getApprovalRecords(), approvalQuery);
  const reviewRecords = filterRecords(getReviewRecords(), reviewQuery);
  const approvedRecords = filterRecords(getApprovedRecords(), approvedQuery);

  approvalEmptyState.hidden = approvalRecords.length > 0;
  reviewEmptyState.hidden = reviewRecords.length > 0;
  approvedEmptyState.hidden = approvedRecords.length > 0;

  approvalTableBody.innerHTML = approvalRecords.map(renderApprovalRow).join("");
  reviewTableBody.innerHTML = reviewRecords.map(renderReviewRow).join("");
  approvedTableBody.innerHTML = approvedRecords.map(renderApprovedRow).join("");
}

function renderApprovalRow(record) {
  const opportunity = record.opportunity;
  return `
    <tr class="record-row" data-id="${escapeHtml(record.id)}">
      <td>
        <strong>${escapeHtml(getDisplayCustomerName(record))}</strong>
        <span>${escapeHtml(opportunity.request.customerPurchaseOrderReference || "No reference")}</span>
      </td>
      <td>${escapeHtml(opportunity.request.product || "Unknown product")}</td>
      <td>${escapeHtml(formatQuantity(opportunity))}</td>
      <td>${escapeHtml(formatMoney(opportunity.commercial.totalValue, opportunity.commercial.currency))}</td>
      <td>${renderTagSelect(record)}</td>
      <td>
        <div class="row-actions">
          <button class="primary compact" type="button" data-action="accept" data-id="${escapeHtml(record.id)}">Accept</button>
          <button class="danger compact" type="button" data-action="reject" data-id="${escapeHtml(record.id)}">Reject</button>
        </div>
      </td>
    </tr>
  `;
}

function renderReviewRow(record) {
  const opportunity = record.opportunity;
  return `
    <tr class="record-row" data-id="${escapeHtml(record.id)}">
      <td>
        <strong>${escapeHtml(getDisplayCustomerName(record))}</strong>
        <span>${escapeHtml(opportunity.request.customerPurchaseOrderReference || "No reference")}</span>
      </td>
      <td>${escapeHtml(opportunity.request.product || "Unknown product")}</td>
      <td>${escapeHtml(formatQuantity(opportunity))}</td>
      <td>${escapeHtml(formatMoney(opportunity.commercial.totalValue, opportunity.commercial.currency))}</td>
      <td>${renderTag(getApprovalTag(record))}</td>
      <td>
        <div class="row-actions">
          <button class="primary compact" type="button" data-action="approve" data-id="${escapeHtml(record.id)}">Approve</button>
          <button class="danger compact" type="button" data-action="reject" data-id="${escapeHtml(record.id)}">Reject</button>
        </div>
      </td>
    </tr>
  `;
}

function renderApprovedRow(record) {
  const opportunity = record.opportunity;
  return `
    <tr class="record-row" data-id="${escapeHtml(record.id)}">
      <td>
        <strong>${escapeHtml(getDisplayCustomerName(record))}</strong>
        <span>${escapeHtml(opportunity.request.customerPurchaseOrderReference || "No reference")}</span>
      </td>
      <td>${escapeHtml(opportunity.request.product || "Unknown product")}</td>
      <td>${escapeHtml(formatQuantity(opportunity))}</td>
      <td>${escapeHtml(formatMoney(opportunity.commercial.totalValue, opportunity.commercial.currency))}</td>
      <td>${renderTag(getApprovalTag(record))}</td>
      <td>${renderApprovedStatus(record)}</td>
    </tr>
  `;
}

function renderTagSelect(record) {
  const tag = getApprovalTag(record);
  return `
    <select class="row-tag-select" data-action="tag" data-id="${escapeHtml(record.id)}" aria-label="Record tag">
      <option value="pre_approved" ${tag === "pre_approved" ? "selected" : ""}>Pre-approved</option>
      <option value="needs_review" ${tag === "needs_review" ? "selected" : ""}>Needs review</option>
    </select>
  `;
}

function handleApprovalTableClick(event) {
  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    event.stopPropagation();
    if (actionButton.dataset.action === "accept") {
      const tag = actionButton.closest("tr")?.querySelector(".row-tag-select")?.value;
      acceptRecord(actionButton.dataset.id, actionButton, tag);
    } else if (actionButton.dataset.action === "reject") {
      rejectRecord(actionButton.dataset.id, actionButton);
    }
    return;
  }

  const row = event.target.closest(".record-row");
  if (row) {
    openRecord(row.dataset.id, "approval-view");
  }
}

function handleTableTagChange(event) {
  const select = event.target.closest("[data-action='tag']");
  if (!select) {
    return;
  }
  event.stopPropagation();
  updateRecordTag(select.dataset.id, select.value, null);
}

function handleReviewTableClick(event) {
  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    event.stopPropagation();
    if (actionButton.dataset.action === "approve") {
      approveRecord(actionButton.dataset.id, actionButton);
    } else if (actionButton.dataset.action === "reject") {
      rejectRecord(actionButton.dataset.id, actionButton);
    }
    return;
  }

  const row = event.target.closest(".record-row");
  if (row) {
    openRecord(row.dataset.id, "review-view");
  }
}

function handleApprovedTableClick(event) {
  const row = event.target.closest(".record-row");
  if (row) {
    openRecord(row.dataset.id, "review-view");
  }
}

async function acceptRecord(recordId, button, tag) {
  await runRowAction({
    button,
    busyLabel: "Accepting",
    request: () =>
      fetch(`/opportunities/${encodeURIComponent(recordId)}/accept`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ tag })
      }),
    success: "Opportunity accepted for review."
  });
}

async function approveRecord(recordId, button) {
  await runRowAction({
    button,
    busyLabel: "Approving",
    request: () =>
      fetch(`/opportunities/${encodeURIComponent(recordId)}/approve`, {
        method: "POST"
      }),
    success: "Opportunity approved and moved to the approved list."
  });
}

async function rejectRecord(recordId, button) {
  await runRowAction({
    button,
    busyLabel: "Rejecting",
    request: () =>
      fetch(`/opportunities/${encodeURIComponent(recordId)}/reject`, {
        method: "POST"
      }),
    success: "Opportunity rejected and hidden."
  });
}

async function runRowAction({ button, busyLabel, request, success }) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = busyLabel;
  setActionStatus("");

  try {
    const response = await request();
    const result = await readJsonResponse(response);
    if (!response.ok || !result.ok) {
      throw new Error(result.message || result.error || "Action failed.");
    }

    setActionStatus(success);
    await loadOpportunities();
  } catch (error) {
    setActionStatus(error.message);
  } finally {
    button.textContent = original;
    button.disabled = false;
  }
}

function openRecord(recordId, sourceView) {
  selectedRecordId = recordId;
  lastDashboardView = sourceView || lastDashboardView;
  renderRecordPage(recordId);
  setView("record-view");
}

function renderRecordPage(recordId) {
  const record = opportunities.find((item) => item.id === recordId && !isRejected(item));
  if (!record) {
    recordHeading.textContent = "Opportunity detail";
    recordBanner.innerHTML = `<span class="decision-label">Opportunity</span><strong>Select a record from the dashboard.</strong>`;
    renderDefinitionList(recordCustomerList, []);
    renderDefinitionList(recordPoList, []);
    renderDefinitionList(recordCommercialList, []);
    renderDefinitionList(recordFulfillmentList, []);
    recordEmailBody.textContent = "No email selected.";
    recordTagSelect.disabled = true;
    recordTagStatus.textContent = "";
    return;
  }

  const opportunity = record.opportunity;
  const approval = record.approval;
  const fulfillment = getFulfillmentView(record);
  recordHeading.textContent = opportunity.request.customerPurchaseOrderReference || opportunity.request.product || "Opportunity detail";
  recordBanner.innerHTML = `
    <span class="decision-label">${escapeHtml(formatStatus(approval.status))}</span>
    <strong>${escapeHtml(getDisplayCustomerName(record))} - ${escapeHtml(opportunity.request.product || "Unknown product")}</strong>
  `;
  recordTagSelect.disabled = isApproved(record);
  recordTagSelect.value = approval.tag;
  recordTagStatus.textContent = isApproved(record) ? "Approved records keep their final tag." : "";

  renderDefinitionList(recordCustomerList, [
    ["Customer", getDisplayCustomerName(record)]
  ]);

  renderDefinitionList(recordPoList, [
    ["PO reference", opportunity.request.customerPurchaseOrderReference || "-"],
    ["Product", opportunity.request.product],
    ["Quantity", formatQuantity(opportunity)]
  ]);

  renderDefinitionList(recordCommercialList, [
    ["Requested value", formatMoney(opportunity.commercial.totalValue, opportunity.commercial.currency)],
    ["Unit price", `${formatMoney(opportunity.request.targetPrice, opportunity.request.currency)} / ${opportunity.request.unit || "unit"}`],
    ["Price check", fulfillment.priceCheck]
  ]);

  renderDefinitionList(recordFulfillmentList, [
    ["Current status", formatStatus(approval.status)],
    ["Key factor", getDecisionFactor(record, fulfillment)],
    ["Next step", fulfillment.nextAction]
  ]);

  recordEmailBody.textContent = record.extracted?.rawSummary || "No email text stored.";
}

function renderCharts() {
  const activeRecords = opportunities.filter((record) => !isRejected(record));
  renderValueChart({
    rows: groupValueRows(activeRecords, getDisplayCustomerName),
    mode: chartState.customer.mode,
    visualTarget: customerVisual,
    listTarget: customerChartList
  });
  renderValueChart({
    rows: groupValueRows(activeRecords, (record) => record.opportunity?.request?.product || "Unknown product"),
    mode: chartState.product.mode,
    visualTarget: productVisual,
    listTarget: productChartList
  });
}

function groupValueRows(records, mapper) {
  const grouped = new Map();
  records.forEach((record) => {
    const label = mapper(record) || "Unknown";
    grouped.set(
      label,
      (grouped.get(label) || 0) +
        inrValueOrZero(record.opportunity?.commercial?.totalValue, record.opportunity?.commercial?.currency)
    );
  });
  return [...grouped.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
}

function renderValueChart({ rows, mode, visualTarget, listTarget }) {
  if (!rows.length) {
    visualTarget.innerHTML = `<p class="chart-empty">No chart data yet.</p>`;
    listTarget.innerHTML = "";
    return;
  }

  const total = rows.reduce((sum, row) => sum + row.value, 0) || 1;
  if (mode === "pie") {
    let current = 0;
    const stops = rows
      .map((row, index) => {
        const start = current;
        current += (row.value / total) * 360;
        return `${chartColors[index % chartColors.length]} ${start}deg ${current}deg`;
      })
      .join(", ");
    visualTarget.innerHTML = `<span class="pie-chart large" style="background: conic-gradient(${stops})"></span>`;
  } else {
    const max = Math.max(...rows.map((row) => row.value), 1);
    visualTarget.innerHTML = `
      <div class="bar-visual labeled">
        ${rows
          .map((row, index) => {
            const height = Math.max(6, (row.value / max) * 100);
            return `<span title="${escapeHtml(row.label)}" style="height:${height}%; background:${chartColors[index % chartColors.length]}"></span>`;
          })
          .join("")}
      </div>
    `;
  }

  listTarget.innerHTML = rows
    .map((row, index) => {
      const percentage = Math.round((row.value / total) * 100);
      return `
        <div class="chart-key-row">
          <i style="background:${chartColors[index % chartColors.length]}"></i>
          <span>${escapeHtml(row.label)}</span>
          <strong>${escapeHtml(formatInr(row.value))}</strong>
          <em>${percentage}%</em>
        </div>
      `;
    })
    .join("");
}

function setChartMode(chart, mode) {
  chartState[chart].mode = mode;
  document.querySelectorAll(`.segmented button[data-chart="${chart}"]`).forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
  renderCharts();
}

async function updateRecordTag(recordId, tag, statusTarget) {
  if (!recordId) {
    return;
  }

  if (statusTarget) {
    statusTarget.textContent = "Saving tag...";
  }

  try {
    const response = await fetch(`/opportunities/${encodeURIComponent(recordId)}/tag`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ tag })
    });
    const result = await readJsonResponse(response);
    if (!response.ok || !result.ok) {
      throw new Error(result.message || result.error || "Tag update failed.");
    }

    setActionStatus("Record tag updated.");
    if (statusTarget) {
      statusTarget.textContent = "Tag saved.";
    }
    await loadOpportunities();
  } catch (error) {
    if (statusTarget) {
      statusTarget.textContent = error.message;
    } else {
      setActionStatus(error.message);
    }
  }
}

function getApprovalRecords() {
  return opportunities.filter((record) => getWorkflowStatus(record) === "pending");
}

function getReviewRecords() {
  return opportunities.filter((record) => getWorkflowStatus(record) === "review");
}

function getApprovedRecords() {
  return opportunities.filter(isApproved);
}

function normalizeApprovalRecord(record) {
  const tag = getApprovalTag(record);
  const status = getWorkflowStatus(record);
  return {
    ...record,
    approval: {
      ...(record.approval || {}),
      tag,
      status,
      message: getWorkflowMessage(status, tag)
    }
  };
}

function filterRecords(records, query) {
  if (!query) {
    return records;
  }
  return records.filter((record) => getSearchText(record).includes(query));
}

function getSearchText(record) {
  return [
    getDisplayCustomerName(record),
    record.opportunity?.request?.customerPurchaseOrderReference,
    record.opportunity?.request?.product,
    formatTag(getApprovalTag(record)),
    record.extracted?.source?.subject
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getApprovalTag(record) {
  const explicitTag = String(record.approval?.tag || "").toLowerCase();
  if (explicitTag === "pre_approved" || explicitTag === "needs_review") {
    return explicitTag;
  }
  const reasons = record.decision?.reasons || record.opportunity?.ruleDecision?.reasons || [];
  return isProductUnknown(record) || reasons.length ? "needs_review" : "pre_approved";
}

function getWorkflowStatus(record) {
  const explicitStatus = String(record.approval?.status || "").toLowerCase();
  if (["pending", "review", "approved", "rejected"].includes(explicitStatus)) {
    return explicitStatus;
  }
  const storageStatus = String(record.sapStorage?.status || "").toLowerCase();
  if (storageStatus === "stored") {
    return "approved";
  }
  if (storageStatus === "rejected") {
    return "rejected";
  }
  return "pending";
}

function isApproved(record) {
  return getWorkflowStatus(record) === "approved";
}

function isRejected(record) {
  return getWorkflowStatus(record) === "rejected";
}

function isProductUnknown(record) {
  const product = String(record.opportunity?.request?.product || record.extracted?.request?.product || "").trim();
  return !product || /^unknown product$/i.test(product);
}

function getFulfillmentView(record) {
  const reasons = (record.decision?.reasons || []).filter((reason) => !/product is not configured/i.test(reason));
  const priceCheck = getPriceCheck(record);
  const status = getWorkflowStatus(record);
  if (status === "pending") {
    return {
      summary: "Waiting for first approval",
      nextAction: "Choose a tag, then Accept to move it into Review.",
      priceCheck
    };
  }
  if (status === "review") {
    return {
      summary: "Ready for final review",
      nextAction: "Approve to store it in the approved list, or reject to ignore it.",
      priceCheck
    };
  }
  if (status === "approved") {
    return {
      summary: "Approved",
      nextAction: "No further dashboard action is required.",
      priceCheck
    };
  }
  if (isProductUnknown(record)) {
    return {
      summary: "Product details are missing",
      nextAction: "Complete the product details before final approval.",
      priceCheck
    };
  }
  if (!reasons.length) {
    return {
      summary: "Ready",
      nextAction: "Proceed with the next dashboard action.",
      priceCheck
    };
  }
  return {
    summary: "Needs business review",
    nextAction: getNextAction(reasons),
    priceCheck
  };
}

function getDecisionFactor(record, fulfillment) {
  const status = getWorkflowStatus(record);
  const tag = getApprovalTag(record);
  const reasons = (record.decision?.reasons || [])
    .filter((reason) => !/product is not configured/i.test(reason))
    .map(cleanDecisionReason)
    .filter(Boolean);

  if (status === "approved") {
    return "Approved for the opportunity list.";
  }
  if (status === "review") {
    return tag === "pre_approved" ? "Pre-approved tag selected." : "Needs review tag selected.";
  }
  if (isProductUnknown(record)) {
    return "Product name is missing.";
  }
  if (reasons.length) {
    return reasons[0];
  }
  if (fulfillment.priceCheck === "Above configured floor") {
    return "Price is above the configured floor.";
  }
  return fulfillment.summary;
}

function getPriceCheck(record) {
  const minPrice = record.decision?.commercial?.effectiveMinPrice;
  const target = record.opportunity?.request?.targetPrice;
  const currency = record.opportunity?.request?.currency;
  if (!Number.isFinite(Number(target))) {
    return "Unit price unavailable";
  }
  if (!Number.isFinite(Number(minPrice))) {
    return "No price floor configured";
  }
  const targetInr = toInrValue(target, currency);
  return targetInr >= minPrice ? "Above configured floor" : "Below configured floor";
}

function getNextAction(reasons) {
  const text = reasons.join(" ").toLowerCase();
  if (text.includes("customer")) {
    return "Confirm the customer record before approval.";
  }
  if (text.includes("currency") || text.includes("minimum")) {
    return "Validate rupee pricing before approval.";
  }
  if (text.includes("quantity") || text.includes("total value")) {
    return "Check capacity and approval limits before accepting.";
  }
  return "Check business readiness before approval.";
}

function cleanDecisionReason(reason) {
  return String(reason || "")
    .trim()
    .replace(/[.]+$/, "")
    .replace(/requires business partner review/i, "needs customer approval")
    .replace(/needs review/i, "needs checking");
}

function renderTag(tag) {
  return `<span class="tag-pill ${tag === "pre_approved" ? "pre-approved" : "needs-review"}">${escapeHtml(formatTag(tag))}</span>`;
}

function renderApprovedStatus(record) {
  return `<span class="status-pill stored">Approved</span>`;
}

function formatSapStatus(record) {
  const status = getWorkflowStatus(record);
  if (status === "approved") {
    return "Approved";
  }
  if (status === "review") {
    return "Waiting for final review";
  }
  if (status === "rejected") {
    return "Rejected";
  }

  return "Waiting for approval";
}

function formatStatus(status) {
  if (status === "review") {
    return "In review";
  }
  if (status === "approved") {
    return "Approved";
  }
  if (status === "rejected") {
    return "Rejected";
  }
  return "New opportunity";
}

function getWorkflowMessage(status, tag) {
  if (status === "review") {
    return "Accepted for review.";
  }
  if (status === "approved") {
    return "Approved.";
  }
  if (status === "rejected") {
    return "Rejected and hidden.";
  }
  return tag === "pre_approved" ? "Rulebook checks passed." : "Business review is needed before approval.";
}

function formatTag(tag) {
  return tag === "pre_approved" ? "Pre-approved" : "Needs review";
}

function setActionStatus(message) {
  actionStatus.textContent = message || "";
}

function appendMessage(role, text) {
  const message = document.createElement("article");
  message.className = `message ${role}`;
  message.textContent = text;
  messageList.appendChild(message);
  messageList.scrollTop = messageList.scrollHeight;
}

function replaceLastAgentMessage(text) {
  const messages = [...messageList.querySelectorAll(".message.agent")];
  const last = messages[messages.length - 1];
  if (last) {
    last.textContent = text;
  } else {
    appendMessage("agent", text);
  }
  messageList.scrollTop = messageList.scrollHeight;
}

function setChatBusy(isBusy) {
  chatSendButton.disabled = isBusy;
}

function renderDefinitionList(target, rows) {
  target.innerHTML = rows
    .map(
      ([term, value]) => `
        <div>
          <dt>${escapeHtml(term)}</dt>
          <dd>${escapeHtml(String(value ?? "-"))}</dd>
        </div>
      `
    )
    .join("");
}

function formatSyncStatus(sync) {
  if (sync.running) {
    return "Gmail sync running";
  }
  if (sync.lastError) {
    return `Last sync issue: ${sync.lastError}`;
  }
  if (sync.lastFinishedAt) {
    return `Auto sync active: ${sync.lastProcessed || 0} processed`;
  }
  return sync.autoSyncEnabled ? "Auto sync active" : "Auto sync disabled";
}

function formatWhatsAppConnection(status) {
  const value = String(status?.status || "idle").toLowerCase();
  if (status?.ready) {
    return "Connected";
  }
  if (value === "qr") {
    return "QR ready";
  }
  if (value === "authenticated") {
    return "Authenticating";
  }
  if (value === "starting" || value === "loading") {
    return "Starting";
  }
  if (value === "auth_failed") {
    return "Auth failed";
  }
  if (value === "disconnected") {
    return "Disconnected";
  }
  if (value === "disabled") {
    return "Disabled";
  }
  if (value === "error") {
    return "Error";
  }
  return "Not started";
}

function formatWhatsAppLoginStatus(status) {
  if (status && !status.enabled) {
    return "WhatsApp QR login is disabled on this serverless deployment. Run locally or on a persistent Node host to scan WhatsApp.";
  }
  if (status?.lastError) {
    return status.lastError;
  }
  if (status?.ready) {
    return "WhatsApp is connected.";
  }
  if (status?.qrDataUrl) {
    return "QR code is ready.";
  }
  if (status?.loading?.message) {
    return `${status.loading.message} ${status.loading.percent || 0}%`;
  }
  if (status?.starting) {
    return "Starting WhatsApp login.";
  }
  return "Start the login session to create a QR code.";
}

function formatWhatsAppScanStatus(status) {
  if (status && !status.enabled) {
    return "WhatsApp scanning is unavailable while WHATSAPP_ENABLED=false.";
  }
  const sync = status?.sync || {};
  if (sync.running) {
    return "WhatsApp scan running.";
  }
  if (sync.lastError) {
    return `Last scan issue: ${sync.lastError}`;
  }
  if (sync.lastFinishedAt) {
    return `${sync.lastMatched || 0} matched from ${sync.lastScannedMessages || 0} messages.`;
  }
  return "No WhatsApp scan has run yet.";
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function getDisplayCustomerName(record) {
  const existingName = record.opportunity?.customer?.name || record.customer?.name || record.extracted?.customer?.name;
  if (existingName && !/^gmail$/i.test(existingName)) {
    return existingName;
  }

  const text = `${record.extracted?.source?.subject || ""}\n${record.extracted?.rawSummary || ""}`;
  const bodyCustomer = text.match(/\bPurchase Order\s+PO-[A-Z0-9-]+\s+from\s+(.+?)(?:\s+for\b|\.|\r|\n)/i);
  if (bodyCustomer) {
    return titleCase(bodyCustomer[1].trim());
  }

  const subjectCustomer = text.match(/\bPurchase Order(?:\s+Issued|\s+Attached)?:\s*PO-[A-Z0-9-]+(?:\s*[-|]\s*)([^\r\n]+)/i);
  if (subjectCustomer) {
    return titleCase(subjectCustomer[1].trim());
  }

  return existingName || "Unknown customer";
}

function formatQuantity(opportunity) {
  return `${formatNumber(opportunity.request.quantity)} ${opportunity.request.unit || ""}`.trim();
}

function sumInrValue(records) {
  return records.reduce(
    (sum, record) => sum + inrValueOrZero(record.opportunity?.commercial?.totalValue, record.opportunity?.commercial?.currency),
    0
  );
}

function formatMoney(value, currency) {
  const inrValue = toInrValue(value, currency);
  if (!Number.isFinite(inrValue)) {
    return "-";
  }
  return formatInr(inrValue);
}

function inrValueOrZero(value, currency = "INR") {
  const inrValue = toInrValue(value, currency);
  return Number.isFinite(inrValue) ? inrValue : 0;
}

function formatInr(value) {
  if (!Number.isFinite(Number(value))) {
    return "-";
  }
  return `₹${Math.round(Number(value)).toLocaleString("en-IN")}`;
}

function toInrValue(value, currency = "INR") {
  if (value === null || value === undefined || value === "") {
    return NaN;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return NaN;
  }
  return String(currency || "INR").toUpperCase() === "USD" ? number * usdToInrRate : number;
}

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }
  return Number(value).toLocaleString("en-IN");
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {
      error: text || "Unexpected server response."
    };
  }
}

function titleCase(value) {
  return String(value || "").replace(/\w\S*/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const replacements = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return replacements[character];
  });
}
