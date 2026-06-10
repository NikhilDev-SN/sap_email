import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { prepareApprovalRecord } from "../domain/approvalWorkflow.mjs";
import { processInquiry } from "../pipeline.mjs";
import { saveOpportunityRecord, saveOpportunitySnapshot } from "../storage/opportunityStore.mjs";

const QRCODE_PACKAGE = "qrcode";
const WHATSAPP_WEB_PACKAGE = "whatsapp-web.js";

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

const cloudState = {
  lastWebhookAt: null,
  lastVerificationAt: null,
  lastError: null,
  lastReceived: 0,
  lastMatched: 0,
  lastProcessed: 0,
  lastIgnored: 0,
  lastReadyForApproval: 0,
  lastMatches: []
};

export function getWhatsAppStatus(config) {
  const enabled = Boolean(config.whatsappEnabled);
  const connector = config.whatsappConnector || "web";
  const webEnabled = Boolean(config.whatsappWebEnabled);
  const cloudEnabled = Boolean(config.whatsappCloudEnabled);
  const cloudReady = cloudEnabled && Boolean(config.whatsappCloudVerifyToken);
  const disabledReason = getDisabledReason(config);
  const qrDisabledReason = getQrDisabledReason(config);
  const cloudSetupMessage =
    "WhatsApp Cloud API needs WHATSAPP_CLOUD_VERIFY_TOKEN in your Vercel/Netlify environment, then set the Meta callback URL to /whatsapp/webhook.";
  const cloudSyncState = {
    running: false,
    lastStartedAt: null,
    lastFinishedAt: cloudState.lastWebhookAt,
    lastError: cloudState.lastError,
    lastScannedChats: cloudState.lastReceived ? 1 : 0,
    lastScannedMessages: cloudState.lastReceived,
    lastMatched: cloudState.lastMatched,
    lastProcessed: cloudState.lastProcessed,
    lastReadyForApproval: cloudState.lastReadyForApproval,
    lastMatches: cloudState.lastMatches
  };

  return {
    enabled,
    connector,
    status: getConnectionStatus({
      enabled,
      connector,
      webEnabled,
      cloudEnabled,
      cloudReady
    }),
    starting: webEnabled ? clientState.starting : false,
    authenticated: cloudEnabled ? cloudReady : webEnabled ? clientState.authenticated : false,
    ready: cloudEnabled ? cloudReady : webEnabled ? clientState.ready : false,
    hasQr: webEnabled ? Boolean(clientState.qrDataUrl) : false,
    qrDataUrl: webEnabled ? clientState.qrDataUrl : null,
    loading: webEnabled ? clientState.loading : null,
    lastQrAt: webEnabled ? clientState.lastQrAt : null,
    lastReadyAt: cloudEnabled ? cloudState.lastVerificationAt : clientState.lastReadyAt,
    lastDisconnectedAt: webEnabled ? clientState.lastDisconnectedAt : null,
    lastError: getConnectionError({
      enabled,
      connector,
      webEnabled,
      cloudEnabled,
      cloudReady,
      disabledReason,
      qrDisabledReason,
      cloudSetupMessage
    }),
    web: {
      enabled: webEnabled,
      disabledReason: webEnabled ? "" : qrDisabledReason,
      browserConfigured: Boolean(config.whatsappChromePath),
      headless: config.whatsappHeadless
    },
    cloudApi: {
      enabled: cloudEnabled,
      configured: cloudReady,
      webhookPath: config.whatsappCloudWebhookPath,
      webhookUrl: buildWebhookUrl(config),
      verifyTokenConfigured: Boolean(config.whatsappCloudVerifyToken),
      accessTokenConfigured: Boolean(config.whatsappCloudAccessToken),
      phoneNumberIdConfigured: Boolean(config.whatsappCloudPhoneNumberId),
      appSecretConfigured: Boolean(config.whatsappCloudAppSecret),
      lastWebhookAt: cloudState.lastWebhookAt,
      lastVerificationAt: cloudState.lastVerificationAt,
      lastIgnored: cloudState.lastIgnored
    },
    search: {
      terms: config.whatsappSearchTerms,
      chatLimit: config.whatsappChatLimit,
      lookbackLimit: config.whatsappLookbackLimit,
      processLimit: config.whatsappProcessLimit
    },
    sync: {
      ...(cloudEnabled ? cloudSyncState : syncState)
    }
  };
}

