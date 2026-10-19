"use strict";

/**
 * 本地模式后端
 *
 * 目标：容器起来即可用，不依赖任何托管服务。
 *  - 账号：邮箱 + 密码（scrypt），首个注册用户为管理员
 *  - 数据：单文件 JSON 库，原子写入；表结构与云模式一致
 *  - 文件：落盘到 data/files，签名地址校验过期时间
 *  - 权限：在服务端逐表判定，等价于云模式的 RLS
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { sendMail } = require("./mailer.js");

const TABLES = [
  "profiles", "users", "sessions", "teams", "team_members", "submissions",
  "submission_versions", "reviews", "announcements", "activity", "appeals",
  "signatures", "documents", "partners", "judges", "certificates",
];
const PUBLIC_READ = new Set(["activity", "documents", "partners", "announcements", "judges", "certificates"]);
// 未登录也能查，但只能看到 status='public' 的行
const ANON_READ = new Set([...PUBLIC_READ, "submissions"]);
const SESSION_TTL = 30 * 24 * 3600; // 秒
const MAX_FILE = 200 * 1024 * 1024;

const DEFAULT_SETTINGS = {
  smtp: {
    enabled: false, host: "", port: 465, secure: true, starttls: true,
    user: "", pass: "", fromName: "像素松", fromEmail: "",
  },
  geetest: { enabled: false, captchaId: "", captchaKey: "" },
  virustotal: { enabled: false, apiKey: "" },
  cnkd: { enabled: false, clientId: "", clientSecret: "", redirectUri: "" },
};

let DATA_DIR = "";
let STORE_FILE = "";
let FILE_DIR = "";
let SECRET = "";
let db = null;
let saveTimer = null;

/* ------------------------------ 存储 ------------------------------ */

function nowIso() {
  return new Date().toISOString();
}

function init(dataDir, seedFile) {
  DATA_DIR = dataDir;
  STORE_FILE = path.join(dataDir, "db.json");
  FILE_DIR = path.join(dataDir, "files");
  fs.mkdirSync(FILE_DIR, { recursive: true });

  const secretFile = path.join(dataDir, "secret");
  if (fs.existsSync(secretFile)) {
    SECRET = fs.readFileSync(secretFile, "utf8").trim();
  } else {
    SECRET = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(secretFile, SECRET, { mode: 0o600 });
  }

  if (fs.existsSync(STORE_FILE)) {
    db = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    for (const t of TABLES) if (!db.tables[t]) db.tables[t] = [];
    if (!db.seq) db.seq = {};
    if (!db.otp) db.otp = [];
    db.settings = mergeSettings(db.settings);
  } else {
    db = { seq: {}, tables: {}, otp: [], settings: mergeSettings() };
    for (const t of TABLES) db.tables[t] = [];
    seed(seedFile);
    save(true);
  }
}

function seed(seedFile) {
  let seed = {};
  try {
    seed = JSON.parse(fs.readFileSync(seedFile, "utf8"));
  } catch (_) {}

  if (seed.activity && Object.keys(seed.activity).length) {
    db.tables.activity.push({ id: 1, data: seed.activity, updated_at: nowIso() });
    db.seq.activity = 1;
  }
  (seed.documents || []).forEach((d, i) => {
    db.tables.documents.push({
      id: i + 1,
      doc_key: d.doc_key,
      title: d.title,
      body: d.body,
      version: d.version || 1,
      owner_id: null,
      updated_at: nowIso(),
      created_at: nowIso(),
    });
    db.seq.documents = i + 1;
  });
  (seed.partners || []).forEach((p, i) => {
    db.tables.partners.push({
      id: i + 1,
      name: p.name,
      role: p.role || "co",
      note: p.note || null,
      sort: p.sort || 100,
      logo_url: p.logo_url || null,
      site_url: p.site_url || null,
      owner_id: null,
      created_at: nowIso(),
    });
    db.seq.partners = i + 1;
  });
}

