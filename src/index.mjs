import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createGoogleAuthUrl,
  exchangeGoogleCodeForToken,
  getGoogleOAuthStatus
} from "./auth/googleOAuth.mjs";
import { getAgentOpeningSummary, runOpportunityAgent } from "./agent/opportunityAgent.mjs";
import { getConfig, getHanaStorageReadiness, getRuntimeStatus } from "./config.mjs";
import {
  markApproved,
  markInReview,
  markRejected,
  prepareApprovalRecord,
  setApprovalTag
} from "./domain/approvalWorkflow.mjs";
import { loadRulebook } from "./domain/ruleEngine.mjs";
import {
  getMailSyncStatus,
  needsManualProduct,
  startAutomaticMailSync,
  syncMailOpportunities
} from "./mail/inquirySync.mjs";
import { processInquiry } from "./pipeline.mjs";
import { saveRecordToHana } from "./storage/hanaOpportunityStore.mjs";
import { listOpportunities, saveOpportunityRecord, saveOpportunitySnapshot } from "./storage/opportunityStore.mjs";
import {
  disconnectWhatsAppClient,
  getWhatsAppStatus,
  startWhatsAppClient,
  syncWhatsAppSalesOrderMessages
} from "./whatsapp/whatsappClient.mjs";

const config = getConfig();
const publicDir = resolve("public");

const server = http.createServer(handleRequest);

async function handleRequest(request, response) {
  try {
    const url = new URL(request.url || "/", "http://localhost");

    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, { ok: true, service: "sap-inquiry-ai-agent" });
    }

    if (request.method === "GET" && url.pathname === "/runtime-status") {
      return sendJson(response, 200, getRuntimeStatus(config));
    }

    if (request.method === "GET" && url.pathname === "/sync/status") {
      return sendJson(response, 200, getMailSyncStatus(config));
    }

    if (request.method === "GET" && url.pathname === "/whatsapp/status") {
      return sendJson(response, 200, getWhatsAppStatus(config));
    }

    if (request.method === "POST" && url.pathname === "/whatsapp/start") {
      return sendJson(response, 200, await startWhatsAppClient(config));
    }

    if (request.method === "POST" && url.pathname === "/whatsapp/disconnect") {
      return sendJson(response, 200, await disconnectWhatsAppClient(config));
    }

    if (request.method === "POST" && url.pathname === "/whatsapp/sync") {
      return sendJson(response, 200, await syncWhatsAppSalesOrderMessages(config));
    }

    if (request.method === "GET" && url.pathname === "/auth/google/status") {
      return sendJson(response, 200, getGoogleOAuthStatus(config));
    }

    if (request.method === "GET" && url.pathname === "/auth/google/start") {
      const authUrl = createGoogleAuthUrl(config, request);
      response.writeHead(302, {
        Location: authUrl
      });
      response.end();
      return;
    }

    if (request.method === "GET" && url.pathname === "/auth/google/callback") {
      const result = await exchangeGoogleCodeForToken(config, url, request);
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8"
      });
      response.end(renderGoogleAuthComplete(result));
      return;
    }

    if (request.method === "GET" && url.pathname === "/rulebook") {
      return sendJson(response, 200, await loadRulebook());
    }

    if (request.method === "GET" && url.pathname === "/opportunities") {
      const limit = Number(url.searchParams.get("limit") || 50);
      return sendJson(response, 200, {
        opportunities: await listOpportunities({ limit })
      });
    }

    if (request.method === "GET" && url.pathname === "/agent/summary") {
      return sendJson(response, 200, await getAgentOpeningSummary(config));
    }

    if (request.method === "POST" && url.pathname === "/agent/chat") {
      const body = await readJsonBody(request);
      return sendJson(response, 200, await runOpportunityAgent(body.message, config));
    }

    if (request.method === "POST" && url.pathname === "/emails/sync") {
      return sendJson(response, 200, await syncMailOpportunities(config, { trigger: "manual" }));
    }

    const sapStoreMatch = url.pathname.match(/^\/opportunities\/([^/]+)\/confirm-sap-store$/);
    if (request.method === "POST" && sapStoreMatch) {
      const body = await readJsonBody(request);
      const result = await approveOpportunity(decodeURIComponent(sapStoreMatch[1]), body);
      return sendJson(response, result.statusCode, result.body);
    }

    const approveMatch = url.pathname.match(/^\/opportunities\/([^/]+)\/approve$/);
    if (request.method === "POST" && approveMatch) {
      const result = await approveOpportunity(decodeURIComponent(approveMatch[1]), { confirm: true });
      return sendJson(response, result.statusCode, result.body);
    }

    const acceptMatch = url.pathname.match(/^\/opportunities\/([^/]+)\/accept$/);
    if (request.method === "POST" && acceptMatch) {
      const body = await readJsonBody(request);
      const result = await acceptOpportunity(decodeURIComponent(acceptMatch[1]), body);
      return sendJson(response, result.statusCode, result.body);
    }

    const rejectMatch = url.pathname.match(/^\/opportunities\/([^/]+)\/reject$/);
    if (request.method === "POST" && rejectMatch) {
      const result = await rejectOpportunity(decodeURIComponent(rejectMatch[1]));
      return sendJson(response, result.statusCode, result.body);
    }

    const tagMatch = url.pathname.match(/^\/opportunities\/([^/]+)\/tag$/);
    if (request.method === "POST" && tagMatch) {
      const body = await readJsonBody(request);
      const result = await updateOpportunityTag(decodeURIComponent(tagMatch[1]), body);
      return sendJson(response, result.statusCode, result.body);
    }

    const productMatch = url.pathname.match(/^\/opportunities\/([^/]+)\/manual-product$/);
    if (request.method === "POST" && productMatch) {
      const body = await readJsonBody(request);
      const result = await saveManualProduct(decodeURIComponent(productMatch[1]), body);
      return sendJson(response, result.statusCode, result.body);
    }

    if (request.method === "POST" && url.pathname === "/inquiries/process") {
      const email = await readJsonBody(request);
      const result = await processInquiry(email, config);
      const persisted = await saveOpportunityRecord(result);
      const stored = await saveOpportunitySnapshot(prepareApprovalRecord(persisted), {
        backend: config.opportunityStoreBackend
      });
      return sendJson(response, 200, {
        ...result,
        persisted: stored
      });
    }

    if (request.method === "GET") {
      const staticResponse = await tryServeStatic(url.pathname, response);
      if (staticResponse) {
        return;
      }
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
}

