import { getSapLiveReadiness } from "../config.mjs";
import { postOData } from "./sapClient.mjs";

const DEFAULT_SERVICE_PATHS = {
  salesInquiry: "/sap/opu/odata/sap/API_SALES_INQUIRY_SRV/A_SalesInquiry",
  salesOrder: "/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder",
  purchaseOrder: "/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrder"
};

export async function createSapDocument({ extracted, customer, decision, opportunity }, config) {
  const documentType = decision.documentType || config.sapDocumentType || "salesInquiry";
  const payload = buildSapPayload({ extracted, customer, decision, opportunity }, config, documentType);
  const servicePath = resolveServicePath(config, documentType);

  if (config.sapMode !== "live") {
    return {
      mode: "mock",
      documentType,
      documentId: `MOCK-${documentPrefix(documentType)}-${Date.now()}`,
      servicePath,
      opportunityId: opportunity?.id,
      payload
    };
  }

  if (config.sapSubmitMode !== "commit") {
    return {
      mode: "planned",
      submitMode: config.sapSubmitMode,
      documentType,
      servicePath,
      opportunityId: opportunity?.id,
      message: "SAP payload is ready. Set SAP_SUBMIT_MODE=commit after the real S/4HANA communication arrangement is available.",
      payload
    };
  }

  assertLiveSapReady(config);

  const response = await postOData(servicePath, payload, config);
  return {
    mode: "live",
    documentType,
    servicePath,
    opportunityId: opportunity?.id,
    response
  };
}

function assertLiveSapReady(config) {
  const readiness = getSapLiveReadiness(config);
  if (readiness.ready) {
    return;
  }

  const missing = readiness.missing.length
    ? `Missing required live SAP settings: ${readiness.missing.join(", ")}.`
    : "";
  const errors = readiness.errors.join(" ");
  throw new Error([missing, errors].filter(Boolean).join(" "));
}

function buildSapPayload({ extracted, customer, decision, opportunity }, config, documentType) {
  const context = {
    opportunityId: opportunity?.id,
    businessFlow: decision.sapAction.businessFlow,
    sapIntent: decision.sapAction.intent,
    sourceEmail: extracted.source.from,
    sourceSubject: extracted.source.subject,
    extractionConfidence: extracted.confidence,
    requestType: extracted.request.type,
    requestDirection: extracted.request.direction,
    action: decision.action,
    reasons: decision.reasons
  };

  const commonItem = {
    Material: decision.productRule?.materialCode || "",
    RequestedQuantity: String(decision.commercial.quantity),
    RequestedQuantityUnit: config.sapQuantityUnit || decision.commercial.unit
  };

  const documentCurrency = config.sapTransactionCurrency || decision.commercial.currency;

  if (documentType === "purchaseOrder") {
    return {
      PurchaseOrderType: "NB",
      CompanyCode: config.sapCompanyCode,
      PurchasingOrganization: config.sapPurchasingOrg,
      PurchasingGroup: config.sapPurchasingGroup,
      Supplier: customer.sapBusinessPartner || "",
      DocumentCurrency: documentCurrency,
      to_PurchaseOrderItem: [
        {
          PurchaseOrderItem: "10",
          Material: commonItem.Material,
          OrderQuantity: commonItem.RequestedQuantity,
          PurchaseOrderQuantityUnit: commonItem.RequestedQuantityUnit,
          NetPriceAmount: String(decision.commercial.pricePerUnit)
        }
      ],
      AIContext: context
    };
  }

  if (documentType === "salesOrder") {
    return {
      SalesOrderType: "OR",
      SalesOrganization: config.sapSalesOrg,
      DistributionChannel: config.sapDistributionChannel,
      OrganizationDivision: config.sapDivision,
      SoldToParty: customer.sapBusinessPartner || "",
      TransactionCurrency: documentCurrency,
      PurchaseOrderByCustomer: extracted.request.customerPurchaseOrderReference || `AI-${Date.now()}`,
      to_Item: {
        results: [
          {
            SalesOrderItem: "10",
            ...commonItem
          }
        ]
      },
      AIContext: context
    };
  }

  return {
    SalesInquiryType: "IN",
    SalesOrganization: config.sapSalesOrg,
    DistributionChannel: config.sapDistributionChannel,
    OrganizationDivision: config.sapDivision,
    SoldToParty: customer.sapBusinessPartner || "",
    TransactionCurrency: documentCurrency,
    to_Item: {
      results: [
        {
          SalesInquiryItem: "10",
          ...commonItem
        }
      ]
    },
    AIContext: context
  };
}

function documentPrefix(documentType) {
  if (documentType === "purchaseOrder") return "PO";
  if (documentType === "salesOrder") return "SO";
  return "SI";
}

function resolveServicePath(config, documentType) {
  if (config.sapDocumentType === "auto") {
    return DEFAULT_SERVICE_PATHS[documentType];
  }

  return config.sapServicePath || DEFAULT_SERVICE_PATHS[documentType];
}
