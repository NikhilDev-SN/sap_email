import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
const pendingStates = new Map();

export function getGoogleOAuthStatus(config) {
  return {
    mailbox: config.mailboxAddress,
    clientConfigured: Boolean(config.googleOAuthClientId && config.googleOAuthClientSecret),
    connected: existsSync(config.googleOAuthTokenPath),
    tokenPath: config.googleOAuthTokenPath,
    scopes: SCOPES
  };
}

export function createGoogleAuthUrl(config, request) {
  assertGoogleOAuthConfigured(config);

  const redirectUri = getRedirectUri(config, request);
  const state = randomBytes(24).toString("hex");
  pendingStates.set(state, {
    redirectUri,
    createdAt: Date.now()
  });

  const params = new URLSearchParams({
    client_id: config.googleOAuthClientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state
  });

  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeGoogleCodeForToken(config, callbackUrl, request) {
  assertGoogleOAuthConfigured(config);

  const code = callbackUrl.searchParams.get("code");
  const state = callbackUrl.searchParams.get("state");
  const error = callbackUrl.searchParams.get("error");

  if (error) {
    throw new Error(`Google OAuth failed: ${error}`);
  }
  if (!code || !state) {
    throw new Error("Google OAuth callback is missing code or state.");
  }

  const stateContext = pendingStates.get(state);
  pendingStates.delete(state);
  if (!stateContext || Date.now() - stateContext.createdAt > 10 * 60 * 1000) {
    throw new Error("Google OAuth state is missing or expired. Start the connection again.");
  }

  const redirectUri = stateContext.redirectUri || getRedirectUri(config, request);
  const token = await requestToken({
    clientId: config.googleOAuthClientId,
    clientSecret: config.googleOAuthClientSecret,
    redirectUri,
    body: {
      code,
      grant_type: "authorization_code"
    }
  });

  await saveToken(config, {
    ...token,
    scope: token.scope || SCOPES.join(" "),
    obtainedAt: new Date().toISOString(),
    expiresAt: getExpiresAt(token.expires_in)
  });

  return {
    mailbox: config.mailboxAddress,
    tokenPath: config.googleOAuthTokenPath,
    scopes: token.scope || SCOPES.join(" ")
  };
}

export async function getGoogleAccessToken(config) {
  const token = await readToken(config);

  if (token.access_token && token.expiresAt && Date.parse(token.expiresAt) > Date.now() + 60_000) {
    return token.access_token;
  }

  if (!token.refresh_token) {
    throw new Error("Stored Google OAuth token has no refresh token. Reconnect Gmail with consent.");
  }

  const refreshed = await requestToken({
    clientId: config.googleOAuthClientId,
    clientSecret: config.googleOAuthClientSecret,
    body: {
      refresh_token: token.refresh_token,
      grant_type: "refresh_token"
    }
  });

  const nextToken = {
    ...token,
    ...refreshed,
    refresh_token: refreshed.refresh_token || token.refresh_token,
    refreshedAt: new Date().toISOString(),
    expiresAt: getExpiresAt(refreshed.expires_in)
  };
  await saveToken(config, nextToken);
  return nextToken.access_token;
}

export async function readToken(config) {
  try {
    return JSON.parse(await readFile(config.googleOAuthTokenPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("Gmail OAuth token is not connected yet.");
    }
    throw error;
  }
}

async function requestToken({ clientId, clientSecret, redirectUri, body }) {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    ...body
  });

  if (redirectUri) {
    params.set("redirect_uri", redirectUri);
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: params.toString()
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Google OAuth token request failed with ${response.status}: ${text}`);
  }

  return text ? JSON.parse(text) : {};
}

async function saveToken(config, token) {
  await mkdir(dirname(config.googleOAuthTokenPath), { recursive: true });
  await writeFile(config.googleOAuthTokenPath, `${JSON.stringify(token, null, 2)}\n`);
}

function getRedirectUri(config, request) {
  if (config.googleOAuthRedirectUri) {
    return config.googleOAuthRedirectUri;
  }

  const host = request.headers.host || `localhost:${config.port}`;
  return `http://${host}/auth/google/callback`;
}

function getExpiresAt(expiresInSeconds) {
  if (!expiresInSeconds) {
    return null;
  }

  return new Date(Date.now() + Number(expiresInSeconds) * 1000).toISOString();
}

function assertGoogleOAuthConfigured(config) {
  if (!config.googleOAuthClientId || !config.googleOAuthClientSecret) {
    throw new Error(
      "Google OAuth client is not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env."
    );
  }
}