if (isDirectRun()) {
  listenWithFallback(server, config.port);
  startAutomaticMailSync(config);
}

export { handleRequest, server };

async function approveOpportunity(opportunityId, body) {
  if (!body.confirm) {
    return {
      statusCode: 400,
      body: {
        ok: false,
        message: "Approval is required before sending this opportunity to SAP."
      }
    };
  }

  const records = await listOpportunities({ limit: 500 });
  const record = records.find((item) => item.id === opportunityId);
  if (!record) {
    return {
      statusCode: 404,
      body: {
        ok: false,
        message: "Opportunity was not found."
      }
    };
  }

  const hanaReadiness = getHanaStorageReadiness({
    ...config,
    opportunityStoreBackend: "hana"
  });

  if (!hanaReadiness.ready) {
    const approved = markApproved({
      ...record,
      sapStorage: {
        status: "send_pending",
        checkedAt: new Date().toISOString(),
        message: "Approved. SAP send is pending until the connection is ready.",
        missing: hanaReadiness.missing,
        errors: hanaReadiness.errors
      }
    });
    const persisted = await saveOpportunitySnapshot(approved, { backend: config.opportunityStoreBackend });
    return {
      statusCode: 200,
      body: {
        ok: true,
        message: "Opportunity approved. SAP send is pending until the connection is ready.",
        record: persisted
      }
    };
  }

  const withStorageStatus = {
    ...record,
    sapStorage: {
      status: "stored",
      savedAt: new Date().toISOString(),
      message: "Approved and sent to SAP."
    }
  };
  try {
    const saved = await saveRecordToHana(markApproved(withStorageStatus));
    const persisted = await saveOpportunitySnapshot(markApproved(saved), { backend: config.opportunityStoreBackend });
    return {
      statusCode: 200,
      body: {
        ok: true,
        message: "Opportunity approved and sent to SAP.",
        record: persisted
      }
    };
  } catch (error) {
    const approved = markApproved({
      ...record,
      sapStorage: {
        status: "approved_local",
        checkedAt: new Date().toISOString(),
        message: "Approved in the portal.",
        lastError: cleanErrorMessage(error)
      }
    });
    const persisted = await saveOpportunitySnapshot(approved, { backend: config.opportunityStoreBackend });
    return {
      statusCode: 200,
      body: {
        ok: true,
        message: "Opportunity approved and moved to the approved list.",
        record: persisted
      }
    };
  }
}

