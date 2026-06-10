import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

loadDotEnv();

export function getConfig(env = process.env) {
  const hanaBinding = getHanaBindingCredentials(env);
  const hanaUaa = hanaBinding.uaa || {};
  const hanaAuthMode = normalizeHanaAuthMode(
    env.HANA_AUTH_MODE || (hanaUaa.clientid || hanaUaa.clientId ? "uaa-jwt" : "password")
  );

  return {
    port: Number(env.PORT || 4000),
    aiProvider: env.AI_PROVIDER || "heuristic",
    openaiApiKey: env.OPENAI_API_KEY || "",
    openaiModel: env.OPENAI_MODEL || "gpt-5-mini",
    disableNvidia: env.DISABLE_NVIDIA === "true",
    nvidiaApiKey: env.NVIDIA_API_KEY || "",
    nvidiaEndpoint: env.NVIDIA_ENDPOINT || "https://integrate.api.nvidia.com/v1/chat/completions",
    nvidiaDefaultModel: env.NVIDIA_DEFAULT_MODEL || "nvidia/nemotron-3-super-120b-a12b",
    nvidiaTimeoutMs: Number(env.NVIDIA_TIMEOUT_MS || 45000),
    mailboxAddress: env.MAILBOX_ADDRESS || "",
    googleOAuthClientId: env.GOOGLE_OAUTH_CLIENT_ID || "",
    googleOAuthClientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET || "",
    googleOAuthRedirectUri: env.GOOGLE_OAUTH_REDIRECT_URI || "",
    googleOAuthTokenPath: env.GOOGLE_OAUTH_TOKEN_PATH || resolve("data", "google-oauth-token.json"),
    gmailSyncQuery: env.GMAIL_SYNC_QUERY || "newer_than:30d",
    gmailSyncMaxResults: Number(env.GMAIL_SYNC_MAX_RESULTS || 10),
    gmailAutoSyncEnabled: env.GMAIL_AUTO_SYNC !== "false",
    gmailAutoSyncIntervalMs: Number(env.GMAIL_AUTO_SYNC_INTERVAL_MS || 60000),
    whatsappEnabled: env.WHATSAPP_ENABLED !== "false",
    whatsappSessionPath: env.WHATSAPP_SESSION_PATH || resolve("data", "whatsapp-session"),
    whatsappChromePath: env.WHATSAPP_CHROME_PATH || "",
    whatsappHeadless: env.WHATSAPP_HEADLESS !== "false",
    whatsappChatLimit: Number(env.WHATSAPP_CHAT_LIMIT || 30),
    whatsappLookbackLimit: Number(env.WHATSAPP_LOOKBACK_LIMIT || 50),
    whatsappProcessLimit: Number(env.WHATSAPP_PROCESS_LIMIT || 20),
    whatsappSearchTerms: parseList(
      env.WHATSAPP_SEARCH_TERMS ||
        "mining sales order,minning sales order,iron ore sales order,ore sales order,coal sales order"
    ),
    displayCurrency: env.DISPLAY_CURRENCY || "INR",
    displayUsdToInrRate: Number(env.DISPLAY_USD_TO_INR_RATE || 83.5),
    gmailSecureAuthConfigured: Boolean(
      env.GMAIL_OAUTH_REFRESH_TOKEN || env.GMAIL_APP_PASSWORD || hasStoredGoogleToken(env)
    ),
    sapMode: env.SAP_MODE || "mock",
    sapDocumentType: env.SAP_DOCUMENT_TYPE || "auto",
    sapSubmitMode: env.SAP_SUBMIT_MODE || "dry-run",
    sapDestinationName: env.SAP_DESTINATION_NAME || "",
    sapDestinationServiceBound: hasSapDestinationBinding(env),
    sapBaseUrl: env.SAP_BASE_URL || "",
    sapServicePath: env.SAP_SERVICE_PATH || "",
    sapApiKey: env.SAP_API_KEY || "",
    sapUsername: env.SAP_USERNAME || "",
    sapPassword: env.SAP_PASSWORD || "",
    sapSalesOrg: env.SAP_SALES_ORG || "1000",
    sapDistributionChannel: env.SAP_DISTRIBUTION_CHANNEL || "10",
    sapDivision: env.SAP_DIVISION || "00",
    sapTransactionCurrency: env.SAP_TRANSACTION_CURRENCY || "",
    sapQuantityUnit: env.SAP_QUANTITY_UNIT || "",
    sapPurchasingOrg: env.SAP_PURCHASING_ORG || "1000",
    sapPurchasingGroup: env.SAP_PURCHASING_GROUP || "001",
    sapCompanyCode: env.SAP_COMPANY_CODE || "1000",
    opportunityStoreBackend: env.OPPORTUNITY_STORE_BACKEND || "file",
    hanaInstanceId: env.HANA_INSTANCE_ID || "",
    hanaInstanceStatus: env.HANA_INSTANCE_STATUS || "",
    hanaServiceKeyName: env.HANA_SERVICE_KEY_NAME || "",
    hanaAuthMode,
    hanaHost: env.HANA_HOST || hanaBinding.host || hanaBinding.hostname || "",
    hanaPort: Number(env.HANA_PORT || hanaBinding.port || 443),
    hanaUser: env.HANA_USER || hanaBinding.user || hanaBinding.username || hanaBinding.uid || "",
    hanaPassword: env.HANA_PASSWORD || hanaBinding.password || hanaBinding.pwd || "",
    hanaUaaUrl: env.HANA_UAA_URL || hanaUaa.url || "",
    hanaClientId: env.HANA_CLIENT_ID || hanaUaa.clientid || hanaUaa.clientId || "",
    hanaClientSecret: env.HANA_CLIENT_SECRET || hanaUaa.clientsecret || hanaUaa.clientSecret || "",
    hanaEnableNativeJwt: env.HANA_ENABLE_NATIVE_JWT === "true",
    hanaSchema: env.HANA_SCHEMA || hanaBinding.schema || "",
    hanaTable: env.HANA_TABLE || "PO_RECORDS",
    hanaServiceBound: Boolean(hanaBinding.host || hanaBinding.hostname)
  };
}

