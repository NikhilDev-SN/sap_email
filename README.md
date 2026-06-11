# SAP Opportunity AI Agent

This repo turns inquiry emails into structured opportunity data, checks the request against a rulebook, and prepares the right SAP action through a swappable adapter.

For a customer asking to buy material from you, the SAP flow is usually `Opportunity -> Sales Inquiry -> Quotation -> Sales Order`. A Purchase Order is normally used when your company buys from a supplier. This project treats the email as an opportunity first, then chooses the SAP target from the business flow.

## Flow

1. Read an email inquiry.
2. Extract context: customer, new/existing status, product, quantity, ask price, currency, and confidence.
3. Look up customer and product rules.
4. Create an opportunity decision.
5. Choose the SAP action:
   - Customer buy request: prepare a Sales Inquiry by default.
   - Supplier/internal procurement request: prepare a Purchase Order.
6. Create a mock document, dry-run SAP payload, or live SAP document depending on configuration.

The dashboard stores every processed opportunity locally by default, or in SAP HANA Cloud when HANA persistence is configured, and shows the SAP action state in the queue.

## Run Locally

```bash
npm test
npm start
```

Then send the sample inquiry:

```bash
curl -X POST http://localhost:4000/inquiries/process \
  -H "Content-Type: application/json" \
  -d "{\"from\":\"procurement@realcustomer.example\",\"subject\":\"Iron ore requirement\",\"body\":\"I need 1100 tons of Iron ore / Real customer for a price of 11000 Per ton\"}"
```

## WhatsApp Dashboard

The dashboard includes a WhatsApp tab for mining sales order messages. It supports personal WhatsApp accounts through a bridge worker:

- `WHATSAPP_CONNECTOR=personal-bridge` for Vercel/Netlify. The deployed dashboard makes one request to a persistent worker and fetches only messages received in the last few minutes.
- `WHATSAPP_CONNECTOR=web` for the persistent worker/local app. This uses QR login with `whatsapp-web.js` and works with a personal WhatsApp account.
- `WHATSAPP_CONNECTOR=cloud-api` remains available for WhatsApp Business Cloud API webhook setups, but it is not required for personal-account use.

On Vercel and Netlify the app defaults to personal bridge mode, because personal WhatsApp QR login needs a long-running browser process and does not fit serverless functions. Run the same project on a persistent Node host or a local machine as the worker:

```bash
WHATSAPP_ENABLED=true
WHATSAPP_CONNECTOR=web
WHATSAPP_BRIDGE_TOKEN=choose-a-long-random-token
WHATSAPP_RECENT_MINUTES=5
npm start
```

Open the worker dashboard, choose `WhatsApp`, click `Start QR login`, and scan the QR code with the personal WhatsApp account. Keep that worker running and expose it over HTTPS with your host, reverse proxy, ngrok, or Cloudflare Tunnel.

Then configure Vercel/Netlify with:

```bash
WHATSAPP_ENABLED=true
WHATSAPP_CONNECTOR=personal-bridge
WHATSAPP_PERSONAL_BRIDGE_URL=https://your-worker.example
WHATSAPP_PERSONAL_BRIDGE_TOKEN=the-same-token-as-the-worker
WHATSAPP_RECENT_MINUTES=5
```

The deployed dashboard's `Fetch recent` button calls:

```text
POST https://your-worker.example/whatsapp/personal/recent
```

The worker scans chats, keeps only messages received within `WHATSAPP_RECENT_MINUTES`, filters for mining sales order intent, and sends the matching opportunities back to the deployed dashboard.

Matching messages are processed through the same inquiry pipeline as Gmail and land in the approval queue. The default search catches `mining sales order`, the typo `minning sales order`, and common ore/coal sales order phrases. Tune it with:

```bash
WHATSAPP_SEARCH_TERMS=mining sales order,minning sales order,iron ore sales order
WHATSAPP_CHAT_LIMIT=30
WHATSAPP_LOOKBACK_LIMIT=50
WHATSAPP_PROCESS_LIMIT=20
```

The WhatsApp Web session is saved under `data/whatsapp-session` and is ignored by Git. If Puppeteer cannot find Chrome or Edge automatically, set `WHATSAPP_CHROME_PATH` to the browser executable path.

## Clone Into SAP Business Application Studio

1. Create a new GitHub repository.
2. Push this folder to that repo.
3. In SAP Business Application Studio, choose `Clone from Git`.
4. Open the project terminal and run `npm start`.
5. Keep `SAP_MODE=mock` for demos.
6. Switch to `SAP_MODE=live` only after your SAP S/4HANA API, destination, communication arrangement, and field mapping are ready.

## Configuration

Copy `.env.example` to `.env` and update values.

The app loads `.env` automatically when it starts.

`AI_PROVIDER=heuristic` uses the local parser for demos.

`AI_PROVIDER=openai` uses the OpenAI Responses API through `fetch`, with a strict JSON extraction prompt. Keep `OPENAI_API_KEY` outside Git.

`SAP_DOCUMENT_TYPE` can be:

- `auto`
- `salesInquiry`
- `salesOrder`
- `purchaseOrder`

`auto` maps customer inquiries to `salesInquiry` and procurement flows to `purchaseOrder`.

`SAP_MODE=mock` returns a simulated document id.

`SAP_MODE=live` with `SAP_SUBMIT_MODE=dry-run` builds the SAP payload without posting. Use this while the real S/4HANA communication arrangement is not available.

`SAP_MODE=live` with `SAP_SUBMIT_MODE=commit` posts to `SAP_BASE_URL + SAP_SERVICE_PATH`, or to the URL resolved from `SAP_DESTINATION_NAME` when the app is deployed on SAP BTP with a bound Destination service. The live adapter includes CSRF token handling, API key headers for the SAP sandbox, Basic Auth, and BTP Destination lookup.

For a real SAP create, you still need an S/4HANA Cloud tenant with a communication arrangement for the API, plus the customer's SAP Business Partner/Sold-to Party id. SAP Business Application Studio or BTP cockpit credentials are useful for development, but they are not the same thing as an S/4HANA communication user.

See `docs/SAP_INVOLVEMENT.md` for the process design and `docs/S4HANA_LIVE_SETUP.md` for the minimal SAP setup.

See `docs/GMAIL_INTAKE.md` for the mailbox setup. Use Gmail OAuth or a Gmail app password; do not use the normal Gmail password in this project.

`OPPORTUNITY_STORE_BACKEND=file` keeps records in `data/opportunities.json`. Set `OPPORTUNITY_STORE_BACKEND=hana` only after the SAP HANA Cloud instance is running and you have either SQL credentials (`HANA_USER`/`HANA_PASSWORD`) or service-key UAA credentials plus HANA JWT user mapping (`HANA_AUTH_MODE=uaa-jwt`, `HANA_UAA_URL`, `HANA_CLIENT_ID`, `HANA_CLIENT_SECRET`, `HANA_ENABLE_NATIVE_JWT=true`). The HANA instance id by itself cannot store records.

## Rulebook

Business rules live in `data/rulebook.json`. Business users can adjust product price floors, auto-create limits, approval thresholds, and customer policies without changing code.
# sap_email
