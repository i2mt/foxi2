# FoxiMed anonymous analytics Worker

This Worker provides the private owner dashboard and the event endpoint used by
`analytics.js`. It stores only random anonymous IDs, coarse device metadata,
and whitelisted event names. It never accepts arbitrary properties, names,
voice content, drug names, doses, results, or patient data.

## Deploy

1. Create a Cloudflare D1 database named `foximed-analytics`.
2. Copy `wrangler.jsonc.example` to `wrangler.jsonc`, insert the returned D1
   database ID, and set `ALLOWED_ORIGINS` to the exact production app origin.
   Multiple origins may be comma-separated.
3. Apply the schema remotely:

   ```sh
   npx wrangler d1 execute foximed-analytics --remote --file=./schema.sql
   ```

4. Generate a long dashboard password and store it as a Worker secret (never
   commit it or put it in the PWA):

   ```sh
   npx wrangler secret put ADMIN_TOKEN
   ```

5. Deploy with `npx wrangler deploy`.
6. Set the `foximed-analytics-endpoint` meta tag in `index.html` to the deployed
   Worker URL ending in `/v1/events`.
7. Open the Worker root URL or `/dashboard` and enter the admin password.

The free Cloudflare Workers and D1 allowances are ample for a modest PWA. The
client batches at most 20 events, queues briefly while offline, honors browser
Do Not Track, and deletes its anonymous ID when analytics is disabled.

