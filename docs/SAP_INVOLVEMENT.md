# SAP Involvement For The Inquiry Use Case

## Business Interpretation

The sample email is a customer buy request:

```text
I need 1100 tons of Iron ore / Real customer for a price of 11000 Per ton
```

That is an opportunity for your company. It should not directly become an SAP Purchase Order, because a Purchase Order is the document your company creates when buying from a supplier. In a customer inquiry flow, the customer's own PO number can be stored later as a reference on a Sales Order, but the first SAP-side object should be sales-facing.

## Recommended Flow

1. Read email.
2. Extract:
   - customer identity and email domain
   - whether this is a customer buy request, supplier offer, or internal procurement request
   - product, quantity, target price, currency, unit, and customer PO/reference if present
3. Match customer and product in master/rule data.
4. Create an Opportunity object in the app.
5. Apply the rulebook:
   - existing customer
   - known product/material
   - price floor
   - quantity/value approval thresholds
   - extraction confidence
6. Choose SAP action:
   - customer buy request: create Sales Inquiry, then quotation/order after review
   - supplier/internal procurement request: create Purchase Order

## Minimal SAP Footprint

For the demo, use this project as the opportunity intake layer and keep SAP in dry-run mode:

```env
SAP_MODE=live
SAP_SUBMIT_MODE=dry-run
SAP_DOCUMENT_TYPE=auto
```

This builds the exact payload and decision without calling a write API.

For real SAP posting, switch to:

```env
SAP_MODE=live
SAP_SUBMIT_MODE=commit
SAP_DOCUMENT_TYPE=auto
```

Then configure one of these SAP paths:

| Flow | SAP API | Scenario |
| --- | --- | --- |
| Customer inquiry | `API_SALES_INQUIRY_SRV` | Sales Inquiry Integration |
| Customer order after accepted quote/customer PO | `API_SALES_ORDER_SRV` | `SAP_COM_0109` Sales Order Integration |
| Buy-from-supplier procurement | `API_PURCHASEORDER_PROCESS_SRV` | `SAP_COM_0053` Purchase Order Integration |

## Guardrail

If an email is classified as a customer buy request and `SAP_DOCUMENT_TYPE=purchaseOrder`, the app changes the target to Sales Inquiry. This avoids creating a supplier-side PO from a customer opportunity.

## References

- SAP Sales Inquiries: https://help.sap.com/docs/SAP_S4HANA_CLOUD/03c04db2a7434731b7fe21dca77440da/22f0c6c2b32d462c8b7f1b0dd49b9c68.html
- Sales Order Integration communication scenario: https://help.sap.com/docs/SAP_S4HANA_CLOUD/03c04db2a7434731b7fe21dca77440da/a5550ea977b24a6eb6ce1ce832088567.html
- Purchase Order Integration `SAP_COM_0053`: https://help.sap.com/docs/SAP_S4HANA_CLOUD/fb2fe06f85a6e92d9746a908028bb3ce/db4dc827aa014e50ab823d514411f455.html
