import { buildStoredOpportunityRecord } from "./opportunityRecord.mjs";

const DEFAULT_TABLE = "PO_RECORDS";
const pendingNativePipeRejectors = new Set();
let nativePipeGuardInstalled = false;

export async function listHanaOpportunities(options = {}) {
  const settings = getHanaSettings(options.env || process.env);
  const limit = Math.max(1, Math.min(Number(options.limit || 50), 200));
  const connection = await openConnection(settings);

  try {
    await ensureTable(connection, settings);
    const rows = await exec(
      connection,
      `SELECT "RECORD_JSON" FROM ${qualifiedTable(settings)} ORDER BY "CREATED_AT" DESC LIMIT ${limit}`
    );

    return rows.map((row) => JSON.parse(row.RECORD_JSON || row.record_json)).filter(Boolean);
  } finally {
    disconnect(connection);
  }
}

export async function saveHanaOpportunityRecord(result, options = {}) {
  const settings = getHanaSettings(options.env || process.env);
  const connection = await openConnection(settings);

  try {
    await ensureTable(connection, settings);
    const existingRecord = await findExistingRecord(connection, settings, result.opportunity.sourceMessageId);
    const record = buildStoredOpportunityRecord(result, existingRecord);
    await upsertRecord(connection, settings, record);
    return stripInternalFields(record);
  } finally {
    disconnect(connection);
  }
}

export async function saveRecordToHana(record, options = {}) {
  const settings = getHanaSettings(options.env || process.env);
  const connection = await openConnection(settings);

  try {
    await ensureTable(connection, settings);
    await upsertRecord(connection, settings, record);
    return stripInternalFields(record);
  } finally {
    disconnect(connection);
  }
}

export function getHanaSettings(env = process.env) {
  const binding = getBoundHanaCredentials(env);
  const bindingUaa = binding.uaa || {};
  const host = env.HANA_HOST || binding.host || binding.hostname || "";
  const port = Number(env.HANA_PORT || binding.port || 443);
  const user = env.HANA_USER || binding.user || binding.username || binding.uid || "";
  const password = env.HANA_PASSWORD || binding.password || binding.pwd || "";
  const authMode = normalizeAuthMode(
    env.HANA_AUTH_MODE || (bindingUaa.clientid || bindingUaa.clientId ? "uaa-jwt" : "password")
  );

  return {
    authMode,
    host,
    port,
    user,
    password,
    uaaUrl: env.HANA_UAA_URL || bindingUaa.url || "",
    clientId: env.HANA_CLIENT_ID || bindingUaa.clientid || bindingUaa.clientId || "",
    clientSecret:
      env.HANA_CLIENT_SECRET || bindingUaa.clientsecret || bindingUaa.clientSecret || "",
    enableNativeJwt: env.HANA_ENABLE_NATIVE_JWT === "true",
    schema: env.HANA_SCHEMA || binding.schema || (authMode === "password" ? user : ""),
    table: env.HANA_TABLE || DEFAULT_TABLE,
    encrypt: env.HANA_ENCRYPT !== "false",
    validateCertificate: env.HANA_VALIDATE_CERTIFICATE !== "false"
  };
}

async function findExistingRecord(connection, settings, sourceMessageId) {
  if (!sourceMessageId) {
    return null;
  }

  const rows = await exec(
    connection,
    `SELECT "RECORD_JSON" FROM ${qualifiedTable(settings)} WHERE "SOURCE_MESSAGE_ID" = ? LIMIT 1`,
    [sourceMessageId]
  );

  if (!rows.length) {
    return null;
  }

  return JSON.parse(rows[0].RECORD_JSON || rows[0].record_json);
}

async function upsertRecord(connection, settings, record) {
  const opportunity = record.opportunity;
  const request = opportunity.request || {};
  const commercial = opportunity.commercial || {};
  const extractedSource = record.extracted?.source || {};
  const columns = [
    "ID",
    "SOURCE_MESSAGE_ID",
    "CUSTOMER_NAME",
    "CUSTOMER_EMAIL",
    "PO_REFERENCE",
    "PRODUCT",
    "QUANTITY",
    "UNIT",
    "UNIT_PRICE",
    "CURRENCY",
    "TOTAL_VALUE",
    "STAGE",
    "SAP_DOCUMENT_TYPE",
    "SAP_MODE",
    "EMAIL_SUBJECT",
    "EMAIL_TEXT",
    "RECORD_JSON",
    "CREATED_AT",
    "STORED_AT"
  ];
  const values = [
    record.id,
    opportunity.sourceMessageId || record.extracted?.source?.messageId || null,
    opportunity.customer?.name || record.customer?.name || null,
    record.extracted?.customer?.email || null,
    request.customerPurchaseOrderReference || null,
    request.product || null,
    numberOrNull(request.quantity),
    request.unit || null,
    numberOrNull(request.targetPrice),
    request.currency || commercial.currency || null,
    numberOrNull(commercial.totalValue),
    opportunity.stage || null,
    record.decision?.documentType || null,
    record.sapResult?.mode || null,
    extractedSource.subject || null,
    record.extracted?.rawSummary || null,
    JSON.stringify(stripInternalFields(record)),
    toHanaTimestamp(opportunity.createdAt),
    toHanaTimestamp(record.storedAt)
  ];
  const placeholders = columns.map(() => "?").join(", ");
  const quotedColumns = columns.map((column) => `"${column}"`).join(", ");

  await exec(
    connection,
    `UPSERT ${qualifiedTable(settings)} (${quotedColumns}) VALUES (${placeholders}) WITH PRIMARY KEY`,
    values
  );
}