export function getRuntimeStatus(config) {
  const sapReadiness = getSapLiveReadiness(config);
  const hanaReadiness = getHanaStorageReadiness({
    ...config,
    opportunityStoreBackend: "hana"
  });

  return {
    aiProvider: config.aiProvider,
    display: {
      currency: config.displayCurrency,
      usdToInrRate: config.displayUsdToInrRate
    },
    agentModel: config.disableNvidia
      ? "deterministic"
      : config.nvidiaDefaultModel || "nvidia/nemotron-3-super-120b-a12b",
    mailbox: {
      address: config.mailboxAddress,
      provider: config.mailboxAddress.endsWith("@gmail.com") ? "gmail" : "manual",
      secureAuthConfigured: config.gmailSecureAuthConfigured,
      oauthClientConfigured: Boolean(config.googleOAuthClientId && config.googleOAuthClientSecret),
      autoSyncEnabled: config.gmailAutoSyncEnabled,
      autoSyncIntervalMs: config.gmailAutoSyncIntervalMs,
      syncQuery: config.gmailSyncQuery
    },
    whatsapp: {
      enabled: config.whatsappEnabled,
      searchTerms: config.whatsappSearchTerms,
      chatLimit: config.whatsappChatLimit,
      lookbackLimit: config.whatsappLookbackLimit,
      processLimit: config.whatsappProcessLimit,
      browserConfigured: Boolean(config.whatsappChromePath),
      headless: config.whatsappHeadless
    },
    sapMode: config.sapMode,
    sapDocumentType: config.sapDocumentType,
    sapSubmitMode: config.sapSubmitMode,
    sap: {
      ready: sapReadiness.ready,
      missing: sapReadiness.missing,
      errors: sapReadiness.errors,
      integrationMode: config.sapDestinationName ? "btp-destination" : "direct-url",
      destinationName: config.sapDestinationName,
      baseUrlHost: getHost(config.sapBaseUrl),
      servicePath: config.sapDocumentType === "auto" ? "auto per inquiry flow" : config.sapServicePath,
      credentialsConfigured: Boolean(
        config.sapDestinationName || config.sapApiKey || (config.sapUsername && config.sapPassword)
      )
    },
    persistence: {
      backend: config.opportunityStoreBackend,
      hana: {
        ready: hanaReadiness.ready,
        backendActive: String(config.opportunityStoreBackend).toLowerCase() === "hana",
        missing: hanaReadiness.missing,
        errors: hanaReadiness.errors,
        instanceId: config.hanaInstanceId,
        instanceStatus: config.hanaInstanceStatus,
        serviceKeyName: config.hanaServiceKeyName,
        authMode: config.hanaAuthMode,
        serviceBound: config.hanaServiceBound,
        hostConfigured: Boolean(config.hanaHost),
        userConfigured: Boolean(config.hanaUser),
        uaaConfigured: Boolean(
          config.hanaUaaUrl && config.hanaClientId && config.hanaClientSecret
        ),
        nativeJwtEnabled: config.hanaEnableNativeJwt,
        table: config.hanaTable
      }
    }
  };
}

