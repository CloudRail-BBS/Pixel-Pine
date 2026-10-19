"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const local = require("./local.js");

const ROOT = __dirname;

function loadEnvFile() {
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    if (process.env[key]) continue;
    process.env[key] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}

loadEnvFile();

const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0";
const STARTED_AT = Date.now();

const GEETEST_ID = process.env.GEETEST_CAPTCHA_ID || "";
const GEETEST_KEY = process.env.GEETEST_CAPTCHA_KEY || "";

const CNKD_BASE = "https://cloud.cnkd.fun";
const CNKD_API = CNKD_BASE + "/api-control";
// 云模式从环境变量读；本地模式改由后台「设置 → CNKD 一证通行」维护
const CNKD_ENV = {
  clientId: process.env.CNKD_CLIENT_ID || "",
  clientSecret: process.env.CNKD_CLIENT_SECRET || "",
  redirectUri: process.env.CNKD_REDIRECT_URI || "",
};
const CNKD_SCOPE = "profile.basic profile.status";
const CNKD_PENDING_TTL = 10 * 60 * 1000;
const CNKD_TICKET_TTL = 5 * 60 * 1000;

const VT_KEY = process.env.VT_API_KEY || "";

/** 本地模式下配置存在库里，云端模式仍读环境变量 */
function geetestCfg() {
  if (LOCAL_MODE) {
    const g = local.getSettings().geetest || {};
    return { id: g.captchaId || "", key: g.captchaKey || "", enabled: Boolean(g.enabled && g.captchaId && g.captchaKey) };
  }
  return { id: GEETEST_ID, key: GEETEST_KEY, enabled: Boolean(GEETEST_ID && GEETEST_KEY) };
}

function vtCfg() {
  if (LOCAL_MODE) {
    const v = local.getSettings().virustotal || {};
    return { key: v.apiKey || "", enabled: Boolean(v.enabled && v.apiKey) };
  }
  return { key: VT_KEY, enabled: Boolean(VT_KEY) };
}

/** CNKD 一证通行：本地模式读库内设置，云端模式读环境变量 */
function cnkdCfg() {
  if (LOCAL_MODE) {
    const c = local.getSettings().cnkd || {};
    const clientId = String(c.clientId || "").trim();
    return {
      clientId,
      clientSecret: String(c.clientSecret || "").trim(),
      redirectUri: String(c.redirectUri || "").trim(),
      enabled: Boolean(c.enabled && clientId),
    };
  }
  return {
    clientId: CNKD_ENV.clientId,
    clientSecret: CNKD_ENV.clientSecret,
    redirectUri: CNKD_ENV.redirectUri,
    enabled: Boolean(CNKD_ENV.clientId),
  };
}
const VT_TTL = 30 * 60 * 1000;
const vtCache = new Map();

/* ---------- 同源代理：让任意域名都能直接跑 ----------
 * 数据面（/.cloud/**）的跨源预检会返回 403 且不带 CORS 头，浏览器必然报
 * "TypeError: Failed to fetch"。把 /.cloud/** 反代到发布的 endpoint 后，
 * 浏览器看到的是同源请求，不再有预检，也不依赖对方返回 CORS。
 */
const LOCAL_MODE = String(process.env.PS_MODE || "").toLowerCase() === "local";
const DATA_DIR = process.env.PS_DATA_DIR || path.join(ROOT, "data");

const DEFAULT_ENDPOINT = "https://pixelsong.app.workbuddy.host";
const PS_UPSTREAM = String(process.env.PS_UPSTREAM || "").trim().replace(/\/+$/, "");
const PS_ENDPOINT = String(process.env.PS_ENDPOINT || "").trim().replace(/\/+$/, "");
const PS_PUBLISHABLE_KEY =
  process.env.PS_PUBLISHABLE_KEY ||
  "wbpk_ASDGMaTrV7dAuvQijziP8z_1cmrp1ZytZS54tR74qrBdBG6NGJrS6c0";
