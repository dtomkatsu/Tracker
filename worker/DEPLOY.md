# Live shareable lists — Cloudflare Worker

This optional Worker turns a shared favorites link into a **live** link: when the
owner edits their list, anyone holding the link (or a bookmark) sees the update.
Without it, the site still works — it falls back to compressed URL-hash snapshot
links, which can't update after they're shared.

**Cost:** free. Cloudflare's free plan gives 100k Worker requests/day and KV with
100k reads / 1k writes per day — orders of magnitude more than this site needs.
No credit card required.

## One-time setup (~15–20 min)

1. **Account + CLI**
   ```sh
   npm install -g wrangler        # or use `npx wrangler ...` below
   wrangler login                 # opens a browser to authorize
   ```

2. **Create the KV namespace**
   ```sh
   cd worker
   wrangler kv namespace create LISTS
   ```
   It prints something like `id = "abc123…"`. Paste that into `wrangler.toml`,
   replacing `REPLACE_WITH_KV_NAMESPACE_ID`.

3. **Deploy**
   ```sh
   wrangler deploy
   ```
   This prints your Worker URL, e.g. `https://tracker-lists.<you>.workers.dev`.

4. **Point the site at it.** In `site/app.js`, set:
   ```js
   const LIST_API = "https://tracker-lists.<you>.workers.dev";
   ```
   (Or, without editing the file, define `window.TRACKER_LIST_API = "…"` in a
   small inline `<script>` before `app.js` in `index.html`.)
   Commit + push; GitHub Pages redeploys and live links switch on automatically.

## Local testing

```sh
cd worker
wrangler dev        # serves on http://localhost:8787 with a local KV
```
Temporarily set `LIST_API` (or `window.TRACKER_LIST_API`) to `http://localhost:8787`
while running the site locally.

## How it behaves

- **No `LIST_API` set** → snapshot links only (current default). Nothing else changes.
- **`LIST_API` set** → the first time a browser shares/opens the Saved panel it
  creates a list record and gets back a private edit token (kept in
  `localStorage`, never in the link). The shared URL is `…/#id=<id>`. The owner's
  later edits PUT to the same id (debounced), so the link stays current. Recipients
  can view and fork (their own edits make a new snapshot/list) but can't overwrite
  the original — PUT requires the token.
- Records expire 400 days after the last edit.

## Notes

- CORS is open (`*`) because the stored data is just public bill numbers; there is
  no auth or PII. If you later want to lock writes to your origin, restrict
  `Access-Control-Allow-Origin` in `src/index.js`.
- To wipe a list: `wrangler kv key delete --binding LISTS <id>`.