async function acceptOpportunity(opportunityId, body = {}) {
  const records = await listOpportunities({ limit: 500 });
  const record = records.find((item) => item.id === opportunityId);
  if (!record) {
    return {
      statusCode: 404,
      body: {
        ok: false,
        message: "Opportunity was not found."
      }
    };
  }

  const taggedRecord = body.tag ? setApprovalTag(record, body.tag) : record;
  const persisted = await saveOpportunitySnapshot(markInReview(taggedRecord), { backend: config.opportunityStoreBackend });
  return {
    statusCode: 200,
    body: {
      ok: true,
      message: "Opportunity accepted for review.",
      record: persisted
    }
  };
}

async function rejectOpportunity(opportunityId) {
  const records = await listOpportunities({ limit: 500 });
  const record = records.find((item) => item.id === opportunityId);
  if (!record) {
    return {
      statusCode: 404,
      body: {
        ok: false,
        message: "Opportunity was not found."
      }
    };
  }

  const persisted = await saveOpportunitySnapshot(markRejected(record), { backend: config.opportunityStoreBackend });
  return {
    statusCode: 200,
    body: {
      ok: true,
      message: "Opportunity rejected and ignored.",
      record: persisted
    }
  };
}

async function saveManualProduct(opportunityId, body) {
  const product = normalizeManualProduct(body.product);
  if (!product) {
    return {
      statusCode: 400,
      body: {
        ok: false,
        message: "Enter a product name before saving this PO."
      }
    };
  }

  const records = await listOpportunities({ limit: 500 });
  const record = records.find((item) => item.id === opportunityId);
  if (!record) {
    return {
      statusCode: 404,
      body: {
        ok: false,
        message: "Opportunity was not found."
      }
    };
  }

  const updated = prepareApprovalRecord(applyManualProduct(record, product));
  const saved = await saveOpportunitySnapshot(updated, { backend: config.opportunityStoreBackend });
  return {
    statusCode: 200,
    body: {
      ok: true,
      message: needsManualProduct(saved) ? "Product still needs review." : "Product saved. Opportunity is ready for approval.",
      record: saved
    }
  };
}

async function updateOpportunityTag(opportunityId, body) {
  const tag = String(body.tag || "").trim();
  if (!["pre_approved", "pre-approved", "needs_review", "needs-review"].includes(tag.toLowerCase())) {
    return {
      statusCode: 400,
      body: {
        ok: false,
        message: "Select either Pre-approved or Needs review."
      }
    };
  }

  const records = await listOpportunities({ limit: 500 });
  const record = records.find((item) => item.id === opportunityId);
  if (!record) {
    return {
      statusCode: 404,
      body: {
        ok: false,
        message: "Opportunity was not found."
      }
    };
  }

  const persisted = await saveOpportunitySnapshot(setApprovalTag(record, tag), { backend: config.opportunityStoreBackend });
  return {
    statusCode: 200,
    body: {
      ok: true,
      message: "Tag updated.",
      record: persisted
    }
  };
}

