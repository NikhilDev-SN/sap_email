import test from "node:test";
import assert from "node:assert/strict";
import { getConfig, getHanaStorageReadiness, getSapLiveReadiness } from "../src/config.mjs";

test("live destination mode requires a bound SAP Destination service", () => {
  const config = getConfig({
    SAP_MODE: "live",
    SAP_SUBMIT_MODE: "commit",
    SAP_DESTINATION_NAME: "S4HANA_SALES_ORDER"
  });

  const readiness = getSapLiveReadiness(config);

  assert.equal(readiness.ready, false);
  assert.ok(readiness.errors.some((error) => error.includes("SAP Destination service binding")));
});

test("live destination mode is ready when VCAP_SERVICES contains destination credentials", () => {
  const config = getConfig({
    SAP_MODE: "live",
    SAP_SUBMIT_MODE: "commit",
    SAP_DESTINATION_NAME: "S4HANA_SALES_ORDER",
    VCAP_SERVICES: JSON.stringify({
      destination: [
        {
          label: "destination",
          credentials: {
            uri: "https://destination.example.com",
            url: "https://auth.example.com",
            clientid: "client-id",
            clientsecret: "client-secret"
          }
        }
      ]
    })
  });

  const readiness = getSapLiveReadiness(config);

  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.errors, []);
});

test("live dry-run mode does not require SAP credentials", () => {
  const config = getConfig({
    SAP_MODE: "live",
    SAP_SUBMIT_MODE: "dry-run",
    SAP_DOCUMENT_TYPE: "auto"
  });

  const readiness = getSapLiveReadiness(config);

  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.missing, []);
  assert.deepEqual(readiness.errors, []);
});

test("hana persistence waits for a running instance and connection credentials", () => {
  const config = getConfig({
    OPPORTUNITY_STORE_BACKEND: "hana",
    HANA_AUTH_MODE: "password",
    HANA_INSTANCE_ID: "7c05f82b-1c99-49b3-877c-848b17b7c8d4",
    HANA_INSTANCE_STATUS: "Creation in Progress"
  });

  const readiness = getHanaStorageReadiness(config);

  assert.equal(readiness.ready, false);
  assert.ok(readiness.missing.includes("HANA_HOST"));
  assert.ok(readiness.missing.includes("HANA_USER"));
  assert.ok(readiness.errors.some((error) => error.includes("Creation in Progress")));
});

test("hana persistence accepts UAA service key credentials for JWT mode", () => {
  const config = getConfig({
    OPPORTUNITY_STORE_BACKEND: "hana",
    HANA_AUTH_MODE: "uaa-jwt",
    HANA_HOST: "hana.example.com",
    HANA_PORT: "443",
    HANA_INSTANCE_STATUS: "Created",
    HANA_UAA_URL: "https://trial.authentication.example.com",
    HANA_CLIENT_ID: "client-id",
    HANA_CLIENT_SECRET: "client-secret",
    HANA_ENABLE_NATIVE_JWT: "true"
  });

  const readiness = getHanaStorageReadiness(config);

  assert.equal(config.hanaAuthMode, "uaa-jwt");
  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.missing, []);
  assert.deepEqual(readiness.errors, []);
});

test("hana UAA service key alone is not treated as SQL-write ready", () => {
  const config = getConfig({
    OPPORTUNITY_STORE_BACKEND: "hana",
    HANA_AUTH_MODE: "uaa-jwt",
    HANA_HOST: "hana.example.com",
    HANA_PORT: "443",
    HANA_INSTANCE_STATUS: "Created",
    HANA_UAA_URL: "https://trial.authentication.example.com",
    HANA_CLIENT_ID: "client-id",
    HANA_CLIENT_SECRET: "client-secret"
  });

  const readiness = getHanaStorageReadiness(config);

  assert.equal(readiness.ready, false);
  assert.ok(readiness.errors.some((error) => error.includes("JWT user mapping")));
});

test("serverless deployments use WhatsApp personal bridge instead of browser sessions", () => {
  const config = getConfig({
    NETLIFY: "true",
    WHATSAPP_ENABLED: "true"
  });

  assert.equal(config.whatsappEnabled, true);
  assert.equal(config.whatsappConnector, "personal-bridge");
  assert.equal(config.whatsappPersonalBridgeEnabled, true);
  assert.equal(config.whatsappCloudEnabled, false);
  assert.equal(config.whatsappWebEnabled, false);
  assert.equal(config.whatsappQrDisabledReason, "");
});

test("WhatsApp Cloud API can still be explicitly selected", () => {
  const config = getConfig({
    NETLIFY: "true",
    WHATSAPP_ENABLED: "true",
    WHATSAPP_CONNECTOR: "cloud-api",
    WHATSAPP_CLOUD_VERIFY_TOKEN: "verify-me"
  });

  assert.equal(config.whatsappConnector, "cloud-api");
  assert.equal(config.whatsappCloudEnabled, true);
  assert.equal(config.whatsappPersonalBridgeEnabled, false);
});

test("explicit local WhatsApp enable remains available outside serverless", () => {
  const config = getConfig({
    WHATSAPP_ENABLED: "true"
  });

  assert.equal(config.whatsappEnabled, true);
  assert.equal(config.whatsappConnector, "web");
  assert.equal(config.whatsappWebEnabled, true);
  assert.equal(config.whatsappDisabledReason, "");
});

test("explicit QR mode remains blocked in serverless unless allowed", () => {
  const config = getConfig({
    NETLIFY: "true",
    WHATSAPP_ENABLED: "true",
    WHATSAPP_CONNECTOR: "web"
  });

  assert.equal(config.whatsappEnabled, true);
  assert.equal(config.whatsappConnector, "web");
  assert.equal(config.whatsappWebEnabled, false);
  assert.match(config.whatsappQrDisabledReason, /serverless deployments/i);
});
