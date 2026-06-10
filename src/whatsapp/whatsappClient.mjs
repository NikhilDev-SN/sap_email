import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import QRCode from "qrcode";
import { prepareApprovalRecord } from "../domain/approvalWorkflow.mjs";
import { processInquiry } from "../pipeline.mjs";
import { saveOpportunityRecord, saveOpportunitySnapshot } from "../storage/opportunityStore.mjs";

const browserCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
];

const clientState = {
  client: null,
  initializePromise: null,
  starting: false,
  authenticated: false,
  ready: false,
  status: "idle",
  qrDataUrl: null,
  loading: null,
  lastQrAt: null,
  lastReadyAt: null,
  lastDisconnectedAt: null,
  lastError: null
};

const syncState = {
  running: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastError: null,
  lastScannedChats: 0,
  lastScannedMessages: 0,
  lastMatched: 0,
  lastProcessed: 0,
  lastReadyForApproval: 0,
  lastMatches: []
};

export function getWhatsAppStatus(config) {
  const enabled = Boolean(config.whatsappEnabled);

  return {
    enabled,
    status: enabled ? clientState.status : "disabled",
    starting: enabled ? clientState.starting : false,
    authenticated: enabled ? clientState.authenticated : false,
    ready: enabled ? clientState.ready : false,
    hasQr: enabled ? Boolean(clientState.qrDataUrl) : false,
    qrDataUrl: enabled ? clientState.qrDataUrl : null,
    loading: enabled ? clientState.loading : null,
    lastQrAt: clientState.lastQrAt,
    lastReadyAt: clientState.lastReadyAt,
    lastDisconnectedAt: clientState.lastDisconnectedAt,
    lastError: enabled ? clientState.lastError : "WhatsApp dashboard is disabled by WHATSAPP_ENABLED=false.",
    search: {
      terms: config.whatsappSearchTerms,
      chatLimit: config.whatsappChatLimit,
      lookbackLimit: config.whatsappLookbackLimit,
      processLimit: config.whatsappProcessLimit
    },
    sync: {
      ...syncState
    }
  };
}

export async function startWhatsAppClient(config) {
  if (!config.whatsappEnabled) {
    clientState.status = "disabled";
    clientState.lastError = "WhatsApp dashboard is disabled by WHATSAPP_ENABLED=false.";
    return getWhatsAppStatus(config);
  }

  if (clientState.client || clientState.starting) {
    return getWhatsAppStatus(config);
  }

  const { Client, LocalAuth } = await loadWhatsAppDependency();
  await mkdir(config.whatsappSessionPath, { recursive: true });

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: "sap-inquiry-ai-agent",
      dataPath: config.whatsappSessionPath
    }),
    puppeteer: buildPuppeteerOptions(config)
  });

  clientState.client = client;
  clientState.starting = true;
  clientState.ready = false;
  clientState.authenticated = false;
  clientState.status = "starting";
  clientState.lastError = null;
  clientState.qrDataUrl = null;
  clientState.loading = null;

  wireClientEvents(client);

  clientState.initializePromise = client.initialize().catch((error) => {
    clientState.status = "error";
    clientState.starting = false;
    clientState.ready = false;
    clientState.authenticated = false;
    clientState.lastError = cleanErrorMessage(error);
    clientState.client = null;
  });
  clientState.initializePromise.catch(() => {});

  return getWhatsAppStatus(config);
}

export async function disconnectWhatsAppClient(config) {
  const client = clientState.client;
  clientState.client = null;
  clientState.initializePromise = null;
  clientState.starting = false;
  clientState.authenticated = false;
  clientState.ready = false;
  clientState.status = "idle";
  clientState.qrDataUrl = null;
  clientState.loading = null;

  if (client) {
    await client.destroy().catch(() => {});
  }

  return getWhatsAppStatus(config);
}