// 走 IP / 私有 DNS 时用域名做 SNI 与 Host
const PS_UPSTREAM_HOST = String(process.env.PS_UPSTREAM_HOST || "").trim();
// 公司网络做 TLS 拦截时，Node 不认自签根证书；置 1 跳过校验（仅建议内网使用）
const PS_TLS_INSECURE = /^(1|true|yes)$/i.test(String(process.env.PS_TLS_INSECURE || ""));

/**
 * 决定这次请求的数据面走向。
 *  - 显式 PS_UPSTREAM：全部走代理
 *  - 显式 PS_ENDPOINT：直连，不代理
 *  - 两者都没配：在官方域名上直连，在其他域名（IP、localhost、自有域名）上自动代理
 */
function upstreamFor(req) {
  if (LOCAL_MODE) return "";
  if (PS_UPSTREAM) return PS_UPSTREAM;
  if (PS_ENDPOINT) return "";
  const fwd = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const host = (fwd || String(req.headers.host || "")).toLowerCase().replace(/:\d+$/, "");
  const prodHost = new URL(DEFAULT_ENDPOINT).host.toLowerCase().replace(/:\d+$/, "");
  return host === prodHost ? "" : DEFAULT_ENDPOINT;
}

/** 下发给浏览器的运行配置；代理模式下省略 endpoint，SDK 自动用 location.origin */
function bootConfig(req) {
  if (LOCAL_MODE) return { local: true, publishableKey: "" };
  const cfg = { publishableKey: PS_PUBLISHABLE_KEY };
  if (upstreamFor(req)) {
    cfg.proxy = true;
  } else {
    cfg.endpoint = PS_ENDPOINT || DEFAULT_ENDPOINT;
  }
  return cfg;
}

function injectBoot(html, req) {
  const json = JSON.stringify(bootConfig(req)).replace(/</g, "\\u003c");
  const tag = `<script>window.__PS_CONFIG__=${json};</script>`;
  return html.includes("<!--PS_BOOT-->") ? html.replace("<!--PS_BOOT-->", tag) : html;
}