export async function startWhatsAppClient(config) {
  if (!config.whatsappWebEnabled) {
    clientState.status = "disabled";
    clientState.lastError = config.whatsappCloudEnabled
      ? "WhatsApp Cloud API does not use QR login. Configure the Meta webhook URL instead."
      : getQrDisabledReason(config) || getDisabledReason(config);
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
  if (config.whatsappCloudEnabled) {
    return {
      ...getWhatsAppStatus(config),
      skipped: true,
      message: "WhatsApp Cloud API receives messages by webhook. No chat scan is required."
    };
  }

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

export function verifyWhatsAppCloudWebhook(config, url) {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge") || "";

  if (!config.whatsappCloudEnabled) {
    return {
      statusCode: 403,
      contentType: "text/plain; charset=utf-8",
      body: "WhatsApp Cloud API is disabled."
    };
  }

  if (!config.whatsappCloudVerifyToken) {
    return {
      statusCode: 428,
      contentType: "text/plain; charset=utf-8",
      body: "Set WHATSAPP_CLOUD_VERIFY_TOKEN before verifying the webhook."
    };
  }

  if (mode === "subscribe" && token === config.whatsappCloudVerifyToken) {
    cloudState.lastVerificationAt = new Date().toISOString();
    cloudState.lastError = null;
    return {
      statusCode: 200,
      contentType: "text/plain; charset=utf-8",
      body: challenge
    };
  }

  cloudState.lastError = "WhatsApp Cloud API webhook verification token did not match.";
  return {
    statusCode: 403,
    contentType: "text/plain; charset=utf-8",
    body: "Verification failed."
  };
}

export async function processWhatsAppCloudWebhook(config, payload, options = {}) {
  if (!config.whatsappCloudEnabled) {
    return {
      ok: true,
      connector: config.whatsappConnector || "web",
      skipped: true,
      message: "WhatsApp Cloud API is disabled.",
      received: 0,
      matched: 0,
      processed: 0,
      ignored: 0,
      opportunities: [],
      matches: []
    };
  }

  if (config.whatsappCloudAppSecret && !isValidCloudSignature(config, options.rawBody || "", options.signature || "")) {
    cloudState.lastError = "WhatsApp Cloud API webhook signature check failed.";
    throw new Error(cloudState.lastError);
  }

  const candidates = extractCloudApiMessages(payload);
  const records = [];
  const matches = [];
  let matched = 0;
  let ignored = 0;
  let readyForApproval = 0;

  for (const candidate of candidates) {
    const text = extractCloudMessageText(candidate.message);
    if (!text) {
      ignored += 1;
      continue;
    }

    const match = isRelevantWhatsAppSalesOrderText(text, config.whatsappSearchTerms);
    if (!match.matched) {
      ignored += 1;
      continue;
    }

    matched += 1;
    const inquiry = buildWhatsAppCloudInquiry(candidate);
    const result = await processInquiry(inquiry, config);
    const record = await saveOpportunityRecord(result, {
      backend: config.opportunityStoreBackend
    });
    const finalRecord = await saveOpportunitySnapshot(prepareApprovalRecord(record), {
      backend: config.opportunityStoreBackend
    });

    if (finalRecord.approval?.status === "pending") {
      readyForApproval += 1;
    }

    records.push(finalRecord);
    matches.push(summarizeCloudMatch(candidate, match, finalRecord));
  }

  cloudState.lastWebhookAt = new Date().toISOString();
  cloudState.lastError = null;
  cloudState.lastReceived = candidates.length;
  cloudState.lastMatched = matched;
  cloudState.lastProcessed = records.length;
  cloudState.lastIgnored = ignored;
  cloudState.lastReadyForApproval = readyForApproval;
  cloudState.lastMatches = matches;

  return {
    ok: true,
    connector: "cloud-api",
    received: candidates.length,
    matched,
    processed: records.length,
    ignored,
    readyForApproval,
    opportunities: records,
    matches
  };
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
    const QRCode = await loadQrCodeDependency();
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
    const mod = await import(WHATSAPP_WEB_PACKAGE);
    return mod.default || mod;
  } catch (error) {
    throw new Error(`WhatsApp client dependency is not installed: ${cleanErrorMessage(error)}`);
  }
}

async function loadQrCodeDependency() {
  try {
    const mod = await import(QRCODE_PACKAGE);
    return mod.default || mod;
  } catch (error) {
    throw new Error(`QR code dependency is not installed: ${cleanErrorMessage(error)}`);
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

export function buildWhatsAppCloudInquiry(candidate) {
  const message = candidate.message || {};
  const text = extractCloudMessageText(message);
  const sender = message.from || candidate.contact?.wa_id || "whatsapp:unknown";
  const contactName = candidate.contact?.profile?.name || "";
  const phoneNumber = candidate.metadata?.display_phone_number || candidate.metadata?.phone_number_id || "";
  const receivedAt = message.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : new Date().toISOString();

  return {
    provider: "whatsapp-cloud",
    source: "whatsapp",
    messageId: `whatsapp-cloud:${message.id || hashText(JSON.stringify(message))}`,
    threadId: `whatsapp:${sender}`,
    from: contactName ? `${contactName} <${sender}>` : sender,
    subject: "WhatsApp mining sales order inquiry",
    body: [`WhatsApp contact: ${contactName || "Unknown contact"}`, `Sender: ${sender}`, `Business phone: ${phoneNumber || "-"}`, "", text].join(
      "\n"
    ),
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

function summarizeCloudMatch(candidate, match, record) {
  const inquiry = buildWhatsAppCloudInquiry(candidate);
  return {
    recordId: record?.id || null,
    messageId: inquiry.messageId,
    chatName: candidate.contact?.profile?.name || candidate.message?.from || "WhatsApp contact",
    from: inquiry.from,
    receivedAt: inquiry.receivedAt,
    matchedTerms: match.matchedTerms,
    reasons: match.reasons,
    preview: preview(extractCloudMessageText(candidate.message)),
    opportunityName: record?.opportunity?.name || null,
    product: record?.opportunity?.request?.product || null,
    customer: record?.opportunity?.customer?.name || record?.customer?.name || null
  };
}

function extractCloudApiMessages(payload) {
  const candidates = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value || {};
      const contacts = new Map(
        (Array.isArray(value.contacts) ? value.contacts : []).map((contact) => [contact.wa_id, contact])
      );
      for (const message of Array.isArray(value.messages) ? value.messages : []) {
        candidates.push({
          message,
          contact: contacts.get(message.from) || null,
          metadata: value.metadata || {}
        });
      }
    }
  }

  return candidates;
}

function extractCloudMessageText(message = {}) {
  if (message.text?.body) {
    return String(message.text.body).trim();
  }
  if (message.button?.text) {
    return String(message.button.text).trim();
  }
  if (message.interactive?.button_reply) {
    return [message.interactive.button_reply.title, message.interactive.button_reply.id].filter(Boolean).join(" ").trim();
  }
  if (message.interactive?.list_reply) {
    return [message.interactive.list_reply.title, message.interactive.list_reply.description, message.interactive.list_reply.id]
      .filter(Boolean)
      .join(" ")
      .trim();
  }
  if (message.document?.caption) {
    return String(message.document.caption).trim();
  }
  if (message.image?.caption) {
    return String(message.image.caption).trim();
  }
  return "";
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

function getConnectionStatus({ enabled, connector, webEnabled, cloudEnabled, cloudReady }) {
  if (!enabled) {
    return "disabled";
  }
  if (connector === "cloud-api" || cloudEnabled) {
    return cloudReady ? "webhook_ready" : "cloud_setup_required";
  }
  if (!webEnabled) {
    return "disabled";
  }
  return clientState.status;
}

function getConnectionError({
  enabled,
  connector,
  webEnabled,
  cloudEnabled,
  cloudReady,
  disabledReason,
  qrDisabledReason,
  cloudSetupMessage
}) {
  if (!enabled) {
    return disabledReason;
  }
  if (connector === "cloud-api" || cloudEnabled) {
    return cloudState.lastError || (cloudReady ? null : cloudSetupMessage);
  }
  if (!webEnabled) {
    return qrDisabledReason;
  }
  return clientState.lastError;
}

function buildWebhookUrl(config) {
  const pathname = config.whatsappCloudWebhookPath || "/whatsapp/webhook";
  if (!config.publicBaseUrl) {
    return pathname;
  }
  try {
    return new URL(pathname, config.publicBaseUrl.endsWith("/") ? config.publicBaseUrl : `${config.publicBaseUrl}/`).toString();
  } catch {
    return pathname;
  }
}

function isValidCloudSignature(config, rawBody, signatureHeader) {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const expected = `sha256=${createHmac("sha256", config.whatsappCloudAppSecret).update(String(rawBody)).digest("hex")}`;
  const actualBuffer = Buffer.from(signatureHeader);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function cleanErrorMessage(value) {
  return String(value?.message || value || "Unknown error")
    .replace(/pwd=([^,}\s]+)/gi, "pwd=[redacted]")
    .replace(/password=([^,}\s]+)/gi, "password=[redacted]")
    .replace(/clientsecret=([^,}\s]+)/gi, "clientsecret=[redacted]")
    .replace(/client_secret=[^&\s]+/gi, "client_secret=[redacted]");
}

function getDisabledReason(config) {
  return config.whatsappDisabledReason || "WhatsApp intake is disabled by WHATSAPP_ENABLED=false.";
}

function getQrDisabledReason(config) {
  return config.whatsappQrDisabledReason || "";
}