export async function syncWhatsAppSalesOrderMessages(config) {
  if (syncState.running) {
    return {
      ...getWhatsAppStatus(config),
      skipped: true,
      message: "A WhatsApp scan is already running."
    };
  }

  if (!clientState.ready || !clientState.client) {
    throw new Error("WhatsApp is not connected. Start QR login and scan the QR code first.");
  }

  syncState.running = true;
  syncState.lastStartedAt = new Date().toISOString();
  syncState.lastError = null;

  try {
    const chats = await clientState.client.getChats();
    const selectedChats = chats.slice(0, Math.max(1, config.whatsappChatLimit || 30));
    const candidates = [];
    let scannedMessages = 0;

    for (const chat of selectedChats) {
      const messages = await fetchChatMessages(chat, config.whatsappLookbackLimit);
      scannedMessages += messages.length;

      for (const message of messages) {
        const match = isRelevantWhatsAppSalesOrderText(message.body || "", config.whatsappSearchTerms);
        if (match.matched) {
          candidates.push({
            chat,
            message,
            match
          });
        }
      }
    }

    const records = [];
    const matches = [];
    let readyForApproval = 0;

    for (const candidate of sortCandidates(candidates).slice(0, Math.max(1, config.whatsappProcessLimit || 20))) {
      const inquiry = buildWhatsAppInquiry(candidate.message, candidate.chat);
      const result = await processInquiry(inquiry, config);
      const record = await saveOpportunityRecord(result);
      const finalRecord = await saveOpportunitySnapshot(prepareApprovalRecord(record), {
        backend: config.opportunityStoreBackend
      });

      if (finalRecord.approval?.status === "pending") {
        readyForApproval += 1;
      }

      records.push(finalRecord);
      matches.push(summarizeMatch(candidate, finalRecord));
    }

    syncState.lastScannedChats = selectedChats.length;
    syncState.lastScannedMessages = scannedMessages;
    syncState.lastMatched = candidates.length;
    syncState.lastProcessed = records.length;
    syncState.lastReadyForApproval = readyForApproval;
    syncState.lastMatches = matches;
    syncState.lastFinishedAt = new Date().toISOString();
    syncState.running = false;

    return {
      ...getWhatsAppStatus(config),
      scannedChats: selectedChats.length,
      scannedMessages,
      matched: candidates.length,
      processed: records.length,
      readyForApproval,
      opportunities: records,
      matches
    };
  } catch (error) {
    syncState.lastError = cleanErrorMessage(error);
    syncState.lastFinishedAt = new Date().toISOString();
    throw error;
  } finally {
    syncState.running = false;
  }
}