async function vtLookup(hash, key) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(`https://www.virustotal.com/api/v3/files/${hash}`, {
      headers: { "x-apikey": key },
      signal: controller.signal,
    });
    if (resp.status === 404) return { status: "notfound" };
    if (resp.status === 401 || resp.status === 403) return { status: "unauthorized" };
    if (resp.status === 429) return { status: "ratelimited" };
    const json = await resp.json().catch(() => ({}));
    const a = json && json.data && json.data.attributes;
    if (!a) return { status: "unknown" };
    const s = a.last_analysis_stats || {};
    const malicious = s.malicious || 0;
    const suspicious = s.suspicious || 0;
    const harmless = s.harmless || 0;
    const undetected = s.undetected || 0;
    return {
      status: malicious > 0 ? "malicious" : suspicious > 0 ? "suspicious" : "clean",
      stats: { malicious, suspicious, harmless, undetected, total: malicious + suspicious + harmless + undetected },
      type: a.type_description || null,
      size: a.size || null,
      lastAnalysis: a.last_analysis_date ? new Date(a.last_analysis_date * 1000).toISOString() : null,
    };
  } catch (_) {
    return { status: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

let APP_VERSION = "unknown";
try {
  APP_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version || "unknown";
} catch (_) {}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function sendJson(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

function readBody(req, limit = 32 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function hmacSha256(text, key) {
  return crypto.createHmac("sha256", key).update(text, "utf8").digest("hex");
}

/**
 * 极验 v4 服务端二次校验。
 * 前端拿到的 lot_number / captcha_output / pass_token 都不能自证通过，
 * 必须带 sign_token 调极验校验接口，由服务端确认。
 */
async function validateGeetest(payload) {
  const { lot_number, captcha_output, pass_token, gen_time } = payload || {};
  if (!lot_number || !captcha_output || !pass_token || !gen_time) {
    return { ok: false, reason: "missing_fields" };
  }
  const g = geetestCfg();
  const signToken = hmacSha256(String(lot_number), g.key);
  const form = new URLSearchParams({
    lot_number: String(lot_number),
    captcha_output: String(captcha_output),
    pass_token: String(pass_token),
    gen_time: String(gen_time),
    sign_token: signToken,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await fetch(
      `https://gcaptcha4.geetest.com/validate?captcha_id=${encodeURIComponent(g.id)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
        signal: controller.signal,
      }
    );
    const data = await resp.json().catch(() => ({}));
    if (data && data.result === "success") return { ok: true };
    return { ok: false, reason: (data && data.reason) || "rejected" };
  } catch (err) {
    return { ok: false, reason: "upstream_unreachable", detail: err.message };
  } finally {
    clearTimeout(timer);
  }
}

const DENY_FILES = new Set([
  "server.js",
  "package.json",
  "package-lock.json",
  ".env",
  ".gitignore",
  "README.md",
]);

/* ------------------------- CNKD 一证通行 ------------------------- */

const cnkdPending = new Map();
const cnkdTickets = new Map();

const b64url = (buf) =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function pruneCnkd() {
  const now = Date.now();
  for (const [k, v] of cnkdPending) if (now - v.at > CNKD_PENDING_TTL) cnkdPending.delete(k);
  for (const [k, v] of cnkdTickets) if (now - v.at > CNKD_TICKET_TTL) cnkdTickets.delete(k);
}

function originOf(req) {
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  return `${proto}://${host}`;
}

function redirectUriOf(req) {
  return cnkdCfg().redirectUri || `${originOf(req)}/api/cnkd/callback`;
}

async function cnkdPost(path, body, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(CNKD_API + path, {
      method: "POST",
      headers: { "content-type": "application/json", ...(headers || {}) },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await resp.json().catch(() => ({}));
    return { status: resp.status, json };
  } finally {
    clearTimeout(timer);
  }
}

async function cnkdUserinfo(accessToken) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(CNKD_API + "/account/oauth/userinfo", {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    const json = await resp.json().catch(() => ({}));
    return { status: resp.status, json };
  } finally {
    clearTimeout(timer);
  }
}

function sendRedirect(res, location) {
  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  res.end();
}

/* ------------------------------- 静态文件 ------------------------------- */

function proxyCloud(req, res, upstream) {
  let target;
  try {
    target = new URL(upstream + req.url);
  } catch (_) {
    return sendJson(res, 500, { error: "bad_upstream" });
  }

  const isHttps = target.protocol === "https:";
  const lib = isHttps ? require("https") : require("http");

  const headers = Object.assign({}, req.headers);
  // 逐跳头不能转发，否则 Node 会重复分块
  for (const k of ["host", "origin", "referer", "accept-encoding", "connection", "keep-alive", "proxy-connection", "transfer-encoding", "te", "trailer", "upgrade"]) {
    delete headers[k];
  }

  // 云会话存在 localStorage，不依赖 cookie。浏览器会把同一主机（不分端口）
  // 的所有 cookie 都带上来，面板机上很容易累积到十几 KB，上游直接回 431。
  const cookieBytes = String(req.headers.cookie || "").length;
  delete headers.cookie;

  let fwdBytes = 0;
  for (const [k, v] of Object.entries(headers)) fwdBytes += k.length + String(v).length + 4;
  if (cookieBytes > 2048 || fwdBytes > 8192) {
    console.warn(
      `[proxy] 请求头偏大：转发 ${fwdBytes}B` +
        (cookieBytes ? `，已丢弃 cookie ${cookieBytes}B` : "") +
        ` · ${req.method} ${req.url}`
    );
  }
  if (req.headers.host) headers["x-forwarded-host"] = req.headers.host;
  headers["x-forwarded-proto"] =
    (req.headers["x-forwarded-proto"] || "").split(",")[0].trim() ||
    (req.socket.encrypted ? "https" : "http");
  if (PS_UPSTREAM_HOST) headers.host = PS_UPSTREAM_HOST;

  const upReq = lib.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      path: target.pathname + target.search,
      method: req.method,
      headers,
      timeout: 120000,
      ...(isHttps
        ? {
            servername: PS_UPSTREAM_HOST || target.hostname,
            rejectUnauthorized: !PS_TLS_INSECURE,
          }
        : {}),
    },
    (upRes) => {
      const out = Object.assign({}, upRes.headers);
      // 同源场景不需要 CORS 头，也避免把上游白名单暴露给浏览器
      for (const k of Object.keys(out)) {
        const low = k.toLowerCase();
        if (low.startsWith("access-control-") || ["connection", "keep-alive", "transfer-encoding", "trailer", "upgrade"].includes(low)) {
          delete out[k];
        }
      }
      out["x-proxied-by"] = "pixelsong";
      res.writeHead(upRes.statusCode || 502, out);
      upRes.pipe(res);
      upRes.on("error", () => res.destroy());
    }
  );

  upReq.on("timeout", () => upReq.destroy(new Error("upstream_timeout")));
  upReq.on("error", (err) => {
    console.error(
      `[proxy] 上游不可达 ${target.origin}${target.pathname} · ${err.code || ""} ${err.message}`
    );
    if (res.headersSent) return res.destroy();
    sendJson(res, 502, {
      error: "upstream_unreachable",
      code: err.code || null,
      message: err.message,
      upstream: target.origin,
    });
  });
  req.pipe(upReq);
}

/** 自检：从这台服务器能否连上数据面。返回 DNS、耗时与具体错误码 */
function upstreamProbe() {
  const base = PS_UPSTREAM || PS_ENDPOINT || DEFAULT_ENDPOINT;
  let target;
  try {
    target = new URL(base);
  } catch (_) {
    return Promise.resolve({ ok: false, error: "bad_upstream", upstream: base });
  }
  const isHttps = target.protocol === "https:";
  const lib = isHttps ? require("https") : require("http");
  const started = Date.now();

  return new Promise((resolve) => {
    const req = lib.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: "/api/health",
        method: "GET",
        timeout: 8000,
        ...(isHttps
          ? {
              servername: PS_UPSTREAM_HOST || target.hostname,
              rejectUnauthorized: !PS_TLS_INSECURE,
            }
          : {}),
        headers: PS_UPSTREAM_HOST ? { host: PS_UPSTREAM_HOST } : {},
      },
      (res) => {
        let body = "";
        res.on("data", (c) => {
          if (body.length < 400) body += c;
        });
        res.on("end", () =>
          resolve({
            ok: res.statusCode === 200,
            status: res.statusCode,
            ms: Date.now() - started,
            upstream: base,
            body: body.slice(0, 200),
          })
        );
      }
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e) =>
      resolve({
        ok: false,
        upstream: base,
        ms: Date.now() - started,
        code: e.code || null,
        error: e.message,
      })
    );
    req.end();
  });
}

const diagAt = new Map();

function serveStatic(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch (_) {
    return sendJson(res, 400, { error: "bad_url" });
  }
  if (pathname === "/") pathname = "/index.html";

  const rel = pathname.replace(/^\/+/, "");
  if (
    DENY_FILES.has(rel) ||
    rel.startsWith(".") ||
    rel.startsWith("scripts/") ||
    rel.includes("node_modules/") ||
    rel.endsWith(".md")
  ) {
    return sendJson(res, 404, { error: "not_found" });
  }

  const filePath = path.resolve(ROOT, rel);
  if (!filePath.startsWith(ROOT + path.sep)) {
    return sendJson(res, 403, { error: "forbidden" });
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // 只有不带扩展名的路径才回退到入口页（哈希路由，无需 history fallback）
      if (path.extname(rel)) return sendJson(res, 404, { error: "not_found" });
      const index = path.join(ROOT, "index.html");
      return fs.readFile(index, (e2, buf) => {
        if (e2) return sendJson(res, 404, { error: "not_found" });
        const html = Buffer.from(injectBoot(buf.toString("utf8"), req), "utf8");
        res.writeHead(200, {
          "Content-Type": MIME[".html"],
          "Cache-Control": "no-cache",
          "Content-Length": html.length,
        });
        res.end(html);
      });
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";
    const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const inm = req.headers["if-none-match"];
    if (inm && inm.split(",").some((v) => v.trim() === etag)) {
      res.writeHead(304, { ETag: etag, "Cache-Control": "no-cache" });
      return res.end();
    }
    const cache = /\.(js|css|html)$/.test(ext)
      ? "no-cache"
      : "public, max-age=86400";
    fs.readFile(filePath, (e2, buf) => {
      if (e2) return sendJson(res, 500, { error: "read_failed" });
      const body = ext === ".html" ? Buffer.from(injectBoot(buf.toString("utf8"), req), "utf8") : buf;
      res.writeHead(200, {
        "Content-Type": type,
        "Cache-Control": cache,
        ETag: etag,
        "Content-Length": body.length,
        "X-Content-Type-Options": "nosniff",
      });
      res.end(body);
    });
  });
}

const server = http.createServer({ maxHeaderSize: 64 * 1024 }, async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      version: APP_VERSION,
      uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000),
      node: process.version,
      geetest: (() => {
        const g = geetestCfg();
        return { enabled: g.enabled, hasId: Boolean(g.id), hasKey: Boolean(g.key) };
      })(),
      cnkd: (() => {
        const c = cnkdCfg();
        return { enabled: c.enabled, mode: c.clientSecret ? "confidential" : "public" };
      })(),
      scan: {
        enabled: vtCfg().enabled,
      },
      checks: {
        nodeFetch: typeof fetch === "function",
        envFile: fs.existsSync(path.join(ROOT, ".env")),
      },
      dataPlane: {
        mode: LOCAL_MODE ? "local" : PS_UPSTREAM ? "proxy" : PS_ENDPOINT ? "direct" : "auto",
        upstream: LOCAL_MODE ? null : PS_UPSTREAM || PS_ENDPOINT || DEFAULT_ENDPOINT,
        dataDir: LOCAL_MODE ? DATA_DIR : undefined,
      },
    });
  }

  if (url.pathname === "/api/diag") {
    const ip =
      (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
      req.socket.remoteAddress ||
      "unknown";
    const last = diagAt.get(ip) || 0;
    if (Date.now() - last < 3000) return sendJson(res, 429, { ok: false, error: "too_frequent" });
    diagAt.set(ip, Date.now());

    const base = PS_UPSTREAM || PS_ENDPOINT || DEFAULT_ENDPOINT;
    let dns = [];
    try {
      const host = new URL(base).hostname;
      const rows = await require("dns").promises.lookup(host, { all: true });
      dns = rows.map((r) => `${r.address} (IPv${r.family})`);
    } catch (e) {
      dns = [`lookup_failed ${e.code || e.message}`];
    }
    const probe = await upstreamProbe();
    return sendJson(res, 200, {
      ...probe,
      dns,
      tlsInsecure: PS_TLS_INSECURE,
      upstreamHost: PS_UPSTREAM_HOST || null,
      mode: PS_UPSTREAM ? "proxy" : PS_ENDPOINT ? "direct" : "auto",
    });
  }

  if (url.pathname === "/api/version") {
    return sendJson(res, 200, {
      version: APP_VERSION,
      entry: "index.html",
      startedAt: new Date(STARTED_AT).toISOString(),
    });
  }

  if (url.pathname === "/api/geetest/config") {
    const g = geetestCfg();
    return sendJson(res, 200, { enabled: g.enabled, captchaId: g.id || null });
  }

  if (url.pathname === "/api/auth/config") {
    const smtpOn = LOCAL_MODE && Boolean(local.getSettings().smtp && local.getSettings().smtp.enabled);
    const g = geetestCfg();
    const c = cnkdCfg();
    const d = (LOCAL_MODE && local.getSettings().donate) || {};
    const donateUrl = String(d.url || "").trim();
    // 只放行爱发电域名，避免后台误填成任意链接
    const donateOk = Boolean(
      d.enabled && /^https:\/\/(?:www\.)?(afdian\.com|afdian\.net)\//i.test(donateUrl)
    );
    return sendJson(res, 200, {
      mode: LOCAL_MODE ? "local" : "cloud",
      otp: LOCAL_MODE ? smtpOn : true,
      captcha: { enabled: g.enabled, provider: "geetest", captchaId: g.id || null },
      cnkd: { enabled: c.enabled },
      donate: {
        enabled: donateOk,
        url: donateOk ? donateUrl : "",
        title: donateOk ? String(d.title || "").trim() : "",
        note: donateOk ? String(d.note || "").trim() : "",
      },
      // 空库：还没有任何账号，此时必须允许不带验证码创建首个主办方，
      // 否则「配 SMTP 需要管理员、注册需要 SMTP」会死锁
      firstRun: LOCAL_MODE && local.rows("profiles").length === 0,
    });
  }

  if (url.pathname === "/api/geetest/validate") {
    if (req.method !== "POST") return sendJson(res, 405, { ok: false, reason: "method_not_allowed" });
    if (!geetestCfg().enabled) {
      return sendJson(res, 200, { ok: false, reason: "not_configured" });
    }
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch (_) {
      return sendJson(res, 400, { ok: false, reason: "bad_request" });
    }
    const result = await validateGeetest(payload);
    return sendJson(res, 200, result);
  }

  if (url.pathname === "/api/scan") {
    if (!vtCfg().enabled) return sendJson(res, 200, { ok: true, enabled: false });
    const hash = (url.searchParams.get("hash") || "").toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(hash)) return sendJson(res, 400, { ok: false, reason: "bad_hash" });
    const hit = vtCache.get(hash);
    if (hit && Date.now() - hit.at < VT_TTL) {
      return sendJson(res, 200, { ok: true, enabled: true, cached: true, ...hit.v });
    }
    const result = await vtLookup(hash, vtCfg().key);
    vtCache.set(hash, { at: Date.now(), v: result });
    return sendJson(res, 200, { ok: true, enabled: true, ...result });
  }

  if (url.pathname === "/api/cnkd/config") {
    const c = cnkdCfg();
    return sendJson(res, 200, {
      enabled: c.enabled,
      mode: c.clientSecret ? "confidential" : "public",
      scope: CNKD_SCOPE,
      site: CNKD_BASE,
    });
  }

  if (url.pathname === "/api/cnkd/start") {
    const c = cnkdCfg();
    if (!c.enabled) {
      return sendRedirect(res, "/#/cnkd?error=" + encodeURIComponent("CNKD 登录尚未配置客户端 ID"));
    }
    pruneCnkd();
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
    const state = crypto.randomBytes(16).toString("hex");
    cnkdPending.set(state, { verifier, at: Date.now() });
    const target = new URL(CNKD_BASE + "/account/oauth/authorize");
    target.searchParams.set("response_type", "code");
    target.searchParams.set("client_id", c.clientId);
    target.searchParams.set("redirect_uri", redirectUriOf(req));
    target.searchParams.set("scope", CNKD_SCOPE);
    target.searchParams.set("state", state);
    target.searchParams.set("code_challenge", challenge);
    target.searchParams.set("code_challenge_method", "S256");
    return sendRedirect(res, target.toString());
  }

  if (url.pathname === "/api/cnkd/callback") {
    const fail = (msg) => sendRedirect(res, "/#/cnkd?error=" + encodeURIComponent(msg));
    const c = cnkdCfg();
    if (!c.enabled) return fail("CNKD 登录尚未配置");
    if (url.searchParams.get("error")) {
      return fail(url.searchParams.get("error_description") || "CNKD 授权未完成");
    }
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) return fail("回调缺少必要参数");
    pruneCnkd();
    const rec = cnkdPending.get(state);
    if (!rec) return fail("登录状态已失效，请重新发起");
    cnkdPending.delete(state);

    const body = {
      grant_type: "authorization_code",
      client_id: c.clientId,
      code,
      redirect_uri: redirectUriOf(req),
      code_verifier: rec.verifier,
    };
    if (c.clientSecret) body.client_secret = c.clientSecret;

    let token;
    try {
      token = await cnkdPost("/account/oauth/token", body);
    } catch (e) {
      return fail("换取令牌失败：" + e.message);
    }
    const tok = token.json && token.json.data;
    if (!tok || !tok.access_token) {
      return fail((token.json && (token.json.message || token.json.error)) || "换取令牌失败");
    }

    let info;
    try {
      info = await cnkdUserinfo(tok.access_token);
    } catch (e) {
      return fail("读取资料失败：" + e.message);
    }
    const p = info.json && info.json.data;
    if (!p || !p.sub) return fail("未取得 CNKD 身份标识");

    const ticket = crypto.randomBytes(24).toString("hex");
    cnkdTickets.set(ticket, {
      at: Date.now(),
      profile: {
        sub: p.sub,
        username: p.username || null,
        displayName: p.displayName || null,
        avatarUrl: p.avatarUrl || null,
        accountStatus: p.accountStatus || null,
        riskLevel: p.riskLevel || null,
      },
    });
    return sendRedirect(res, "/#/cnkd?ticket=" + ticket);
  }

  if (url.pathname === "/api/cnkd/session") {
    const ticket = url.searchParams.get("ticket") || "";
    const rec = cnkdTickets.get(ticket);
    if (!rec) return sendJson(res, 404, { ok: false, reason: "ticket_invalid" });
    if (Date.now() - rec.at > CNKD_TICKET_TTL) {
      cnkdTickets.delete(ticket);
      return sendJson(res, 410, { ok: false, reason: "ticket_expired" });
    }
    cnkdTickets.delete(ticket);
    return sendJson(res, 200, { ok: true, profile: rec.profile });
  }

  if (LOCAL_MODE && url.pathname.startsWith("/.cloud/local/")) {
    await local.handle(req, res, url);
    return;
  }

  if (url.pathname.startsWith("/.cloud/")) {
    const upstream = upstreamFor(req);
    if (!upstream) return sendJson(res, 404, { error: "proxy_disabled" });
    return proxyCloud(req, res, upstream);
  }

  if (url.pathname.startsWith("/api/")) {
    return sendJson(res, 404, { error: "unknown_api" });
  }

  return serveStatic(req, res);
});

