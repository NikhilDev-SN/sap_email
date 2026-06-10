import { getHanaStorageReadiness } from "../config.mjs";
import { needsManualProduct, prepareApprovalRecord } from "../domain/approvalWorkflow.mjs";
import { processInquiry } from "../pipeline.mjs";
import { saveRecordToHana } from "../storage/hanaOpportunityStore.mjs";
import { saveOpportunityRecord, saveOpportunitySnapshot } from "../storage/opportunityStore.mjs";
import { fetchGmailInquiryEmails } from "./gmailClient.mjs";

export { needsManualProduct };

const syncState = {
  running: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastError: null,
  lastFetched: 0,
  lastProcessed: 0,
  lastStoredToSap: 0,
  lastTrigger: null
};

export function getMailSyncStatus(config) {
  const hanaReadiness = getHanaStorageReadiness({
    ...config,
    opportunityStoreBackend: "hana"
  });

  return {
    ...syncState,
    autoSyncEnabled: Boolean(config.gmailAutoSyncEnabled),
    autoSyncIntervalMs: config.gmailAutoSyncIntervalMs,
    mailbox: config.mailboxAddress,
    query: config.gmailSyncQuery,
    sapStorageReady: hanaReadiness.ready,
    sapStorageMessage: hanaReadiness.ready
      ? "SAP approval handoff is ready."
      : "SAP approval handoff is waiting for connection settings."
  };
}

export function startAutomaticMailSync(config) {
  if (!config.gmailAutoSyncEnabled || !config.gmailSecureAuthConfigured) {
    return {
      started: false,
      reason: "Gmail auto sync is disabled or Gmail is not connected."
    };
  }

  const run = () => {
    syncMailOpportunities(config, { trigger: "auto" }).catch(() => {
      // The latest error is captured in syncState for the UI.
    });
  };

  const initialDelay = setTimeout(run, 2500);
  const interval = setInterval(run, Math.max(15000, config.gmailAutoSyncIntervalMs || 60000));
  initialDelay.unref?.();
  interval.unref?.();

  return {
    started: true,
    interval
  };
}

export async function syncMailOpportunities(config, options = {}) {
  if (syncState.running) {
    return {
      ...getMailSyncStatus(config),
      skipped: true,
      message: "A Gmail sync is already running."
    };
  }

  syncState.running = true;
  syncState.lastStartedAt = new Date().toISOString();
  syncState.lastTrigger = options.trigger || "manual";
  syncState.lastError = null;

  try {
    const emails = await fetchGmailInquiryEmails(config);
    const records = [];
    let readyForApproval = 0;

    for (const email of emails) {
      const result = await processInquiry(email, config);
      const record = await saveOpportunityRecord(result);
      const finalRecord = await saveOpportunitySnapshot(prepareApprovalRecord(record), {
        backend: config.opportunityStoreBackend
      });
      if (finalRecord.approval?.status === "pending") {
        readyForApproval += 1;
      }
      records.push(finalRecord);
    }

    syncState.lastFetched = emails.length;
    syncState.lastProcessed = records.length;
    syncState.lastStoredToSap = 0;
    syncState.lastFinishedAt = new Date().toISOString();

    return {
      ...getMailSyncStatus(config),
      fetched: emails.length,
      processed: records.length,
      readyForApproval,
      storedToSap: 0,
      opportunities: records
    };
  } catch (error) {
    syncState.lastError = cleanErrorMessage(error);
    syncState.lastFinishedAt = new Date().toISOString();
    throw error;
  } finally {
    syncState.running = false;
  }
}

export async function storeRecordInSapHana(record, config) {
  if (needsManualProduct(record)) {
    return saveOpportunitySnapshot(
      {
        ...record,
        sapStorage: {
          status: "needs_product",
          checkedAt: new Date().toISOString(),
          message: "Product needs manual definition before storage."
        }
      },
      { backend: config.opportunityStoreBackend }
    );
  }

  const readiness = getHanaStorageReadiness({
    ...config,
    opportunityStoreBackend: "hana"
  });

  if (!readiness.ready) {
    return saveOpportunitySnapshot(
      {
        ...record,
        sapStorage: {
          status: "pending",
          checkedAt: new Date().toISOString(),
          message: "Waiting for SAP HANA storage to be ready.",
          missing: readiness.missing,
          errors: readiness.errors
        }
      },
      { backend: config.opportunityStoreBackend }
    );
  }

  try {
    const withStorageStatus = {
      ...record,
      sapStorage: {
        status: "stored",
        savedAt: new Date().toISOString(),
        message: "Approved and sent to SAP."
      }
    };
    const saved = await saveRecordToHana(withStorageStatus);
    return saveOpportunitySnapshot(saved, { backend: config.opportunityStoreBackend });
  } catch (error) {
    return saveOpportunitySnapshot(
      {
        ...record,
        sapStorage: {
          status: "failed",
          checkedAt: new Date().toISOString(),
          message: cleanErrorMessage(error)
        }
      },
      { backend: config.opportunityStoreBackend }
    );
  }
}

function cleanErrorMessage(value) {
  return String(value?.message || value || "Unknown error")
    .replace(/pwd=([^,}\s]+)/gi, "pwd=[redacted]")
    .replace(/password=([^,}\s]+)/gi, "password=[redacted]")
    .replace(/clientsecret=([^,}\s]+)/gi, "clientsecret=[redacted]")
    .replace(/client_secret=[^&\s]+/gi, "client_secret=[redacted]");
}
