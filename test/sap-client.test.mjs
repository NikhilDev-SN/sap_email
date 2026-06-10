import test from "node:test";
import assert from "node:assert/strict";
import { postOData } from "../src/sap/sapClient.mjs";

test("posts through a BTP destination-backed S/4HANA target", async () => {
  const originalFetch = globalThis.fetch;
  const originalVcap = process.env.VCAP_SERVICES;
  const calls = [];

  process.env.VCAP_SERVICES = JSON.stringify({
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
  });

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });

    if (String(url).endsWith("/oauth/token")) {
      return jsonResponse({ access_token: "destination-token" });
    }

    if (String(url).includes("/destination-configuration/v1/destinations/S4HANA_SALES_ORDER")) {
      return jsonResponse({
        destinationConfiguration: {
          URL: "https://tenant.example.com",
          Authentication: "BasicAuthentication",
          User: "COMM_USER",
          Password: "COMM_SECRET"
        }
      });
    }

    if (String(url).endsWith("/sap/opu/odata/sap/API_SALES_ORDER_SRV/")) {
      return jsonResponse(
        {},
        {
          "x-csrf-token": "csrf-token",
          "set-cookie": "sap-contextid=abc"
        }
      );
    }

    if (String(url).endsWith("/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder")) {
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization.startsWith("Basic "), true);
      assert.equal(options.headers["x-csrf-token"], "csrf-token");
      assert.equal(options.headers.Cookie, "sap-contextid=abc");
      return jsonResponse({ d: { SalesOrder: "5000000001" } });
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const response = await postOData(
      "/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder",
      { SalesOrderType: "OR" },
      {
        sapDestinationName: "S4HANA_SALES_ORDER"
      }
    );

    assert.equal(response.d.SalesOrder, "5000000001");
    assert.equal(calls.length, 4);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalVcap === undefined) {
      delete process.env.VCAP_SERVICES;
    } else {
      process.env.VCAP_SERVICES = originalVcap;
    }
  }
});

function jsonResponse(body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...headers
    }
  });
}
