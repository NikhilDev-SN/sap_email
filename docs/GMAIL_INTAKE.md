# Gmail Intake

The dashboard is configured around this mailbox:

```env
MAILBOX_ADDRESS=nikh.sant123@gmail.com
```

Do not store or use the normal Gmail password in the project. For automated inbox sync, use Google OAuth:

```env
GOOGLE_OAUTH_CLIENT_ID=<from Google Cloud Console>
GOOGLE_OAUTH_CLIENT_SECRET=<from Google Cloud Console>
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:4001/auth/google/callback
GOOGLE_OAUTH_TOKEN_PATH=data/google-oauth-token.json
```

The dashboard has:

- `Connect Gmail`: starts Google consent and stores the refresh token locally.
- `Sync Gmail`: reads recent Gmail messages through the Gmail API and updates the dashboard silently.

Until OAuth client credentials are added, inbound opportunities can be processed through the composer and are persisted in `data/opportunities.json`.

The redirect URI must exactly match the OAuth client configuration in Google Cloud Console. If the app is running on port `4001`, add:

```text
http://localhost:4001/auth/google/callback
```

If Google shows `Error 403: access_denied` while the app is in testing mode, add the mailbox user as a test user:

1. Open Google Cloud Console.
2. Go to `Google Auth Platform`.
3. Open `Audience`.
4. Under `Test users`, add `nikh.sant123@gmail.com`.
5. Save, wait a minute, then retry `http://localhost:4000/auth/google/start`.

For this project the current redirect URI is:

```text
http://localhost:4000/auth/google/callback
```

## Opportunity Persistence

Every processed email is stored locally with:

- extracted inquiry context
- matched customer
- opportunity record
- rule decision
- SAP planned/posted result

The local opportunity file is ignored by Git.

### SAP HANA Cloud PO Record Store

The app can persist the same opportunity/PO records into SAP HANA Cloud instead of the local JSON file:

```env
OPPORTUNITY_STORE_BACKEND=hana
HANA_AUTH_MODE=password
HANA_HOST=<hana-cloud-host>
HANA_PORT=443
HANA_USER=<service-key-user>
HANA_PASSWORD=<service-key-password>
HANA_SCHEMA=<schema-or-user>
HANA_TABLE=PO_RECORDS
```

For a HANA Cloud database service key that only has UAA credentials, use JWT mode:

```env
OPPORTUNITY_STORE_BACKEND=hana
HANA_AUTH_MODE=uaa-jwt
HANA_HOST=<hana-cloud-host>
HANA_PORT=443
HANA_UAA_URL=<uaa-url>
HANA_CLIENT_ID=<uaa-client-id>
HANA_CLIENT_SECRET=<uaa-client-secret>
HANA_ENABLE_NATIVE_JWT=true
HANA_TABLE=PO_RECORDS
```

Only enable native JWT after the HANA database has a trusted JWT provider and a mapped database user for that token identity. A UAA service key by itself can issue an OAuth token, but that token is not automatically a SQL user. The HANA instance id is useful for tracking the service, but it is not enough to connect. The service must be running and the app needs either SQL credentials or UAA credentials that HANA accepts through JWT authentication. If the instance status is `Creation in Progress`, keep `OPPORTUNITY_STORE_BACKEND=file` until SAP finishes provisioning it.

When HANA persistence is enabled, the app creates a `PO_RECORDS` table if needed and stores key fields plus the full record JSON and full email text.

The dashboard's `Save PO to SAP` button requires a browser confirmation before it calls the HANA insert endpoint. If HANA credentials are missing, the app refuses the insert and shows the missing configuration instead of pretending the PO was saved.

## SAP Commit

With the current safe setting:

```env
SAP_MODE=live
SAP_SUBMIT_MODE=dry-run
SAP_DOCUMENT_TYPE=auto
```

the app stores the opportunity and prepares the SAP action payload without posting. Switch to `SAP_SUBMIT_MODE=commit` only after the real S/4HANA communication arrangement exists.

## References

- Google OAuth 2.0 for web server apps: https://developers.google.com/identity/protocols/oauth2/web-server
- Gmail API server-side authorization: https://developers.google.cn/workspace/gmail/api/auth/web-server?hl=en
