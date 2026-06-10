const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["customer", "request", "confidence", "rawSummary"],
  properties: {
    customer: {
      type: "object",
      additionalProperties: false,
      required: ["name", "email", "statusHint"],
      properties: {
        name: { type: ["string", "null"] },
        email: { type: ["string", "null"] },
        statusHint: { type: ["string", "null"], enum: ["new", "existing", "real", null] }
      }
    },
    request: {
      type: "object",
      additionalProperties: false,
      required: ["type", "direction", "product", "quantity", "targetPrice", "customerPurchaseOrderReference"],
      properties: {
        type: { type: "string", enum: ["new_inquiry", "follow_up", "change_request"] },
        direction: {
          type: "string",
          enum: ["customer_buy_request", "internal_procurement_request", "supplier_offer", "unknown"]
        },
        product: { type: ["string", "null"] },
        quantity: {
          type: "object",
          additionalProperties: false,
          required: ["value", "unit"],
          properties: {
            value: { type: ["number", "null"] },
            unit: { type: ["string", "null"] }
          }
        },
        targetPrice: {
          type: "object",
          additionalProperties: false,
          required: ["amount", "currency", "perUnit"],
          properties: {
            amount: { type: ["number", "null"] },
            currency: { type: ["string", "null"] },
            perUnit: { type: ["string", "null"] }
          }
        },
        customerPurchaseOrderReference: { type: ["string", "null"] }
      }
    },
    confidence: { type: "number" },
    rawSummary: { type: "string" }
  }
};

export async function extractInquiry(email, config) {
  if (config.aiProvider === "openai" && config.openaiApiKey) {
    try {
      return await extractWithOpenAI(email, config);
    } catch (error) {
      return {
        ...heuristicExtract(email),
        extractionWarning: `OpenAI extraction failed; heuristic fallback used: ${error.message}`
      };
    }
  }

  return heuristicExtract(email);
}