async function ensureTable(connection, settings) {
  const { schema, table } = tableParts(settings);
  const params = schema ? [schema, table] : [table];
  const schemaPredicate = schema ? `"SCHEMA_NAME" = ?` : `"SCHEMA_NAME" = CURRENT_SCHEMA`;
  const rows = await exec(
    connection,
    `SELECT COUNT(*) AS "COUNT" FROM "SYS"."TABLES" WHERE ${schemaPredicate} AND "TABLE_NAME" = ?`,
    params
  );
  const tableExists = Number(rows[0]?.COUNT ?? rows[0]?.count ?? Object.values(rows[0] || {})[0] ?? 0) > 0;

  if (tableExists) {
    return;
  }

  try {
    await exec(
      connection,
      `CREATE TABLE ${qualifiedTable(settings)} (
      "ID" NVARCHAR(64) PRIMARY KEY,
      "SOURCE_MESSAGE_ID" NVARCHAR(128),
      "CUSTOMER_NAME" NVARCHAR(255),
      "CUSTOMER_EMAIL" NVARCHAR(320),
      "PO_REFERENCE" NVARCHAR(80),
      "PRODUCT" NVARCHAR(255),
      "QUANTITY" DECIMAL(18,3),
      "UNIT" NVARCHAR(32),
      "UNIT_PRICE" DECIMAL(18,3),
      "CURRENCY" NVARCHAR(16),
      "TOTAL_VALUE" DECIMAL(18,3),
      "STAGE" NVARCHAR(40),
      "SAP_DOCUMENT_TYPE" NVARCHAR(80),
      "SAP_MODE" NVARCHAR(40),
      "EMAIL_SUBJECT" NVARCHAR(500),
      "EMAIL_TEXT" NCLOB,
      "RECORD_JSON" NCLOB,
      "CREATED_AT" TIMESTAMP,
      "STORED_AT" TIMESTAMP
    )`
    );
  } catch (error) {
    if (!/already exists|duplicate table|cannot use duplicate/i.test(cleanErrorMessage(error))) {
      throw error;
    }
  }
}

async function openConnection(settings) {
  assertHanaSettings(settings);
  if (settings.authMode === "uaa-jwt" && !settings.enableNativeJwt) {
    throw new Error(
      "HANA UAA service-key credentials are configured, but SQL insert needs a HANA JWT user mapping. Use HANA_USER/HANA_PASSWORD or set HANA_ENABLE_NATIVE_JWT=true only after that mapping exists."
    );
  }

  const hanaModule = await import("@sap/hana-client");
  const hanaClient = hanaModule.default || hanaModule;
  const baseParams = {
    serverNode: `${settings.host}:${settings.port}`,
    encrypt: String(settings.encrypt),
    sslValidateCertificate: String(settings.validateCertificate)
  };

  if (settings.authMode === "uaa-jwt") {
    const token = await fetchUaaJwt(settings);
    return connectWithJwtVariants(hanaClient, baseParams, token);
  }

  const passwordParams = {
    ...baseParams,
    uid: settings.user,
    pwd: settings.password
  };

  try {
    return await connectWithParams(hanaClient, passwordParams);
  } catch (error) {
    if (!isForcedPasswordChangeError(error)) {
      throw error;
    }

    return connectWithParams(hanaClient, {
      ...passwordParams,
      newPassword: settings.password
    });
  }
}

