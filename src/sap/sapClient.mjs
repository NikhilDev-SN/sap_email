import { resolveSapTarget } from "./destinationResolver.mjs";

export async function postOData(path, payload, config) {
  const target = await resolveSapTarget(config);

  if (!target.baseUrl) {
    throw new Error("SAP_BASE_URL or SAP_DESTINATION_NAME is required for live SAP mode.");
  }

  const tokenContext = await fetchCsrfToken(path, target);
  const response = await fetch(buildSapUrl(path, target.baseUrl), {
    method: "POST",
    headers: {
      ...target.headers,
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-csrf-token": tokenContext.token,
      ...(tokenContext.cookie ? { Cookie: tokenContext.cookie } : {})
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`SAP OData POST failed with ${response.status}: ${text}`);
  }

  return text ? JSON.parse(text) : {};
}

async function fetchCsrfToken(path, target) {
  const response = await fetch(buildSapUrl(getServiceRootPath(path), target.baseUrl), {
    method: "GET",
    headers: {
      ...target.headers,
      Accept: "application/json",
      "x-csrf-token": "Fetch"
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`SAP CSRF token fetch failed with ${response.status}: ${body}`);
  }

  return {
    token: response.headers.get("x-csrf-token") || "",
    cookie: response.headers.get("set-cookie") || ""
  };
}

function getServiceRootPath(path) {
  const match = path.match(/^(.+?_SRV)\//i);
  if (match) {
    return `${match[1]}/`;
  }

  return path;
}

function buildSapUrl(path, baseUrl) {
  const base = new URL(baseUrl);
  const basePath = base.pathname.replace(/\/$/, "");
  const servicePath = path.startsWith("/") ? path : `/${path}`;
  base.pathname = `${basePath}${servicePath}`;
  return base;
}