async function extractWithOpenAI(email, config) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.openaiModel,
      input: [
        {
          role: "system",
          content:
            "Extract structured inquiry data from emails. Classify direction carefully: customer_buy_request means a customer wants to buy from us; internal_procurement_request means our company needs to buy from a supplier; supplier_offer means a supplier is offering to sell. Return only fields in the schema. If a value is missing, use null and reduce confidence."
        },
        {
          role: "user",
          content: JSON.stringify(email)
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "inquiry_extraction",
          schema: EXTRACTION_SCHEMA,
          strict: true
        }
      }
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI request failed with ${response.status}: ${body}`);
  }

  const data = await response.json();
  const outputText = data.output_text || collectResponseText(data);
  return normalizeExtraction(JSON.parse(outputText), email);
}

function heuristicExtract(email) {
  const body = email.body || "";
  const text = `${email.subject || ""}\n${body}`;
  const lineItem = extractFirstLineItem(text);
  const quantityMatch = lineItem ? null : text.match(/(\d+(?:[.,]\d+)?)\s*(tons?|tonnes?|metric tons?|mt)\b/i);
  const quantityValue = lineItem?.quantity ?? (quantityMatch ? Number(quantityMatch[1].replace(/,/g, "")) : null);
  const quantityUnit = lineItem?.unit ?? (quantityMatch ? normalizeUnit(quantityMatch[2]) : null);

  const product = lineItem?.product ?? extractProduct(text, quantityMatch);
  const priceMatch = lineItem
    ? null
    : text.match(
        /(?:price\s*of|offer(?:ed)?\s*price\s*(?:of)?|at|for)\s*(?:([A-Z]{3})\s*)?([\d,]+(?:\.\d+)?)\s*(?:per|\/)\s*(ton|tonne|tons?|mt)\b/i
      );
  const targetPriceAmount = lineItem?.price ?? (priceMatch ? Number(priceMatch[2].replace(/,/g, "")) : null);
  const targetPriceCurrency = lineItem?.currency || priceMatch?.[1] || inferCurrency(text) || "INR";

  const lowerText = text.toLowerCase();
  const requestType = /\b(previous|existing order|old inquiry|follow[- ]?up)\b/i.test(text)
    ? "follow_up"
    : "new_inquiry";
  const statusHint = lowerText.includes("real customer")
    ? "real"
    : lowerText.includes("new customer")
      ? "new"
      : null;
  const direction = inferDirection(text);
  const customerPurchaseOrderReference = extractCustomerPoReference(text);

  return normalizeExtraction(
    {
      customer: {
        name: inferCustomerName(email.from, text),
        email: extractEmail(email.from),
        statusHint
      },
      request: {
        type: requestType,
        direction,
        product,
        quantity: {
          value: quantityValue,
          unit: quantityUnit
        },
        targetPrice: {
          amount: targetPriceAmount,
          currency: targetPriceCurrency,
          perUnit: lineItem?.perUnit ?? (priceMatch ? normalizeUnit(priceMatch[3]) : quantityUnit)
        },
        customerPurchaseOrderReference
      },
      confidence: estimateConfidence({ product, quantityValue, targetPriceAmount }),
      rawSummary: body.trim()
    },
    email
  );
}

function extractFirstLineItem(text) {
  const lineItemMatch = text.match(
    /^\s*(?:[-*]\s*)?(?:\d+[.)]\s*)?([A-Za-z][^:\r\n]+?)\s*:\s*([\d,]+(?:\.\d+)?)\s*(MT|tons?|tonnes?|metric tons?)\s*@\s*(?:(USD|INR)\s*)?([$₹])?\s*([\d,]+(?:\.\d+)?)\s*\/\s*(MT|tons?|tonnes?|metric tons?)\b/im
  );

  if (!lineItemMatch) {
    return null;
  }

  return {
    product: titleCase(lineItemMatch[1].trim()),
    quantity: Number(lineItemMatch[2].replace(/,/g, "")),
    unit: normalizeUnit(lineItemMatch[3]),
    price: Number(lineItemMatch[6].replace(/,/g, "")),
    currency: lineItemMatch[4] || currencyFromSymbol(lineItemMatch[5]) || inferCurrency(text) || "INR",
    perUnit: normalizeUnit(lineItemMatch[7])
  };
}

function extractProduct(text, quantityMatch) {
  if (!quantityMatch) {
    return null;
  }

  const afterQuantity = text.slice((quantityMatch.index || 0) + quantityMatch[0].length);
  const productMatch = afterQuantity.match(/\s+of\s+([a-z][a-z0-9\s-]*?)(?:\s*\/|\s+for\b|\s+at\b|,|\.|\n|$)/i);
  if (!productMatch) {
    return null;
  }

  return titleCase(productMatch[1].trim());
}

function normalizeExtraction(extraction, email) {
  return {
    source: {
      messageId: email.messageId || null,
      threadId: email.threadId || null,
      from: email.from || null,
      subject: email.subject || null,
      provider: email.provider || email.source || "email",
      receivedAt: email.receivedAt || null
    },
    customer: extraction.customer,
    request: {
      direction: "unknown",
      customerPurchaseOrderReference: null,
      ...extraction.request
    },
    confidence: Math.max(0, Math.min(1, Number(extraction.confidence || 0))),
    rawSummary: extraction.rawSummary || email.body || "",
    extractionWarning: extraction.extractionWarning
  };
}

function inferDirection(text) {
  if (/\b(raise|create|issue)\s+(a\s+)?p\.?o\.?\b/i.test(text) || /\bpurchase order\s+to\s+(vendor|supplier)\b/i.test(text)) {
    return "internal_procurement_request";
  }

  if (/\b(purchase order issued|attached purchase order|customer purchase order|customer po)\b/i.test(text)) {
    return "customer_buy_request";
  }

  if (/\b(we can supply|supplier quote|vendor quote|quotation from supplier|we offer)\b/i.test(text)) {
    return "supplier_offer";
  }

  if (/\b(i need|we need|requirement|request for quote|rfq|price of|per ton|per mt)\b/i.test(text)) {
    return "customer_buy_request";
  }

  return "unknown";
}

function extractCustomerPoReference(text) {
  const explicitPoMatch = text.match(/\bPO-\d{4,}[-A-Z0-9]*\b/i);
  if (explicitPoMatch) {
    return explicitPoMatch[0].toUpperCase();
  }

  const match = text.match(/\b(?:customer\s*)?(?:po|p\.o\.|purchase order)\s*(?:no\.?|number|#|:)?\s*([A-Z0-9-]{4,})\b/i);
  return match ? match[1].toUpperCase() : null;
}

function collectResponseText(data) {
  return (data.output || [])
    .flatMap((item) => item.content || [])
    .filter((part) => part.type === "output_text" || part.type === "text")
    .map((part) => part.text)
    .join("");
}

function estimateConfidence({ product, quantityValue, targetPriceAmount }) {
  let score = 0.35;
  if (product) score += 0.2;
  if (quantityValue) score += 0.2;
  if (targetPriceAmount) score += 0.2;
  return Number(Math.min(score, 0.95).toFixed(2));
}

function normalizeUnit(unit) {
  if (!unit) return null;
  const normalized = unit.toLowerCase();
  if (normalized === "mt" || normalized.includes("ton")) return "ton";
  return normalized;
}

function inferCurrency(text) {
  if (text.includes("₹") || /\bINR\b/i.test(text)) return "INR";
  if (text.includes("$") || /\bUSD\b/i.test(text)) return "USD";
  return null;
}

function currencyFromSymbol(symbol) {
  if (symbol === "₹") return "INR";
  if (symbol === "$") return "USD";
  return null;
}

function extractEmail(value = "") {
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : null;
}

function inferCustomerName(value = "", text = "") {
  const poCustomerName = inferPoCustomerName(text);
  if (poCustomerName) {
    return poCustomerName;
  }

  const email = extractEmail(value);
  if (!email) return value || null;
  const domain = email.split("@")[1]?.split(".")[0] || "";
  return titleCase(domain.replace(/[-_]/g, " "));
}

function inferPoCustomerName(text) {
  const subjectCustomer = text.match(
    /Purchase Order(?:\s+Issued|\s+Attached)?:\s*PO-[A-Z0-9-]+(?:\s*[-|]\s*)([^\r\n]+)/i
  );
  if (subjectCustomer) {
    return titleCase(subjectCustomer[1].trim());
  }

  const bodyCustomer = text.match(/\bPurchase Order\s+PO-[A-Z0-9-]+\s+from\s+(.+?)(?:\s+for\b|\.|\r|\n)/i);
  return bodyCustomer ? titleCase(bodyCustomer[1].trim()) : null;
}

function titleCase(value) {
  return value.replace(/\w\S*/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
}
