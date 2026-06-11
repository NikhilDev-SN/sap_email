process.env.WHATSAPP_ENABLED = "true";
process.env.WHATSAPP_CONNECTOR = "web";
process.env.GMAIL_AUTO_SYNC ||= "false";
process.env.PORT ||= "4100";

if (!process.env.WHATSAPP_BRIDGE_TOKEN && !process.env.WHATSAPP_PERSONAL_BRIDGE_TOKEN) {
  console.warn("Set WHATSAPP_BRIDGE_TOKEN before exposing this personal WhatsApp worker publicly.");
}

const { startServer } = await import("./index.mjs");

startServer();
