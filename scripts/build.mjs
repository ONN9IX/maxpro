import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const asset = (name) => readFileSync(new URL(`../dist/${name}`, import.meta.url), "utf8");
const html = asset("index.html");
const css = asset("maxpro-v2.css");
const js = asset("maxpro-v2.js");

const worker = `const ASSETS = ${JSON.stringify({
  "/": { body: html, type: "text/html; charset=utf-8" },
  "/index.html": { body: html, type: "text/html; charset=utf-8" },
  "/maxpro-v2.css": { body: css, type: "text/css; charset=utf-8" },
  "/maxpro-v2.js": { body: js, type: "application/javascript; charset=utf-8" },
})};

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

function equal(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let result = 0; for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
async function hmac(key, text) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(text)));
}
function hex(bytes) { return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""); }
async function telegramUser(request, env) {
  const initData = request.headers.get("x-telegram-init-data") || "";
  if (!env.TELEGRAM_BOT_TOKEN) return { error: "Telegram is not connected yet" };
  if (!initData) return { error: "Open Maxpro through the Telegram bot" };
  const params = new URLSearchParams(initData), received = params.get("hash");
  params.delete("hash");
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => k + "=" + v).join("\\n");
  const secret = await hmac(new TextEncoder().encode("WebAppData"), env.TELEGRAM_BOT_TOKEN);
  if (!received || !equal(hex(await hmac(secret, check)), received)) return { error: "Telegram verification failed" };
  try { const user = JSON.parse(params.get("user") || "{}"); return user.id ? { user } : { error: "Telegram user is missing" }; }
  catch { return { error: "Invalid Telegram user data" }; }
}
async function requireOwner(request, env) {
  const result = await telegramUser(request, env);
  if (result.error) return { response: json({ error: result.error }, env.TELEGRAM_BOT_TOKEN ? 401 : 503) };
  const configuredOwner = String(env.MAXPRO_OWNER_TELEGRAM_ID || "");
  const bootstrapUsername = String(env.MAXPRO_BOOTSTRAP_TELEGRAM_USERNAME || "").replace(/^@/, "").toLowerCase();
  const username = String(result.user.username || "").toLowerCase();
  const owner = configuredOwner || (bootstrapUsername && username === bootstrapUsername ? String(result.user.id) : "");
  if (!owner) return { response: json({ error: "Maxpro owner is not configured" }, 503) };
  if (configuredOwner && String(result.user.id) !== configuredOwner) return { response: json({ error: "Access denied" }, 403) };
  const display = [result.user.first_name, result.user.last_name].filter(Boolean).join(" ") || result.user.username || "Maxpro user";
  await env.DB.prepare("INSERT INTO users (telegram_id, display_name, created_at) VALUES (?, ?, ?) ON CONFLICT(telegram_id) DO UPDATE SET display_name = excluded.display_name").bind(owner, display, now()).run();
  return { owner };
}
async function listRecords(env, owner, type) {
  const query = type ? "SELECT id, record_type, payload_json, created_at, updated_at FROM records WHERE owner_id = ? AND record_type = ? ORDER BY updated_at DESC" : "SELECT id, record_type, payload_json, created_at, updated_at FROM records WHERE owner_id = ? ORDER BY updated_at DESC";
  const args = type ? [owner, type] : [owner];
  const result = await env.DB.prepare(query).bind(...args).all();
  return (result.results || []).map((row) => ({ id: row.id, type: row.record_type, data: JSON.parse(row.payload_json), createdAt: row.created_at, updatedAt: row.updated_at }));
}
function validRuzDate(value) { return /^20\\d{2}\\.\\d{2}\\.\\d{2}$/.test(value || ""); }
async function universitySchedule(url) {
  const start = url.searchParams.get("start"), finish = url.searchParams.get("finish");
  if (!validRuzDate(start) || !validRuzDate(finish)) return json({ error: "Use start and finish as YYYY.MM.DD" }, 400);
  const source = new URL("https://ruz.fa.ru/api/schedule/group/165153");
  source.searchParams.set("start", start); source.searchParams.set("finish", finish); source.searchParams.set("lng", "1");
  const upstream = await fetch(source, { headers: { accept: "application/json" } });
  if (!upstream.ok) return json({ error: "University schedule is temporarily unavailable" }, 502);
  const rows = await upstream.json();
  const belongsToGroup = (lesson) => lesson.group === "ТЦБМ24-1" || String(lesson.stream || "").includes("ТЦБМ24-1") || (lesson.listGroups || []).some((group) => group.group === "ТЦБМ24-1");
  const lessons = rows.filter(belongsToGroup).map((lesson) => ({
    id: String(lesson.lessonOid), date: lesson.date, start: lesson.beginLesson, end: lesson.endLesson,
    title: lesson.discipline, type: lesson.kindOfWork, room: lesson.auditorium || "", building: lesson.building || "",
    lecturer: lesson.lecturer || "", changed: Boolean(lesson.replaces), note: lesson.replaces || lesson.note || ""
  }));
  return new Response(JSON.stringify({ group: "ТЦБМ24-1", start, finish, lessons }), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" } });
}
async function api(request, env, url) {
  if (url.pathname === "/api/health") return json({ ok: true, database: Boolean(env.DB), files: Boolean(env.FILES), telegramConnected: Boolean(env.TELEGRAM_BOT_TOKEN), ownerConfigured: Boolean(env.MAXPRO_OWNER_TELEGRAM_ID || env.MAXPRO_BOOTSTRAP_TELEGRAM_USERNAME) });
  if (url.pathname === "/api/university-schedule" && request.method === "GET") return universitySchedule(url);
  const auth = await requireOwner(request, env); if (auth.response) return auth.response;
  const owner = auth.owner, parts = url.pathname.split("/").filter(Boolean);
  if (parts[1] === "records") {
    if (request.method === "GET") return json({ records: await listRecords(env, owner, url.searchParams.get("type")) });
    const recordId = parts[2];
    if (!recordId) return json({ error: "Record id is required" }, 400);
    if (request.method === "DELETE") { await env.DB.prepare("DELETE FROM records WHERE owner_id = ? AND record_type = ? AND id = ?").bind(owner, url.searchParams.get("type") || "snapshot", recordId).run(); return new Response(null, { status: 204 }); }
    if (request.method === "PUT") {
      const body = await request.json(), type = String(body.type || "snapshot"), payload = JSON.stringify(body.data ?? {}), timestamp = now();
      await env.DB.prepare("INSERT INTO records (id, owner_id, record_type, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id, record_type, id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at").bind(recordId, owner, type, payload, timestamp, timestamp).run();
      return json({ id: recordId, type, updatedAt: timestamp });
    }
  }
  if (parts[1] === "files") {
    const fileId = parts[2];
    if (request.method === "POST" && !fileId) {
      const recordType = request.headers.get("x-maxpro-record-type") || "task", recordId = request.headers.get("x-maxpro-record-id");
      if (!recordId) return json({ error: "x-maxpro-record-id is required" }, 400);
      const file = id(), filename = request.headers.get("x-maxpro-filename") || "file", contentType = request.headers.get("content-type") || "application/octet-stream", bytes = await request.arrayBuffer();
      if (bytes.byteLength > 10 * 1024 * 1024) return json({ error: "File is larger than 10 MB" }, 413);
      const objectKey = owner + "/" + file;
      await env.FILES.put(objectKey, bytes, { httpMetadata: { contentType }, customMetadata: { filename } });
      await env.DB.prepare("INSERT INTO attachments (id, owner_id, record_type, record_id, object_key, filename, content_type, byte_size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(file, owner, recordType, recordId, objectKey, filename, contentType, bytes.byteLength, now()).run();
      return json({ id: file, filename, contentType, size: bytes.byteLength }, 201);
    }
    if (request.method === "GET" && fileId) {
      const meta = await env.DB.prepare("SELECT object_key, filename, content_type FROM attachments WHERE id = ? AND owner_id = ?").bind(fileId, owner).first();
      if (!meta) return json({ error: "File not found" }, 404);
      const object = await env.FILES.get(meta.object_key); if (!object) return json({ error: "File not found" }, 404);
      return new Response(object.body, { headers: { "content-type": meta.content_type, "content-disposition": "inline; filename=\\\"" + meta.filename.replaceAll('\\\"', '') + "\\\"", "cache-control": "private, max-age=3600" } });
    }
  }
  return json({ error: "Not found" }, 404);
}

export default { async fetch(request, env) {
  const url = new URL(request.url);
  try {
    if (url.pathname.startsWith("/api/")) return await api(request, env, url);
    const asset = ASSETS[url.pathname] || ASSETS["/"];
    return new Response(asset.body, { headers: { "content-type": asset.type, "cache-control": url.pathname === "/" ? "no-cache" : "public, max-age=3600" } });
  } catch (error) { return json({ error: "Server unavailable" }, 500); }
} };
`;

mkdirSync(new URL("../dist/server", import.meta.url), { recursive: true });
writeFileSync(new URL("../dist/server/index.js", import.meta.url), worker);
