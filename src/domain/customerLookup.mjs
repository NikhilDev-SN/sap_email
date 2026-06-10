import { readFile } from "node:fs/promises";

const CUSTOMER_MASTER_URL = new URL("../../data/customer-master.json", import.meta.url);

export async function lookupCustomer(extracted, customerMasterUrl = CUSTOMER_MASTER_URL) {
  const master = JSON.parse(await readFile(customerMasterUrl, "utf8"));
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
