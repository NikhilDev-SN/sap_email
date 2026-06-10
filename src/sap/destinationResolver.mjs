export async function resolveSapTarget(config, env = process.env) {
  if (!config.sapDestinationName) {
    return {
      source: "direct-url",
      baseUrl: config.sapBaseUrl,
      headers: directAuthHeaders(config)
    };
  }

  const credentials = getDestinationServiceCredentials(env);
  const accessToken = await fetchDestinationAccessToken(credentials);
  const destination = await fetchDestination(config.sapDestinationName, credentials, accessToken);

  return {
    source: "btp-destination",
    destinationName: config.sapDestinationName,
    baseUrl: getDestinationUrl(destination),
    headers: destinationAuthHeaders(destination)
  };
}

function getDestinationServiceCredentials(env) {
  if (!env.VCAP_SERVICES) {
    throw new Error("SAP Destination service binding is required when SAP_DESTINATION_NAME is set.");
  }

  let services;
  try {
    services = JSON.parse(env.VCAP_SERVICES);
  } catch {
    throw new Error("VCAP_SERVICES is not valid JSON.");
  }

  const destinationService = Object.values(services)
    .flat()
    .find((service) => service?.label === "destination" || service?.tags?.includes("destination"));

  const credentials = destinationService?.credentials;
  if (!credentials?.uri || !credentials?.url || !credentials?.clientid || !credentials?.clientsecret) {
    throw new Error("SAP Destination service credentials are incomplete.");
  }

  return credentials;
}

async function fetchDestinationAccessToken(credentials) {
  const response = await fetch(`${trimTrailingSlash(credentials.url)}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: basicAuth(credentials.clientid, credentials.clientsecret),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: "grant_type=client_credentials"
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`SAP Destination token request failed with ${response.status}: ${text}`);
  }

  const body = text ? JSON.parse(text) : {};
  if (!body.access_token) {
    throw new Error("SAP Destination token response did not include an access token.");
  }

  return body.access_token;
}

async function fetchDestination(destinationName, credentials, accessToken) {
  const response = await fetch(
    `${trimTrailingSlash(credentials.uri)}/destination-configuration/v1/destinations/${encodeURIComponent(
      destinationName
    )}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      }
    }
  );

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`SAP Destination lookup failed with ${response.status}: ${text}`);
  }

  return text ? JSON.parse(text) : {};
}

function getDestinationUrl(destination) {
  const url = destination.destinationConfiguration?.URL || destination.destinationConfiguration?.Url;
  if (!url) {
    throw new Error("SAP Destination does not include a URL.");
  }

  return url;
}

function destinationAuthHeaders(destination) {
  const headers = {};
  const configuration = destination.destinationConfiguration || {};

  for (const token of destination.authTokens || []) {
    if (token.http_header?.key && token.http_header?.value) {
      headers[token.http_header.key] = token.http_header.value;
    } else if (token.type && token.value) {
      headers.Authorization = `${token.type} ${token.value}`;
    }
  }

  if (!headers.Authorization && configuration.Authentication === "BasicAuthentication") {
    if (!configuration.User || !configuration.Password) {
      throw new Error("SAP Destination uses BasicAuthentication but has no User/Password.");
    }
    headers.Authorization = basicAuth(configuration.User, configuration.Password);
  }

  if (configuration.APIKey) {
    headers.APIKey = configuration.APIKey;
  }

  return headers;
}

function directAuthHeaders(config) {
  if (config.sapApiKey) {
    return {
      APIKey: config.sapApiKey
    };
  }

  if (!config.sapUsername || !config.sapPassword) {
    return {};
  }

  return {
    Authorization: basicAuth(config.sapUsername, config.sapPassword)
  };
}

function basicAuth(username, password) {
  const encoded = Buffer.from(`${username}:${password}`).toString("base64");
  return `Basic ${encoded}`;
}

function trimTrailingSlash(value) {
  return value.replace(/\/$/, "");
}
