# BTP Destination Import

`S4HANA_SANDBOX.properties` is generated locally and ignored by Git because it contains your SAP Business Accelerator Hub API key.

Import it in SAP BTP Cockpit:

1. Go to `Connectivity > Destinations`.
2. Select the `trial` context.
3. Click `Import`.
4. Choose `destinations/S4HANA_SANDBOX.properties`.
5. Save and test the destination.

This destination points to the SAP Business Accelerator Hub sandbox. It supports read calls for the Sales Order API, but SAP blocks write calls in the sandbox Try-it-out environment for this API. For real Sales Order creation, replace the URL and authentication with your own S/4HANA Cloud communication arrangement endpoint.

For a deployed BTP app, create a real tenant destination named `S4HANA_SALES_ORDER`, bind the SAP Destination service to the app, and set:

```env
SAP_MODE=live
SAP_SUBMIT_MODE=commit
SAP_DOCUMENT_TYPE=auto
SAP_DESTINATION_NAME=S4HANA_SALES_ORDER
SAP_SERVICE_PATH=/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder
```
