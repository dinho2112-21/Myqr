import { getStore } from "@netlify/blobs";

const ID = /^[a-z0-9]{8}$/;
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const html = (b, s = 200) => new Response(b, { status: s, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
const okUrl = (s) => { try { const u = new URL(s); return /^https?:$/.test(u.protocol) ? u.href : null; } catch { return null; } };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const hashPw = async (pw, salt) => b64(await crypto.subtle.deriveBits(
  { name: "PBKDF2", salt: enc.encode(salt), iterations: 100000, hash: "SHA-256" },
  await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]), 256));
const hmac = async (key, msg) => {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
};
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const makeToken = async (admin) => { const exp = Date.now() + 12 * 3600 * 1000; return exp + "." + (await hmac(admin.hash, String(exp))); };
const checkToken = async (admin, t) => {
  if (!admin || !t) return false;
  const [exp, sig] = t.split(".");
  if (!sig || Number(exp) < Date.now()) return false;
  return same(sig, await hmac(admin.hash, exp));
};

const page = (brand, body, head = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(brand)}</title>${head}
<style>
:root{--bg:#f4f5f8;--cd:#fff;--tx:#12151c;--mu:#667085;--bd:#e4e7ec;--ac:#4f46e5;--g1:#e6e8ff;--er:#c2410c}
@media(prefers-color-scheme:dark){:root{--bg:#0d0f14;--cd:#171a21;--tx:#eceef3;--mu:#98a1b3;--bd:#272c37;--ac:#8b93ff;--g1:#1b1f3d;--er:#fb923c}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;color:var(--tx);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:radial-gradient(900px 480px at 50% -10%,var(--g1),transparent),var(--bg)}
.c{background:var(--cd);border:1px solid var(--bd);border-radius:20px;padding:28px 24px;max-width:420px;width:100%;text-align:center;box-shadow:0 10px 40px rgba(20,20,60,.08)}
.mark{width:54px;height:54px;border-radius:16px;background:var(--ac);color:#fff;display:grid;place-items:center;font-size:24px;font-weight:800;margin:0 auto 14px}
@media(prefers-color-scheme:dark){.mark{color:#0d0f14}}
.brand{font-size:.8rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--mu);margin-bottom:14px}
h2{margin:0 0 6px;font-size:1.35rem;letter-spacing:-.02em}p{margin:0 0 14px;color:var(--mu)}
input{width:100%;padding:13px 14px;border:1px solid var(--bd);border-radius:12px;font:inherit;background:var(--bg);color:var(--tx)}
input:focus{outline:2px solid var(--ac);outline-offset:-1px}
button,a.b{display:block;width:100%;margin-top:12px;padding:13px 18px;border:0;border-radius:12px;background:var(--ac);color:#fff;font:700 1rem system-ui;text-decoration:none;cursor:pointer}
@media(prefers-color-scheme:dark){button,a.b{color:#0d0f14}}
button:disabled{opacity:.6}
.sp{width:26px;height:26px;border:3px solid var(--bd);border-top-color:var(--ac);border-radius:50%;animation:s .9s linear infinite;margin:16px auto 8px}
@keyframes s{to{transform:rotate(360deg)}}
.er{color:var(--er);min-height:1.3em;margin:8px 0 0;font-size:.9rem}.foot{margin-top:18px;font-size:.75rem;color:var(--mu)}
</style></head><body><div class="c"><div class="mark">${esc(brand.trim().charAt(0).toUpperCase() || "Q")}</div><div class="brand">${esc(brand)}</div>${body}</div></body></html>`;

const handler = async (req) => {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const store = getStore({ name: "qrs", consistency: "strong" });
  const cfg = getStore({ name: "config", consistency: "strong" });

  /* ---- Public QR page: only redirects or asks for the destination. Never touches admin. ---- */
  if (parts[0] === "q") {
    const id = parts[1] || "";
    const [rec, st] = await Promise.all([ID.test(id) ? store.get(id, { type: "json" }) : null, cfg.get("settings", { type: "json" })]);
    const brand = (st && st.brand) || "QR Gate";
    if (!rec) return html(page(brand, "<h2>QR code not found</h2><p>This code isn’t registered or has been removed.</p>"), 404);
    if (rec.paused) return html(page(brand, "<h2>Temporarily unavailable</h2><p>This QR code is paused right now. Please try again later.</p>"));
    if (rec.dest) {
      const ua = req.headers.get("user-agent") || "";
      rec.scans = (rec.scans || 0) + 1; rec.lastScan = Date.now();
      rec.days = rec.days || {}; const dk = dayKey(); rec.days[dk] = (rec.days[dk] || 0) + 1;
      const ks = Object.keys(rec.days).sort(); while (ks.length > 30) delete rec.days[ks.shift()];
      rec.dev = rec.dev || { mobile: 0, desktop: 0 }; rec.dev[/mobile|android|iphone|ipad/i.test(ua) ? "mobile" : "desktop"]++;
      await store.setJSON(id, rec);
      const d = esc(rec.dest);
      return html(page(brand, `<h2>Opening review page…</h2><div class="sp"></div><p>If it doesn’t open automatically, tap below.</p><a class="b" href="${d}">Review now</a>
<script>setTimeout(function(){location.replace(${JSON.stringify(rec.dest).replace(/</g, "\\u003c")})},150)</script>`, `<meta http-equiv="refresh" content="2;url=${d}">`));
    }
    return html(page(brand, `<h2>${esc(rec.title || "Set up this QR")}</h2><p>Paste the link this QR should open. You only do this once, and it will open it every time after.</p>
<input id="u" type="url" inputmode="url" placeholder="https://example.com" autocomplete="off"><button id="s">Save &amp; review</button><div class="er" id="m"></div>
<script>
var b=document.getElementById("s"),m=document.getElementById("m"),u=document.getElementById("u");
async function go(){m.textContent="";var v=u.value.trim();if(v&&!/^https?:/i.test(v))v="https://"+v;
b.disabled=true;b.textContent="Saving…";
try{var r=await fetch("/api/set/${id}",{method:"POST",body:JSON.stringify({dest:v})});var j=await r.json();
if(j.dest){location.replace("/q/${id}");return;}m.textContent="Please enter a valid website link.";}
catch(e){m.textContent="Couldn’t save. Check your connection and try again.";}
b.disabled=false;b.textContent="Save & review";}
b.onclick=go;u.onkeydown=function(e){if(e.key==="Enter")go();};
</script>`));
  }

  if (parts[0] !== "api") return json({ error: "not found" }, 404);

  /* ---- Public API: set destination ONCE ---- */
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

  /* ---- Developer API ---- */
  if (parts[1] === "admin") {
    const admin = await cfg.get("admin", { type: "json" });
    const act = parts[2];
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    if (act === "status") return json({ setup: !!admin });

    if (act === "setup") {
      if (admin && process.env.RESET_ADMIN !== "yes") return json({ error: "already set" }, 403);
      const pw = String(body.password || "");
      if (pw.length < 8) return json({ error: "short" }, 400);
      const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
      const rec = { salt, hash: await hashPw(pw, salt), logins: 1, lastLogin: Date.now(), prevLogin: null, fails: 0, lockUntil: 0, setupAt: Date.now() };
      await cfg.setJSON("admin", rec);
      return json({ token: await makeToken(rec) });
    }

    if (act === "login") {
      if (!admin) return json({ error: "not setup" }, 400);
      if ((admin.lockUntil || 0) > Date.now()) return json({ error: "locked" }, 429);
      const ok = same(await hashPw(String(body.password || ""), admin.salt), admin.hash);
      if (!ok) {
        admin.fails = (admin.fails || 0) + 1;
        if (admin.fails >= 5) { admin.lockUntil = Date.now() + 15 * 60000; admin.fails = 0; }
        await cfg.setJSON("admin", admin);
        return json({ error: "wrong" }, 401);
      }
      admin.prevLogin = admin.lastLogin; admin.lastLogin = Date.now();
      admin.logins = (admin.logins || 0) + 1; admin.fails = 0; admin.lockUntil = 0;
      await cfg.setJSON("admin", admin);
      return json({ token: await makeToken(admin) });
    }

    if (!(await checkToken(admin, req.headers.get("x-admin-token") || ""))) return json({ error: "unauthorized" }, 401);

    if (act === "list") {
      const [{ blobs }, st] = await Promise.all([store.list(), cfg.get("settings", { type: "json" })]);
      const items = await Promise.all(blobs.map(async (b) => ({ id: b.key, ...(await store.get(b.key, { type: "json" })) })));
      items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      return json({ items, brand: (st && st.brand) || "QR Gate", logins: admin.logins, lastLogin: admin.lastLogin, prevLogin: admin.prevLogin });
    }
    if (act === "settings") {
      const brand = String(body.brand || "").trim().slice(0, 40) || "QR Gate";
      await cfg.setJSON("settings", { brand });
      return json({ ok: true, brand });
    }
    if (act === "password") {
      const next = String(body.next || "");
      if (next.length < 8) return json({ error: "short" }, 400);
      if (!same(await hashPw(String(body.current || ""), admin.salt), admin.hash)) return json({ error: "wrong" }, 401);
      admin.salt = b64(crypto.getRandomValues(new Uint8Array(16)));
      admin.hash = await hashPw(next, admin.salt);
      await cfg.setJSON("admin", admin);
      return json({ token: await makeToken(admin) });
    }
    if (act === "create") {
      const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
      const t = String(body.title || "").trim().slice(0, 80) || "Untitled QR";
      const d = body.dest ? okUrl(String(body.dest).trim()) : null;
      if (body.dest && !d) return json({ error: "invalid" }, 400);
      await store.setJSON(id, { title: t, createdAt: Date.now(), dest: d, linkedAt: d ? Date.now() : null, scans: 0, lastScan: null, paused: false, days: {}, dev: { mobile: 0, desktop: 0 } });
      return json({ id });
    }
    const id = body.id || "";
    if (!ID.test(id)) return json({ error: "bad id" }, 400);
    if (act === "update") {
      const rec = await store.get(id, { type: "json" });
      if (!rec) return json({ error: "unknown" }, 404);
      if (typeof body.dest === "string") {
        const v = body.dest.trim(), u = v ? okUrl(v) : null;
        if (v && !u) return json({ error: "invalid" }, 400);
        rec.dest = u;
      }
      if (typeof body.title === "string") rec.title = body.title.trim().slice(0, 80) || "Untitled QR";
      if (typeof body.paused === "boolean") rec.paused = body.paused;
      await store.setJSON(id, rec);
      return json({ ok: true });
    }
    if (act === "delete") { await store.delete(id); return json({ ok: true }); }
  }
  return json({ error: "not found" }, 404);
};

export default async (req) => {
  try { return await handler(req); }
  catch (e) { return json({ error: "server: " + (e && e.message) }, 500); }
};

export const config = { path: ["/q/*", "/api/*"] };