/** 同步落盘，先写临时文件再 rename，避免半截 JSON */
function save(sync) {
  const json = JSON.stringify(db);
  if (sync) {
    fs.writeFileSync(STORE_FILE + ".tmp", json);
    fs.renameSync(STORE_FILE + ".tmp", STORE_FILE);
    return;
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(STORE_FILE + ".tmp", json);
      fs.renameSync(STORE_FILE + ".tmp", STORE_FILE);
    } catch (e) {
      console.error("[local] 写库失败", e.message);
    }
  }, 40);
}

function mergeSettings(input) {
  const out = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  for (const key of Object.keys(out)) {
    if (input && input[key] && typeof input[key] === "object") {
      Object.assign(out[key], input[key]);
    }
  }
  return out;
}

function getSettings() {
  return db.settings || (db.settings = mergeSettings());
}

function rows(table) {
  return db.tables[table] || [];
}

function nextId(table) {
  db.seq[table] = (db.seq[table] || 0) + 1;
  return db.seq[table];
}

/* ------------------------------ 工具 ------------------------------ */

function sendJson(res, code, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": buf.length,
    "cache-control": "no-store",
  });
  res.end(buf);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error("too_large"), { code: "TOO_LARGE" }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req, 2 * 1024 * 1024);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch (_) {
    throw Object.assign(new Error("bad_json"), { code: "BAD_JSON" });
  }
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function scrypt(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString("hex");
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function isAdmin(ctx) {
  return ctx.role === "admin";
}

function isStaff(ctx) {
  return ctx.role === "admin" || ctx.role === "judge";
}

function leaderOf(teamId, uid) {
  return rows("team_members").some((m) => m.team_id === teamId && m.owner_id === uid && m.is_leader);
}

function sameTeam(a, b) {
  const ta = rows("team_members").filter((m) => m.owner_id === a).map((m) => m.team_id);
  return rows("team_members").some((m) => m.owner_id === b && ta.includes(m.team_id));
}

/* ------------------------------ 会话 ------------------------------ */

function currentUser(req) {
  const token = parseCookies(req).ps_sid;
  if (!token) return null;
  const h = hashToken(token);
  const sess = rows("sessions").find((s) => s.token_hash === h);
  if (!sess) return null;
  if (new Date(sess.exp).getTime() < Date.now()) return null;
  const profile = rows("profiles").find((p) => p.owner_id === sess.uid);
  if (!profile) return null;
  return { uid: sess.uid, role: profile.role || "participant", profile };
}

function createSession(res, uid, req) {
  const token = crypto.randomBytes(32).toString("hex");
  const exp = new Date(Date.now() + SESSION_TTL * 1000).toISOString();
  rows("sessions").push({ id: nextId("sessions"), token_hash: hashToken(token), uid, exp, created_at: nowIso() });
  const secure = /https/i.test(String(req.headers["x-forwarded-proto"] || "")) || Boolean(req.socket.encrypted);
  const cookie = [
    `ps_sid=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL}`,
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");
  res.setHeader("set-cookie", cookie);
  save();
}

function clearSession(req, res) {
  const token = parseCookies(req).ps_sid;
  if (token) {
    const h = hashToken(token);
    db.tables.sessions = rows("sessions").filter((s) => s.token_hash !== h);
  }
  res.setHeader("set-cookie", "ps_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  save();
}

/* ------------------------------ 权限 ------------------------------ */

function canRead(ctx, table, row) {
  if (!ctx) return PUBLIC_READ.has(table) || (table === "submissions" && row.status === "public");
  switch (table) {
    case "profiles":
      return true;
    case "teams":
    case "team_members":
      return true;
    case "submissions":
      return row.status === "public" || row.owner_id === ctx.uid || isStaff(ctx);
    case "submission_versions":
      return row.owner_id === ctx.uid || isStaff(ctx);
    case "reviews":
      return row.judge_uid === ctx.uid || isAdmin(ctx);
    case "appeals":
      return row.owner_id === ctx.uid || isAdmin(ctx);
    case "signatures":
      return row.owner_id === ctx.uid || isStaff(ctx) || sameTeam(ctx.uid, row.owner_id);
    default:
      return true;
  }
}

function canInsert(ctx, table, obj) {
  if (!ctx) return false;
  switch (table) {
    case "profiles":
      return obj.owner_id === ctx.uid;
    case "teams":
      return obj.owner_id === ctx.uid;
    case "team_members":
      return obj.owner_id === ctx.uid || leaderOf(obj.team_id, ctx.uid) || isAdmin(ctx);
    case "submissions":
      return obj.owner_id === ctx.uid && leaderOf(obj.team_id, ctx.uid);
    case "submission_versions":
      return obj.owner_id === ctx.uid;
    case "reviews":
      return isAdmin(ctx) || obj.judge_uid === ctx.uid;
    case "signatures":
      return obj.owner_id === ctx.uid;
    case "appeals":
      return obj.owner_id === ctx.uid;
    default:
      return isAdmin(ctx);
  }
}

function canWrite(ctx, table, row, values) {
  if (!ctx) return false;
  if (table === "profiles") {
    if (isAdmin(ctx)) return true;
    if (row.owner_id !== ctx.uid) return false;
    return !("role" in (values || {})) && !("owner_id" in (values || {}));
  }
  if (table === "reviews") return isAdmin(ctx) || row.judge_uid === ctx.uid;
  if (table === "team_members") {
    return isAdmin(ctx) || row.owner_id === ctx.uid || leaderOf(row.team_id, ctx.uid);
  }
  if (["teams", "submissions", "appeals"].includes(table)) {
    return isAdmin(ctx) || row.owner_id === ctx.uid;
  }
  return isAdmin(ctx);
}

/* ------------------------------ 查询执行 ------------------------------ */

function applyFilters(list, filters) {
  let out = list;
  for (const f of filters || []) {
    if (f.op === "eq") out = out.filter((r) => String(r[f.key]) === String(f.value));
    else if (f.op === "in") out = out.filter((r) => (f.value || []).map(String).includes(String(r[f.key])));
  }
  return out;
}

function applyOrder(list, order) {
  if (!order || !order.length) return list;
  const sorted = list.slice().sort((a, b) => {
    for (const o of order) {
      const av = a[o.key];
      const bv = b[o.key];
      if (av === bv) continue;
      const cmp = av == null ? -1 : bv == null ? 1 : av > bv ? 1 : -1;
      return o.ascending === false ? -cmp : cmp;
    }
    return 0;
  });
  return sorted;
}

function project(row, columns) {
  if (!columns || columns === "*") return row;
  const keys = String(columns).split(",").map((s) => s.trim()).filter(Boolean);
  const out = {};
  for (const k of keys) out[k] = row[k];
  return out;
}

async function handleDb(req, res, ctx) {
  const body = await readJson(req);
  const table = String(body.table || "");
  const action = String(body.action || "select");
  if (!TABLES.includes(table) || table === "users" || table === "sessions") {
    return sendJson(res, 400, { error: { code: "42P01", message: "数据表不存在" } });
  }

  const filters = body.filters || [];
  const columns = body.columns || "*";

  if (action === "select") {
    if (!ANON_READ.has(table) && !ctx) {
      return sendJson(res, 401, { error: { code: "42501", message: "请先登录" } });
    }
    let list = applyFilters(rows(table), filters).filter((r) => canRead(ctx, table, r));
    list = applyOrder(list, body.order);
    if (body.limit) list = list.slice(0, body.limit);
    return sendJson(res, 200, { data: list.map((r) => project(r, columns)) });
  }

  if (!ctx) return sendJson(res, 401, { error: { code: "42501", message: "请先登录" } });

  if (action === "insert" || action === "upsert") {
    const values = Array.isArray(body.values) ? body.values : [body.values || {}];
    const created = [];
    for (const v of values) {
      const row = Object.assign({}, v);
      row.owner_id = row.owner_id || ctx.uid;
      row.created_at = row.created_at || nowIso();
      if (!canInsert(ctx, table, row)) {
        return sendJson(res, 403, { error: { code: "42501", message: "没有权限执行该操作" } });
      }
      if (table === "profiles" && !row.role) {
        row.role = rows("profiles").length === 0 ? "admin" : "participant";
      }
      row.id = nextId(table);
      // 唯一约束：submission_versions 无；profiles.owner_id 唯一
      if (table === "profiles" && rows("profiles").some((p) => p.owner_id === row.owner_id)) {
        return sendJson(res, 409, { error: { code: "23505", message: "记录已存在" } });
      }
      if (action === "upsert") {
        const existing = rows(table).find((r) =>
          table === "reviews"
            ? r.submission_id === row.submission_id && r.judge_uid === row.judge_uid
            : false
        );
        if (existing) {
          if (body.ignoreDuplicates) continue;
          Object.assign(existing, row, { id: existing.id });
          created.push(existing);
          continue;
        }
      }
      rows(table).push(row);
      created.push(row);
    }
    save();
    return sendJson(res, 200, { data: created.map((r) => project(r, columns)) });
  }

  if (action === "update") {
    const values = body.values || {};
    const target = applyFilters(rows(table), filters);
    const updated = [];
    for (const row of target) {
      if (!canRead(ctx, table, row) || !canWrite(ctx, table, row, values)) continue;
      Object.assign(row, values, { id: row.id });
      if ("updated_at" in row || table === "submissions" || table === "documents") row.updated_at = nowIso();
      updated.push(row);
    }
    save();
    return sendJson(res, 200, { data: updated.map((r) => project(r, columns)) });
  }

  if (action === "delete") {
    const target = applyFilters(rows(table), filters);
    const removed = [];
    db.tables[table] = rows(table).filter((row) => {
      if (canWrite(ctx, table, row, {})) {
        removed.push(row);
        return false;
      }
      return true;
    });
    save();
    return sendJson(res, 200, { data: removed.map((r) => project(r, columns)) });
  }

  return sendJson(res, 400, { error: { code: "40000", message: "未知操作" } });
}

/* ------------------------------ 文件 ------------------------------ */

function safePath(p) {
  const s = String(p || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!s || s.includes("..") || !/^[\w.\-\u4e00-\u9fa5/]+$/.test(s)) return null;
  return s;
}

function canReadFile(ctx, p) {
  if (p.startsWith("shared/")) return Boolean(ctx);
  const m = p.match(/^users\/([^/]+)\//);
  return Boolean(ctx && m && m[1] === ctx.uid);
}

function canWriteFile(ctx, p) {
  const m = p.match(/^(?:users|shared)\/([^/]+)\//);
  return Boolean(ctx && m && m[1] === ctx.uid);
}

function signPath(p, ttl) {
  const exp = Math.floor(Date.now() / 1000) + Math.min(Number(ttl) || 3600, 86400);
  const sig = crypto.createHmac("sha256", SECRET).update(`${p}:${exp}`).digest("hex").slice(0, 32);
  return { exp, sig };
}

async function handleFile(req, res, url, ctx) {
  const p = safePath(url.searchParams.get("path"));

  if (req.method === "GET") {
    if (!p) return sendJson(res, 400, { error: "bad_path" });
    const exp = Number(url.searchParams.get("exp") || 0);
    const sig = url.searchParams.get("sig") || "";
    const signed =
      exp && sig && safeEqual(sig, crypto.createHmac("sha256", SECRET).update(`${p}:${exp}`).digest("hex").slice(0, 32));
    if (!signed && !canReadFile(ctx, p)) return sendJson(res, 403, { error: "forbidden" });
    if (signed && exp * 1000 < Date.now()) return sendJson(res, 410, { error: "expired" });
    const file = path.join(FILE_DIR, p);
    if (!file.startsWith(FILE_DIR + path.sep) || !fs.existsSync(file)) {
      return sendJson(res, 404, { error: "not_found" });
    }
    const stat = fs.statSync(file);
    const type = url.searchParams.get("type") || "application/octet-stream";
    res.writeHead(200, {
      "content-type": type,
      "content-length": stat.size,
      "cache-control": "private, max-age=60",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(p))}`,
    });
    return fs.createReadStream(file).pipe(res);
  }

  if (req.method === "POST" && url.pathname.endsWith("/file")) {
    if (!ctx) return sendJson(res, 401, { error: "unauthorized" });
    if (!p || !canWriteFile(ctx, p)) return sendJson(res, 403, { error: "forbidden" });
    let buf;
    try {
      buf = await readBody(req, MAX_FILE);
    } catch (e) {
      return sendJson(res, 413, { error: "too_large" });
    }
    const file = path.join(FILE_DIR, p);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    return sendJson(res, 200, { data: { path: p, size: buf.length } });
  }

  if (req.method === "POST" && url.pathname.endsWith("/file/copy")) {
    if (!ctx) return sendJson(res, 401, { error: "unauthorized" });
    const body = await readJson(req);
    const from = safePath(body.from);
    const to = safePath(body.to);
    if (!from || !to || !canReadFile(ctx, from) || !canWriteFile(ctx, to)) {
      return sendJson(res, 403, { error: "forbidden" });
    }
    const src = path.join(FILE_DIR, from);
    if (!fs.existsSync(src)) return sendJson(res, 404, { error: "not_found" });
    const dst = path.join(FILE_DIR, to);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    return sendJson(res, 200, { data: { path: to } });
  }

  if (req.method === "POST" && url.pathname.endsWith("/file/remove")) {
    if (!ctx) return sendJson(res, 401, { error: "unauthorized" });
    const body = await readJson(req);
    for (const raw of body.paths || []) {
      const p2 = safePath(raw);
      if (!p2 || !canWriteFile(ctx, p2)) continue;
      try {
        fs.unlinkSync(path.join(FILE_DIR, p2));
      } catch (_) {}
    }
    return sendJson(res, 200, { data: { ok: true } });
  }

  if (req.method === "POST" && url.pathname.endsWith("/file/sign")) {
    if (!ctx) return sendJson(res, 401, { error: "unauthorized" });
    const body = await readJson(req);
    const p2 = safePath(body.path);
    if (!p2 || !canReadFile(ctx, p2)) return sendJson(res, 403, { error: "forbidden" });
    const { exp, sig } = signPath(p2, body.ttl);
    return sendJson(res, 200, {
      data: { signedUrl: `/.cloud/local/file?path=${encodeURIComponent(p2)}&exp=${exp}&sig=${sig}` },
    });
  }

  return sendJson(res, 404, { error: "not_found" });
}

/* ------------------------------ 邮箱验证码 ------------------------------ */

const otpHits = new Map();

function otpAllowed(key) {
  const now = Date.now();
  const rec = otpHits.get(key);
  if (!rec) {
    otpHits.set(key, { n: 1, at: now, reset: now + 3600000 });
    return true;
  }
  if (now - rec.at < 60000) return false;
  if (now > rec.reset) {
    rec.n = 0;
    rec.reset = now + 3600000;
  }
  if (rec.n >= 5) return false;
  rec.n += 1;
  rec.at = now;
  return true;
}

function ensureUser(email) {
  let user = rows("users").find((u) => u.email === email);
  if (user) {
    const profile = rows("profiles").find((p) => p.owner_id === user.uid) || {};
    return { user, profile, created: false, uid: user.uid };
  }
  const uid = `u${nextId("users")}`;
  const salt = crypto.randomBytes(16).toString("hex");
  user = {
    id: nextId("users"),
    uid,
    email,
    salt,
    password_hash: "",
    created_at: nowIso(),
  };
  rows("users").push(user);
  const isFirst = rows("profiles").length === 0;
  const profile = {
    id: nextId("profiles"),
    owner_id: uid,
    email,
    nickname: email.split("@")[0].slice(0, 20),
    role: isFirst ? "admin" : "participant",
    looking_for_team: false,
    created_at: nowIso(),
  };
  rows("profiles").push(profile);
  return { user, profile, created: true, uid };
}

function otpMailText(code, minutes) {
  return [
    "你好，",
    "",
    `你正在「像素松」参赛平台登录，验证码：${code}`,
    `${minutes} 分钟内有效。如果不是你本人操作，请忽略这封邮件。`,
    "",
    "—— 像素松",
  ].join("\n");
}

async function sendOtp(req, res) {
  if (!getSettings().smtp.enabled) {
    return sendJson(res, 400, { error: { message: "管理员尚未开启邮箱验证码登录" } });
  }
  const body = await readJson(req);
  const email = String(body.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return sendJson(res, 400, { error: { message: "邮箱格式不正确" } });
  }
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?";
  if (!otpAllowed(`${ip}:${email}`)) {
    return sendJson(res, 429, { error: { message: "发送过于频繁，请 1 分钟后再试" } });
  }

  const code = String(crypto.randomInt(100000, 1000000));
  const rec = {
    id: crypto.randomBytes(12).toString("hex"),
    email,
    hash: crypto.createHash("sha256").update(`${code}:${email}:${SECRET}`).digest("hex"),
    exp: new Date(Date.now() + 10 * 60000).toISOString(),
    tries: 0,
    used: false,
    created_at: nowIso(),
  };
  db.otp = (db.otp || []).filter((o) => new Date(o.exp).getTime() > Date.now()).slice(-200);
  db.otp.push(rec);
  save(true);

  const s = getSettings().smtp;
  try {
    await sendMail(s, {
      to: email,
      subject: "像素松 · 登录验证码",
      text: otpMailText(code, 10),
    });
  } catch (e) {
    db.otp = db.otp.filter((o) => o.id !== rec.id);
    save(true);
    return sendJson(res, 502, { error: { message: `邮件发送失败：${e.message}` } });
  }

  const exists = rows("users").some((u) => u.email === email);
  return sendJson(res, 200, { data: { verificationId: rec.id, isExistingUser: exists } });
}

async function verifyOtp(req, res) {
  const body = await readJson(req);
  const email = String(body.email || "").trim().toLowerCase();
  const id = String(body.verificationId || "");
  const code = String(body.code || "").trim();
  const rec = (db.otp || []).find((o) => o.id === id && o.email === email);
  if (!rec || rec.used) return sendJson(res, 400, { error: { message: "验证码已失效，请重新获取" } });
  if (new Date(rec.exp).getTime() < Date.now()) {
    return sendJson(res, 400, { error: { message: "验证码已过期，请重新获取" } });
  }
  if (rec.tries >= 5) return sendJson(res, 429, { error: { message: "尝试次数过多，请重新获取" } });
  rec.tries += 1;
  const expect = crypto.createHash("sha256").update(`${code}:${email}:${SECRET}`).digest("hex");
  if (!safeEqual(expect, rec.hash)) {
    save(true);
    return sendJson(res, 400, { error: { message: "验证码错误" } });
  }
  rec.used = true;
  const { uid, profile } = ensureUser(email);
  createSession(res, uid, req);
  save(true);
  return sendJson(res, 200, { data: { user: { id: uid, email }, role: profile.role || "participant" } });
}

/* ------------------------------ 认证 ------------------------------ */

const loginHits = new Map();

function tooMany(ip) {
  const now = Date.now();
  const rec = loginHits.get(ip);
  if (!rec || now > rec.reset) {
    loginHits.set(ip, { n: 1, reset: now + 60000 });
    return false;
  }
  rec.n += 1;
  return rec.n > 15;
}

async function handleAuth(req, res, url) {
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?";

  if (url.pathname.endsWith("/auth/otp/send") && req.method === "POST") return sendOtp(req, res);
  if (url.pathname.endsWith("/auth/otp/verify") && req.method === "POST") return verifyOtp(req, res);

  if (url.pathname.endsWith("/auth/session") && req.method === "GET") {
    const u = currentUser(req);
    return sendJson(res, 200, { data: u ? { user: { id: u.uid, email: u.profile.email } } : null });
  }

  if (url.pathname.endsWith("/auth/login") && req.method === "POST") {
    if (tooMany(ip)) return sendJson(res, 429, { error: { message: "尝试过于频繁，请稍后再试" } });
    const body = await readJson(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendJson(res, 400, { error: { message: "邮箱格式不正确" } });
    }
    if (password.length < 6) return sendJson(res, 400, { error: { message: "密码至少 6 位" } });

    let user = rows("users").find((u) => u.email === email);
    if (user && !user.password_hash) {
      // 先用验证码注册、尚未设密码：首次用密码登录即设置密码
      user.salt = crypto.randomBytes(16).toString("hex");
      user.password_hash = scrypt(password, user.salt);
      save();
    } else if (!user) {
      const created = ensureUser(email);
      user = created.user;
      user.salt = crypto.randomBytes(16).toString("hex");
      user.password_hash = scrypt(password, user.salt);
    } else if (!safeEqual(scrypt(password, user.salt), user.password_hash)) {
      return sendJson(res, 401, { error: { message: "邮箱或密码错误" } });
    }

    createSession(res, user.uid, req);
    const profile = rows("profiles").find((p) => p.owner_id === user.uid) || {};
    return sendJson(res, 200, {
      data: { user: { id: user.uid, email }, role: profile.role || "participant" },
    });
  }

  if (url.pathname.endsWith("/auth/logout") && req.method === "POST") {
    clearSession(req, res);
    return sendJson(res, 200, { data: { ok: true } });
  }

  if (url.pathname.endsWith("/auth/password") && req.method === "POST") {
    const u = currentUser(req);
    if (!u) return sendJson(res, 401, { error: { message: "请先登录" } });
    const body = await readJson(req);
    const user = rows("users").find((x) => x.uid === u.uid);
    if (!user) return sendJson(res, 404, { error: { message: "账号不存在" } });
    if (!safeEqual(scrypt(String(body.oldPassword || ""), user.salt), user.password_hash)) {
      return sendJson(res, 400, { error: { message: "当前密码不正确" } });
    }
    const next = String(body.newPassword || "");
    if (next.length < 6) return sendJson(res, 400, { error: { message: "新密码至少 6 位" } });
    user.salt = crypto.randomBytes(16).toString("hex");
    user.password_hash = scrypt(next, user.salt);
    save();
    return sendJson(res, 200, { data: { ok: true } });
  }

  if (url.pathname.endsWith("/auth/me") && req.method === "POST") {
    const u = currentUser(req);
    if (!u) return sendJson(res, 401, { error: { message: "请先登录" } });
    const body = await readJson(req);
    const next = String(body.password || "");
    if (next.length < 6) return sendJson(res, 400, { error: { message: "密码至少 6 位" } });
    const user = rows("users").find((x) => x.uid === u.uid);
    user.salt = crypto.randomBytes(16).toString("hex");
    user.password_hash = scrypt(next, user.salt);
    save();
    return sendJson(res, 200, { data: { ok: true } });
  }

  return sendJson(res, 404, { error: { message: "not_found" } });
}

/* ------------------------------ 受控函数 ------------------------------ */

async function handleRpc(req, res, ctx) {
  if (!ctx) return sendJson(res, 401, { error: { message: "请先登录" } });
  const body = await readJson(req);
  if (body.name !== "admin_set_role") {
    return sendJson(res, 404, { error: { message: "未知函数" } });
  }
  if (!isAdmin(ctx)) return sendJson(res, 403, { error: { code: "42501", message: "没有权限执行该操作" } });
  const uid = String((body.args || {}).target_uid || "");
  const role = String((body.args || {}).new_role || "");
  if (!["participant", "judge", "admin"].includes(role)) {
    return sendJson(res, 400, { error: { message: "角色不合法" } });
  }
  const target = rows("profiles").find((p) => p.owner_id === uid);
  if (!target) return sendJson(res, 404, { error: { message: "账号不存在" } });
  const admins = rows("profiles").filter((p) => p.role === "admin");
  if (target.role === "admin" && role !== "admin" && admins.length <= 1) {
    return sendJson(res, 400, { error: { message: "不能移除最后一个管理员" } });
  }
  target.role = role;
  save();
  return sendJson(res, 200, { data: true });
}

/* ------------------------------ 站点设置 ------------------------------ */

function maskSettings() {
  const s = getSettings();
  return {
    smtp: { ...s.smtp, pass: "", hasPass: Boolean(s.smtp.pass) },
    geetest: { ...s.geetest, captchaKey: "", hasKey: Boolean(s.geetest.captchaKey) },
    virustotal: { ...s.virustotal, apiKey: "", hasKey: Boolean(s.virustotal.apiKey) },
    cnkd: { ...(s.cnkd || {}), clientSecret: "", hasSecret: Boolean(s.cnkd && s.cnkd.clientSecret) },
  };
}

async function handleSettings(req, res, url, ctx) {
  if (!ctx || !isAdmin(ctx)) return sendJson(res, 403, { error: { message: "只有主办方可以修改设置" } });

  if (req.method === "GET") return sendJson(res, 200, { data: maskSettings() });

  if (req.method === "POST" && url.pathname.endsWith("/test-mail")) {
    const body = await readJson(req);
    const to = String(body.to || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return sendJson(res, 400, { error: { message: "请填写正确的测试收件邮箱" } });
    }
    try {
      await sendMail(getSettings().smtp, {
        to,
        subject: "像素松 · 邮件配置测试",
        text: "如果你收到这封邮件，说明 SMTP 配置可用。\n\n—— 像素松",
      });
      return sendJson(res, 200, { data: { ok: true } });
    } catch (e) {
      return sendJson(res, 502, { error: { message: e.message } });
    }
  }

  if (req.method === "POST") {
    const body = await readJson(req);
    const s = getSettings();
    const patch = body || {};
    for (const key of ["smtp", "geetest", "virustotal", "cnkd"]) {
      if (!patch[key] || typeof patch[key] !== "object") continue;
      const next = { ...s[key] };
      for (const [k, v] of Object.entries(patch[key])) {
        if (k === "pass" || k === "captchaKey" || k === "apiKey" || k === "clientSecret") {
          if (v === "__clear__") next[k] = "";
          else if (typeof v === "string" && v.trim()) next[k] = v.trim();
          continue;
        }
        next[k] = v;
      }
      s[key] = next;
    }
    db.settings = mergeSettings(s);
    save(true);
    return sendJson(res, 200, { data: maskSettings() });
  }

  return sendJson(res, 405, { error: { message: "method_not_allowed" } });
}

/* ------------------------------ 入口 ------------------------------ */

async function handle(req, res, url) {
  if (!url.pathname.startsWith("/.cloud/local/")) return false;
  const ctx = currentUser(req);

  try {
    if (url.pathname.startsWith("/.cloud/local/auth/")) {
      await handleAuth(req, res, url);
      return true;
    }
    if (url.pathname === "/.cloud/local/db") {
      await handleDb(req, res, ctx);
      return true;
    }
    if (url.pathname === "/.cloud/local/rpc") {
      await handleRpc(req, res, ctx);
      return true;
    }
    if (url.pathname.startsWith("/.cloud/local/settings")) {
      await handleSettings(req, res, url, ctx);
      return true;
    }
    if (url.pathname.startsWith("/.cloud/local/file")) {
      await handleFile(req, res, url, ctx);
      return true;
    }
    sendJson(res, 404, { error: "not_found" });
    return true;
  } catch (e) {
    if (!res.headersSent) sendJson(res, 500, { error: { message: e.message || "server_error" } });
    else res.destroy();
    return true;
  }
}

module.exports = { init, handle, rows, getSettings };
