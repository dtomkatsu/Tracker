// Cloudflare Worker: tiny key-value store for shareable, *live* favorite
// lists. The static site works fully without this (it falls back to
// compressed URL-hash snapshot links); deploying this only adds the ability
// for a shared link/bookmark to keep updating as its owner edits the list.
//
// API (all JSON, CORS-open — the data is just public bill numbers):
//   POST /lists            body {f:[...],o:0|1}     -> 201 {id, token}
//   GET  /lists/:id                                 -> 200 {data, updated} | 404
//   PUT  /lists/:id        Authorization: Bearer <token>
//                          body {f:[...],o:0|1}     -> 200 {ok:true} | 403 | 404
//
// The id travels in the shared link (read-only). The token is kept only by
// the creator's browser, so recipients can view and fork but can't overwrite
// the original. Records auto-expire 400 days after the last write.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Max-Age": "86400",
};
const MAX_BYTES = 64 * 1024;        // a list of thousands of bills is far under this
const TTL = 60 * 60 * 24 * 400;     // 400 days, refreshed on every write
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function rid(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  let s = "";
  for (const b of a) s += ALPHABET[b % ALPHABET.length];
  return s;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

async function readPayload(req) {
  const text = await req.text();
  if (text.length > MAX_BYTES) return { error: json({ error: "too large" }, 413) };
  try {
    return { data: JSON.parse(text) };
  } catch {
    return { error: json({ error: "bad json" }, 400) };
  }
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    const parts = new URL(req.url).pathname.split("/").filter(Boolean);
    if (parts[0] !== "lists") return json({ error: "not found" }, 404);

    // Create
    if (req.method === "POST" && parts.length === 1) {
      const { data, error } = await readPayload(req);
      if (error) return error;
      const id = rid(8);
      const token = rid(24);
      await env.LISTS.put(
        id, JSON.stringify({ data, token, updated: Date.now() }),
        { expirationTtl: TTL },
      );
      return json({ id, token }, 201);
    }

    // Read
    if (req.method === "GET" && parts.length === 2) {
      const raw = await env.LISTS.get(parts[1]);
      if (!raw) return json({ error: "not found" }, 404);
      const rec = JSON.parse(raw);
      return json({ data: rec.data, updated: rec.updated });
    }

    // Update (creator only — token must match)
    if (req.method === "PUT" && parts.length === 2) {
      const raw = await env.LISTS.get(parts[1]);
      if (!raw) return json({ error: "not found" }, 404);
      const rec = JSON.parse(raw);
      const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      if (auth !== rec.token) return json({ error: "forbidden" }, 403);
      const { data, error } = await readPayload(req);
      if (error) return error;
      await env.LISTS.put(
        parts[1], JSON.stringify({ data, token: rec.token, updated: Date.now() }),
        { expirationTtl: TTL },
      );
      return json({ ok: true });
    }

    return json({ error: "not found" }, 404);
  },
};