if (LOCAL_MODE) {
  local.init(DATA_DIR, path.join(ROOT, "scripts", "seed.json"));
}

const REQUIRED_FILES = ["index.html", "css/app.css", "js/main.js", "js/core.js"];
const missingFiles = REQUIRED_FILES.filter((f) => !fs.existsSync(path.join(ROOT, f)));
if (missingFiles.length) {
  console.error(`[pixelsong] 启动失败：缺少必要文件 ${missingFiles.join(", ")}`);
  process.exit(1);
}

server.listen(PORT, HOST, () => {
  console.log(`[pixelsong] v${APP_VERSION} listening on ${HOST}:${PORT}`);
  console.log(`[pixelsong] geetest ${geetestCfg().enabled ? "enabled" : "disabled"}`);
  console.log(`[pixelsong] cnkd    ${(() => {
    const c = cnkdCfg();
    return c.enabled ? (c.clientSecret ? "confidential" : "public") : "disabled";
  })()}`);
  console.log(
    LOCAL_MODE
      ? `[pixelsong] data    local → ${DATA_DIR}`
      : PS_UPSTREAM
      ? `[pixelsong] data    proxy → ${PS_UPSTREAM}`
      : PS_ENDPOINT
      ? `[pixelsong] data    direct → ${PS_ENDPOINT}`
      : `[pixelsong] data    auto → 官方域名直连，其他域名自动代理到 ${DEFAULT_ENDPOINT}`
  );
});
