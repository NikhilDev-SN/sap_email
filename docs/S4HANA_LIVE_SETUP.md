# S/4HANA Live Setup

The app is already able to run in live mode. The remaining SAP-side requirement is an S/4HANA Cloud tenant that exposes the Sales Order API through a communication arrangement.

## What Your Current Trial Can Do

- SAP Business Accelerator Hub sandbox can prove API connectivity and metadata reads.
- SAP BTP cockpit can hold a Destination for the API endpoint.
- SAP Business Application Studio can run or deploy this app.

The sandbox is not enough to create a real Sales Order. A write call needs your own S/4HANA Cloud tenant, a communication user, and a communication arrangement.

## Minimal SAP Path

Use this when you only want the smallest SAP footprint for the prototype:

1. In S/4HANA Cloud Public Edition, open the Fiori launchpad as an integration/admin user.
2. Open `Communication Systems`.
3. Create a system for this app, for example `AI_INQUIRY_AGENT`.
4. Add an inbound communication user and password. Keep this as a technical user, not your personal SAP login.
5. Open `Communication Arrangements`.
6. Create an arrangement for `SAP_COM_0109` Sales Order Integration.
7. Assign the communication system from step 3.
8. Enable the inbound OData service for `API_SALES_ORDER_SRV`.
9. Copy the service host, for example `https://myXXXXXX-api.s4hana.cloud.sap`.
10. Confirm the entity path is `/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder`.

Then either configure the app directly:

```env
SAP_MODE=live
SAP_SUBMIT_MODE=commit
SAP_DOCUMENT_TYPE=auto
SAP_BASE_URL=https://myXXXXXX-api.s4hana.cloud.sap
SAP_SERVICE_PATH=/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder
SAP_USERNAME=<communication-user>
SAP_PASSWORD=<communication-user-password>
```

Or configure it through SAP BTP Destination, which is preferred for deployment:

```env
SAP_MODE=live
SAP_SUBMIT_MODE=commit
SAP_DOCUMENT_TYPE=auto
SAP_DESTINATION_NAME=S4HANA_SALES_ORDER
SAP_SERVICE_PATH=/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder
```

## BTP Destination

Create a BTP Destination named `S4HANA_SALES_ORDER`:

```properties
Name=S4HANA_SALES_ORDER
Type=HTTP
ProxyType=Internet
URL=https://myXXXXXX-api.s4hana.cloud.sap
Authentication=BasicAuthentication
User=<communication-user>
Password=<communication-user-password>
```

Bind the SAP Destination service to the deployed app. At runtime, SAP BTP provides `VCAP_SERVICES`; the app uses that to fetch the destination securely and avoids storing the communication user in `.env`.

## Field Mapping To Validate

These values must exist in the target S/4HANA tenant:

- `SAP_SALES_ORG`
- `SAP_DISTRIBUTION_CHANNEL`
- `SAP_DIVISION`
- Sold-to party in `data/customer-master.json`
- Material code in `data/rulebook.json`
- Currency and requested quantity unit

The sandbox sample currently uses placeholder-friendly values such as `1710`, `10`, `00`, `17100001`, `TG11`, `USD`, and `PC`. A customer tenant usually has different master data, so update the rulebook and customer master before the first write test.

## Official SAP References

- Sales Order Integration communication scenario: https://help.sap.com/docs/SAP_S4HANA_CLOUD/03c04db2a7434731b7fe21dca77440da/a5550ea977b24a6eb6ce1ce832088567.html
- S/4HANA Cloud BTP service plans and `api-access`: https://help.sap.com/docs/btp/sap-business-technology-platform/supported-service-plans-for-sap-s-4hana-cloud
- Sales Order API: https://api.sap.com/api/API_SALES_ORDER_SRV/overview