async function connectWithJwtVariants(hanaClient, baseParams, token) {
  const variants = [
    { authenticationMethods: "jwt", uid: token },
    { authenticationMethods: "jwt", pwd: token }
  ];
  let lastError;

  for (const variant of variants) {
    try {
      return await connectWithParams(hanaClient, {
        ...baseParams,
        ...variant
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `HANA JWT authentication failed. The service key token was fetched, but HANA rejected the database connection: ${cleanErrorMessage(
      lastError
    )}`
  );
}

async function connectWithParams(hanaClient, connectionParams) {
  ensureHanaNativeErrorGuard();
  const connection = hanaClient.createConnection();

  await new Promise((resolve, reject) => {
    let settled = false;
    const rejectNativePipeError = (error) => {
      disconnect(connection);
      finish(
        reject,
        new Error(
          `SAP HANA native client rejected the connection before opening the remote host: ${cleanErrorMessage(
            error
          )}`
        )
      );
    };
    const timeout = setTimeout(() => {
      rejectNativePipeError(
        new Error("Timed out while waiting for the SAP HANA native client to finish connecting.")
      );
    }, 30000);
    const finish = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      pendingNativePipeRejectors.delete(rejectNativePipeError);
      callback(value);
    };

    pendingNativePipeRejectors.add(rejectNativePipeError);
    connection.connect(connectionParams, (error) => {
      if (error) {
        disconnect(connection);
        finish(reject, error);
        return;
      }
      finish(resolve);
    });
  });

  return connection;
}

async function fetchUaaJwt(settings) {
  const response = await fetch(`${settings.uaaUrl.replace(/\/$/, "")}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${settings.clientId}:${settings.clientSecret}`).toString(
        "base64"
      )}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "client_credentials"
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Could not fetch SAP HANA UAA token (${response.status}): ${cleanErrorMessage(body)}`
    );
  }

  const tokenResponse = await response.json();
  if (!tokenResponse.access_token) {
    throw new Error("SAP HANA UAA token response did not include an access token.");
  }

  return tokenResponse.access_token;
}

function exec(connection, sql, params = []) {
  return new Promise((resolve, reject) => {
    const callback = (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows || []);
    };

    if (params.length) {
      connection.exec(sql, params, callback);
      return;
    }

    connection.exec(sql, callback);
  });
}

function disconnect(connection) {
  try {
    connection.disconnect();
  } catch {
    // Nothing useful to do during shutdown.
  }
}

function assertHanaSettings(settings) {
  const missing = [];
  if (!settings.host) missing.push("HANA_HOST");
  if (!settings.port) missing.push("HANA_PORT");

  if (settings.authMode === "uaa-jwt") {
    if (!settings.uaaUrl) missing.push("HANA_UAA_URL");
    if (!settings.clientId) missing.push("HANA_CLIENT_ID");
    if (!settings.clientSecret) missing.push("HANA_CLIENT_SECRET");
  } else {
    if (!settings.user) missing.push("HANA_USER");
    if (!settings.password) missing.push("HANA_PASSWORD");
  }

  if (missing.length) {
    throw new Error(`HANA persistence is enabled but missing ${missing.join(", ")}.`);
  }
}

function normalizeAuthMode(value) {
  const mode = String(value || "password").trim().toLowerCase();
  if (["jwt", "uaa", "uaa-jwt", "service-key"].includes(mode)) {
    return "uaa-jwt";
  }
  return "password";
}

function cleanErrorMessage(value) {
  return String(value?.message || value || "Unknown error")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, "[redacted-jwt]")
    .replace(/client_secret=[^&\s]+/gi, "client_secret=[redacted]");
}

function isHanaNativePipeError(error) {
  return (
    error?.code === "EPERM" &&
    (String(error?.address || "").toLowerCase().includes("hdbpipe") ||
      String(error?.message || "").toLowerCase().includes("hdbpipe"))
  );
}

function isForcedPasswordChangeError(error) {
  return /alter password required|forced to change password/i.test(cleanErrorMessage(error));
}

function ensureHanaNativeErrorGuard() {
  if (nativePipeGuardInstalled) {
    return;
  }

  nativePipeGuardInstalled = true;
  process.on("uncaughtException", (error) => {
    if (!isHanaNativePipeError(error)) {
      throw error;
    }

    for (const reject of [...pendingNativePipeRejectors]) {
      reject(error);
    }
  });
}

function qualifiedTable(settings) {
  const table = quoteIdentifier(settings.table || DEFAULT_TABLE);
  return settings.schema ? `${quoteIdentifier(settings.schema)}.${table}` : table;
}

function tableParts(settings) {
  return {
    schema: settings.schema ? normalizeIdentifier(settings.schema) : "",
    table: normalizeIdentifier(settings.table || DEFAULT_TABLE)
  };
}

function quoteIdentifier(value) {
  return `"${normalizeIdentifier(value)}"`;
}

function normalizeIdentifier(value) {
  const identifier = String(value || "").trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid HANA identifier: ${identifier}`);
  }
  return identifier.toUpperCase();
}

function getBoundHanaCredentials(env) {
  if (!env.VCAP_SERVICES) {
    return {};
  }

  try {
    const services = JSON.parse(env.VCAP_SERVICES);
    const candidates = Object.values(services).flat();
    const binding = candidates.find(
      (service) =>
        service?.label === "hana-cloud" ||
        service?.name === env.HANA_SERVICE_NAME ||
        service?.tags?.includes("hana-cloud")
    );
    return binding?.credentials || {};
  } catch {
    return {};
  }
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toHanaTimestamp(value) {
  return new Date(value || Date.now()).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
}

function stripInternalFields(record) {
  const { sourceMessageId, ...publicRecord } = record;
  return publicRecord;
}