export function isRelevantWhatsAppSalesOrderText(text, configuredTerms = []) {
  const normalized = normalizeSearchText(text);
  const matchedTerms = configuredTerms.filter((term) => {
    const normalizedTerm = normalizeSearchText(term);
    return normalizedTerm && normalized.includes(normalizedTerm);
  });

  const hasSalesOrderIntent =
    /\b(?:sales?\s*order|salesorder|s\.?\s*o\.?\s*(?:no\.?|number|#|:)?\s*[a-z0-9-]*|purchase\s*order|customer\s*po|po[-\s:#]?[a-z0-9-]+|rfq|quote|quotation|order\s+requirement)\b/i.test(
      normalized
    );
  const hasMiningContext =
    /\b(?:mining|minning|mine|minerals?|iron\s*ore|ore\s*fines|ore\s*lumps|coal|manganese|bauxite|pellets?)\b/i.test(
      normalized
    );
  const hasQuantity = /\b\d[\d,]*(?:\.\d+)?\s*(?:mt|tons?|tonnes?|metric\s*tons?)\b/i.test(normalized);

  const reasons = [
    ...matchedTerms.map((term) => `Matched configured term: ${term}`),
    hasSalesOrderIntent ? "Sales order intent" : "",
    hasMiningContext ? "Mining material context" : "",
    hasQuantity ? "Quantity mentioned" : ""
  ].filter(Boolean);

  return {
    matched: matchedTerms.length > 0 || (hasSalesOrderIntent && hasMiningContext) || (hasMiningContext && hasQuantity),
    matchedTerms,
    reasons
  };
}

function wireClientEvents(client) {
  client.on("qr", async (qr) => {
    clientState.status = "qr";
    clientState.starting = false;
    clientState.ready = false;
    clientState.qrDataUrl = await QRCode.toDataURL(qr, {
      margin: 1,
      width: 280,
      color: {
        dark: "#13212e",
        light: "#ffffff"
      }
    });
    clientState.lastQrAt = new Date().toISOString();
  });

  client.on("loading_screen", (percent, message) => {
    clientState.status = clientState.ready ? "ready" : "loading";
    clientState.loading = {
      percent,
      message
    };
  });

  client.on("authenticated", () => {
    clientState.status = "authenticated";
    clientState.authenticated = true;
    clientState.qrDataUrl = null;
  });

  client.on("auth_failure", (message) => {
    clientState.status = "auth_failed";
    clientState.starting = false;
    clientState.authenticated = false;
    clientState.ready = false;
    clientState.lastError = cleanErrorMessage(message);
  });

  client.on("ready", () => {
    clientState.status = "ready";
    clientState.starting = false;
    clientState.authenticated = true;
    clientState.ready = true;
    clientState.qrDataUrl = null;
    clientState.loading = null;
    clientState.lastReadyAt = new Date().toISOString();
  });

  client.on("disconnected", (reason) => {
    clientState.status = "disconnected";
    clientState.starting = false;
    clientState.authenticated = false;
    clientState.ready = false;
    clientState.qrDataUrl = null;
    clientState.loading = null;
    clientState.lastDisconnectedAt = new Date().toISOString();
    clientState.lastError = reason ? `Disconnected: ${reason}` : null;
    clientState.client = null;
    clientState.initializePromise = null;
  });
}

async function loadWhatsAppDependency() {
  try {
    const mod = await import("whatsapp-web.js");
    return mod.default || mod;
  } catch (error) {
    throw new Error(`WhatsApp client dependency is not installed: ${cleanErrorMessage(error)}`);
  }
}

function buildPuppeteerOptions(config) {
  const executablePath = config.whatsappChromePath || findInstalledBrowser();
  return {
    headless: config.whatsappHeadless,
    executablePath: executablePath || undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  };
}

function findInstalledBrowser() {
  return browserCandidates.find((candidate) => existsSync(candidate)) || "";
}

async function fetchChatMessages(chat, limit) {
  try {
    return await chat.fetchMessages({
      limit: Math.max(1, Number(limit || 50))
    });
  } catch {
    return [];
  }
}

function sortCandidates(candidates) {
  return candidates
    .slice()
    .sort((a, b) => Number(b.message.timestamp || 0) - Number(a.message.timestamp || 0));
}

export function buildWhatsAppInquiry(message, chat) {
  const body = String(message.body || "").trim();
  const chatName = getChatName(chat);
  const sender = getSenderId(message, chat);
  const receivedAt = message.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : new Date().toISOString();

  return {
    provider: "whatsapp",
    source: "whatsapp",
    messageId: getMessageId(message),
    threadId: `whatsapp:${getChatId(chat) || sender}`,
    from: chatName ? `${chatName} <${sender}>` : sender,
    subject: "WhatsApp mining sales order inquiry",
    body: [`WhatsApp chat: ${chatName || "Unknown chat"}`, `Sender: ${sender}`, "", body].join("\n"),
    receivedAt
  };
}

function summarizeMatch(candidate, record) {
  const inquiry = buildWhatsAppInquiry(candidate.message, candidate.chat);
  return {
    recordId: record?.id || null,
    messageId: inquiry.messageId,
    chatName: getChatName(candidate.chat),
    from: inquiry.from,
    receivedAt: inquiry.receivedAt,
    matchedTerms: candidate.match.matchedTerms,
    reasons: candidate.match.reasons,
    preview: preview(candidate.message.body),
    opportunityName: record?.opportunity?.name || null,
    product: record?.opportunity?.request?.product || null,
    customer: record?.opportunity?.customer?.name || record?.customer?.name || null
  };
}

function getMessageId(message) {
  const serialized = message.id?._serialized || message.id?.id;
  if (serialized) {
    return `whatsapp:${serialized}`;
  }

  const fallback = [message.from, message.to, message.timestamp, hashText(message.body || "")].filter(Boolean).join(":");
  return `whatsapp:${fallback || hashText(JSON.stringify(message))}`;
}

function getSenderId(message, chat) {
  return message.author || message.from || getChatId(chat) || "whatsapp:unknown";
}

function getChatId(chat) {
  return chat?.id?._serialized || chat?.id?.id || "";
}

function getChatName(chat) {
  return chat?.name || chat?.formattedTitle || getChatId(chat) || "WhatsApp chat";
}

function preview(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function hashText(value) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16);
}

function cleanErrorMessage(value) {
  return String(value?.message || value || "Unknown error")
    .replace(/pwd=([^,}\s]+)/gi, "pwd=[redacted]")
    .replace(/password=([^,}\s]+)/gi, "password=[redacted]")
    .replace(/clientsecret=([^,}\s]+)/gi, "clientsecret=[redacted]")
    .replace(/client_secret=[^&\s]+/gi, "client_secret=[redacted]");
}
