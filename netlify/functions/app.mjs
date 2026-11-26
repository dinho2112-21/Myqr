import { getStore } from "@netlify/blobs";

const ID = /^[a-z0-9]{8}$/;
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const html = (b, s = 200) => new Response(b, { status: s, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
const okUrl = (s) => { try { const u = new URL(s); return /^https?:$/.test(u.protocol) ? u.href : null; } catch { return null; } };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const isAdmin = (req) => {
  const t = req.headers.get("x-admin-token") || "", p = process.env.ADMIN_PASSWORD || "";
  if (!p || t.length !== p.length) return false;
  let d = 0; for (let i = 0; i < p.length; i++) d |= t.charCodeAt(i) ^ p.charCodeAt(i);
  return d === 0;
};

const page = (body, head = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Review</title>${head}
<style>body{font-family:system-ui,sans-serif;background:#f6f7f9;color:#14171f;margin:0;display:grid;place-items:center;min-height:100vh;padding:16px}
.c{background:#fff;border:1px solid #e2e5ea;border-radius:14px;padding:22px;max-width:440px;width:100%}
input{width:100%;padding:12px;border:1px solid #ccd;border-radius:10px;font:inherit;box-sizing:border-box}
button,a.b{display:inline-block;margin-top:12px;padding:11px 18px;border:0;border-radius:10px;background:#4f46e5;color:#fff;font:600 1rem system-ui;text-decoration:none;cursor:pointer}
p{color:#667085}@media(prefers-color-scheme:dark){body{background:#0f1115;color:#eceef3}.c{background:#181b22;border-color:#2a2f3a}input{background:#0f1115;color:#eceef3;border-color:#2a2f3a}}</style></head><body><div class="c">${body}</div></body></html>`;

export default async (req) => {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const store = getStore("qrs");

  if (parts[0] === "q") {
    const id = parts[1] || "";
    const rec = ID.test(id) ? await store.get(id, { type: "json" }) : null;
    if (!rec) return html(page("<h2>Unknown QR code</h2>"), 404);
    if (rec.dest) {
      rec.scans = (rec.scans || 0) + 1; rec.lastScan = Date.now();
      await store.setJSON(id, rec);
      const d = esc(rec.dest);
      return html(page(`<h2>Opening review page…</h2><p>If it doesn’t open automatically, tap Review now.</p><a class="b" href="${d}">Review now</a>
<script>location.replace(${JSON.stringify(rec.dest).replace(/</g, "\\u003c")})</script>`, `<meta http-equiv="refresh" content="1;url=${d}">`));
    }
    return html(page(`<h2>Where should this QR go?</h2><p>Paste the destination link once. This QR will open it every time after.</p>
<input id="u" type="url" placeholder="https://example.com" autocomplete="off"><button id="s">Save &amp; review</button><p id="m" style="color:#c2410c"></p>
<script>
document.getElementById("s").onclick=async()=>{const m=document.getElementById("m");m.textContent="";
const r=await fetch("/api/set/${id}",{method:"POST",body:JSON.stringify({dest:document.getElementById("u").value.trim()})});
const j=await r.json();if(j.dest)location.replace("/q/${id}");else m.textContent="Enter a full link starting with https://";};
</script>`));
  }

  if (parts[0] !== "api") return json({ error: "not found" }, 404);

  if (parts[1] === "set" && req.method === "POST") {
    const id = parts[2] || "";
    const rec = ID.test(id) ? await store.get(id, { type: "json" }) : null;
    if (!rec) return json({ error: "unknown" }, 404);
    if (rec.dest) return json({ dest: rec.dest });
    const u = okUrl((await req.json().catch(() => ({}))).dest);
    if (!u) return json({ error: "invalid" }, 400);
    Object.assign(rec, { dest: u, linkedAt: Date.now() });
    await store.setJSON(id, rec);
    return json({ dest: u });
  }

  if (parts[1] === "admin") {
    if (!isAdmin(req)) return json({ error: "unauthorized" }, 401);
    const act = parts[2];
    if (act === "list") {
      const { blobs } = await store.list();
      const items = await Promise.all(blobs.map(async (b) => ({ id: b.key, ...(await store.get(b.key, { type: "json" })) })));
      return json(items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
    }
    if (act === "create" && req.method === "POST") {
      const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
      await store.setJSON(id, { createdAt: Date.now(), dest: null, scans: 0, lastScan: null });
      return json({ id });
    }
    const body = await req.json().catch(() => ({}));
    const id = body.id || "";
    if (!ID.test(id)) return json({ error: "bad id" }, 400);
    if (act === "update") {
      const rec = await store.get(id, { type: "json" });
      if (!rec) return json({ error: "unknown" }, 404);
      const v = (body.dest || "").trim();
      const u = v ? okUrl(v) : null;
      if (v && !u) return json({ error: "invalid" }, 400);
      rec.dest = u; await store.setJSON(id, rec);
      return json({ ok: true });
    }
    if (act === "delete") { await store.delete(id); return json({ ok: true }); }
  }
  return json({ error: "not found" }, 404);
};

export const config = { path: ["/q/*", "/api/*"] };