function applyManualProduct(record, product) {
  const customerName = record.opportunity?.customer?.name || record.customer?.name || "Unknown customer";
  const reasons = (record.decision?.reasons || []).filter(
    (reason) => !/product is not configured|unknown product/i.test(reason)
  );

  return {
    ...record,
    opportunity: {
      ...record.opportunity,
      name: `${customerName} - ${product}`,
      request: {
        ...record.opportunity.request,
        product
      },
      ruleDecision: {
        ...record.opportunity.ruleDecision,
        reasons
      }
    },
    extracted: {
      ...record.extracted,
      request: {
        ...record.extracted?.request,
        product
      }
    },
    decision: {
      ...record.decision,
      reasons
    },
    sapStorage: {
      status: "ready",
      checkedAt: new Date().toISOString(),
      message: "Product manually defined."
    }
  };
}

function normalizeManualProduct(value) {
  const product = String(value || "").replace(/\s+/g, " ").trim();
  return product && !/^unknown product$/i.test(product) ? titleCase(product) : "";
}

function titleCase(value) {
  return value.replace(/\w\S*/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
}

function cleanErrorMessage(value) {
  return String(value?.message || value || "Unknown error")
    .replace(/pwd=([^,}\s]+)/gi, "pwd=[redacted]")
    .replace(/password=([^,}\s]+)/gi, "password=[redacted]")
    .replace(/clientsecret=([^,}\s]+)/gi, "clientsecret=[redacted]")
    .replace(/client_secret=[^&\s]+/gi, "client_secret=[redacted]");
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json"
  });
  response.end(JSON.stringify(body, null, 2));
}

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
  }
  return body ? JSON.parse(body) : {};
}

async function tryServeStatic(pathname, response) {
  const files = {
    "/": ["index.html", "text/html; charset=utf-8"],
    "/index.html": ["index.html", "text/html; charset=utf-8"],
    "/styles.css": ["styles.css", "text/css; charset=utf-8"],
    "/app.js": ["app.js", "text/javascript; charset=utf-8"]
  };

  const match = files[pathname];
  if (!match) {
    return false;
  }

  const [fileName, contentType] = match;
  const body = await readFile(resolve(publicDir, fileName));
  response.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  response.end(body);
  return true;
}

function listenWithFallback(appServer, port, attemptsLeft = 5) {
  const onListening = () => {
    console.log(`SAP inquiry AI agent listening on http://localhost:${port}`);
  };

  const onError = (error) => {
    appServer.off("listening", onListening);

    if (error.code === "EADDRINUSE" && attemptsLeft > 0) {
      console.warn(`Port ${port} is in use, trying ${port + 1}.`);
      listenWithFallback(appServer, port + 1, attemptsLeft - 1);
      return;
    }

    throw error;
  };

  appServer.once("listening", onListening);
  appServer.once("error", onError);
  appServer.listen(port);
}

function renderGoogleAuthComplete(result) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Gmail connected</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 0; display: grid; place-items: center; min-height: 100vh; background: #f4f6f8; color: #13212e; }
      main { width: min(560px, calc(100% - 32px)); border: 1px solid #d7e0e7; border-radius: 8px; padding: 24px; background: white; box-shadow: 0 18px 48px rgba(33, 50, 68, 0.12); }
      h1 { margin: 0 0 8px; font-size: 1.5rem; }
      p { color: #5c6b78; line-height: 1.5; }
      a { color: #0b6f92; font-weight: 750; }
    </style>
  </head>
  <body>
    <main>
      <h1>Gmail connected</h1>
      <p>${escapeHtml(result.mailbox || "Mailbox")} is connected. The OAuth token was stored locally in the ignored token file.</p>
      <p><a href="/">Return to dashboard</a></p>
    </main>
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
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

function isDirectRun() {
  return process.argv[1] ? resolve(process.argv[1]) === resolve("src", "index.mjs") : false;
}