export function getHanaStorageReadiness(config) {
  if (String(config.opportunityStoreBackend).toLowerCase() !== "hana") {
    return {
      ready: true,
      missing: [],
      errors: []
    };
  }

  const missing = [];
  const errors = [];

  if (!config.hanaHost) missing.push("HANA_HOST");
  if (!config.hanaPort) missing.push("HANA_PORT");

  if (config.hanaAuthMode === "uaa-jwt") {
    if (!config.hanaUaaUrl) missing.push("HANA_UAA_URL");
    if (!config.hanaClientId) missing.push("HANA_CLIENT_ID");
    if (!config.hanaClientSecret) missing.push("HANA_CLIENT_SECRET");
    if (!config.hanaEnableNativeJwt) {
      errors.push(
        "HANA_AUTH_MODE=uaa-jwt has UAA service-key credentials, but SQL insert needs a HANA JWT user mapping. Use HANA_USER/HANA_PASSWORD or set HANA_ENABLE_NATIVE_JWT=true only after that mapping exists."
      );
    }
  } else {
    if (!config.hanaUser) missing.push("HANA_USER");
    if (!config.hanaPassword) missing.push("HANA_PASSWORD");
  }

  if (config.hanaInstanceStatus && !/running|available|created/i.test(config.hanaInstanceStatus)) {
    errors.push(`SAP HANA Cloud instance is not ready yet: ${config.hanaInstanceStatus}.`);
  }

  return {
    ready: missing.length === 0 && errors.length === 0,
    missing,
    errors
  };
}

export function getSapLiveReadiness(config) {
  if (config.sapMode !== "live") {
    return {
      ready: true,
      missing: [],
      errors: []
    };
  }

  if (config.sapSubmitMode !== "commit") {
    return {
      ready: true,
      missing: [],
      errors: []
    };
  }

  const missing = [];
  const errors = [];

  if (config.sapDestinationName) {
    if (!config.sapDestinationServiceBound) {
      errors.push(
        "SAP_DESTINATION_NAME is set, but no SAP Destination service binding was found in VCAP_SERVICES."
      );
    }

    return {
      ready: errors.length === 0,
      missing,
      errors
    };
  }

  if (!config.sapBaseUrl) missing.push("SAP_BASE_URL");
  if (config.sapBaseUrl && isBusinessApplicationStudioUrl(config.sapBaseUrl)) {
    errors.push(
      "SAP_BASE_URL points to SAP Business Application Studio. Use the S/4HANA Cloud OData host or a destination-backed URL instead."
    );
  }

  if (config.sapBaseUrl && !isValidUrl(config.sapBaseUrl)) {
    errors.push("SAP_BASE_URL must be a valid absolute URL.");
  }

  if (isSapApiSandboxUrl(config.sapBaseUrl)) {
    if (!config.sapApiKey) missing.push("SAP_API_KEY");
  } else {
    if (!config.sapUsername) missing.push("SAP_USERNAME");
    if (!config.sapPassword) missing.push("SAP_PASSWORD");
  }

  return {
    ready: missing.length === 0 && errors.length === 0,
    missing,
    errors
  };
}

function loadDotEnv(filePath = ".env") {
  if (!existsSync(filePath)) {
    return;
  }

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function isBusinessApplicationStudioUrl(value) {
  return value.toLowerCase().includes("applicationstudio.cloud.sap");
}

function isSapApiSandboxUrl(value) {
  return value.toLowerCase().includes("sandbox.api.sap.com");
}

function isValidUrl(value) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function getHost(value) {
  if (!value) {
    return "";
  }

  try {
    return new URL(value).host;
  } catch {
    return "";
  }
}

function normalizeHanaAuthMode(value) {
  const mode = String(value || "password").trim().toLowerCase();
  if (["jwt", "uaa", "uaa-jwt", "service-key"].includes(mode)) {
    return "uaa-jwt";
  }
  return "password";
}

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasSapDestinationBinding(env) {
  if (!env.VCAP_SERVICES) {
    return false;
  }

  try {
    const services = JSON.parse(env.VCAP_SERVICES);
    return Object.values(services)
      .flat()
      .some((service) => service?.label === "destination" || service?.tags?.includes("destination"));
  } catch {
    return false;
  }
}

function getHanaBindingCredentials(env) {
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

function hasStoredGoogleToken(env) {
  const tokenPath = env.GOOGLE_OAUTH_TOKEN_PATH || resolve("data", "google-oauth-token.json");
  return existsSync(tokenPath);
}
