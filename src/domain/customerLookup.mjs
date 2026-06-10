import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const CUSTOMER_MASTER_PATH = resolve("data", "customer-master.json");

export async function lookupCustomer(extracted, customerMasterPath = CUSTOMER_MASTER_PATH) {
  const master = JSON.parse(await readFile(customerMasterPath, "utf8"));
  const email = extracted.customer.email?.toLowerCase() || "";
  const domain = email.split("@")[1] || "";

  const match = master.customers.find((customer) => {
    const emails = customer.emails?.map((item) => String(item || "").toLowerCase()) || [];
    const domains = customer.domains?.map((item) => String(item || "").toLowerCase()) || [];
    return emails.includes(email) || domains.includes(domain);
  });

  if (match) {
    return {
      ...match,
      matchedBy: match.emails?.includes(email) ? "email" : "domain"
    };
  }

  return {
    id: null,
    name: extracted.customer.name || "Unknown customer",
    status: "new",
    tier: "new",
    sapBusinessPartner: null,
    matchedBy: "none"
  };
}
