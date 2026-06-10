const CUSTOMER_SALES_DOCUMENTS = new Set(["salesInquiry", "salesOrder"]);
const PROCUREMENT_DOCUMENTS = new Set(["purchaseOrder"]);

export function planSapAction(extracted, config = {}, rulebook = {}) {
  const direction = extracted.request.direction || "unknown";
  const requestedDocumentType = config.sapDocumentType || rulebook.autoCreatePolicy?.defaultDocumentType || "auto";

  if (direction === "internal_procurement_request" || direction === "supplier_offer") {
    return {
      businessFlow: "procurement",
      intent: "create_purchase_order",
      requestedDocumentType,
      documentType: "purchaseOrder",
      createSapDocument: true,
      reasons: [
        "This is a buy-from-supplier flow, so an SAP Purchase Order is the correct target document."
      ]
    };
  }

  if (direction === "customer_buy_request") {
    return planCustomerInquiryAction(extracted, requestedDocumentType, rulebook);
  }

  return {
    businessFlow: "triage",
    intent: "create_opportunity_for_review",
    requestedDocumentType,
    documentType: "salesInquiry",
    createSapDocument: false,
    reasons: ["The email direction is unclear, so SAP document creation needs review."]
  };
}

function planCustomerInquiryAction(extracted, requestedDocumentType, rulebook) {
  const reasons = [
    "Inbound customer inquiries are captured as opportunities first.",
    "A Purchase Order is only created in your SAP when your company buys from a supplier."
  ];

  if (PROCUREMENT_DOCUMENTS.has(requestedDocumentType)) {
    reasons.push(
      "The requested SAP document was purchaseOrder, but this email is a customer buy request, so the SAP target was changed to salesInquiry."
    );
  }

  if (requestedDocumentType === "salesOrder" && !extracted.request.customerPurchaseOrderReference) {
    reasons.push("No customer PO/reference was found, so a non-binding Sales Inquiry is safer than a Sales Order.");
  }

  const documentType =
    requestedDocumentType === "auto" ||
    requestedDocumentType === "purchaseOrder" ||
    (requestedDocumentType === "salesOrder" && !extracted.request.customerPurchaseOrderReference)
      ? rulebook.autoCreatePolicy?.customerInquiryDocumentType || "salesInquiry"
      : requestedDocumentType;

  return {
    businessFlow: "customer_opportunity",
    intent: documentType === "salesOrder" ? "create_sales_order" : "create_sales_inquiry",
    requestedDocumentType,
    documentType: CUSTOMER_SALES_DOCUMENTS.has(documentType) ? documentType : "salesInquiry",
    createSapDocument: true,
    reasons
  };
}
