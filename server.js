"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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
const CNKD_CLIENT_ID = process.env.CNKD_CLIENT_ID || "";
const CNKD_CLIENT_SECRET = process.env.CNKD_CLIENT_SECRET || "";
const CNKD_REDIRECT_URI = process.env.CNKD_REDIRECT_URI || "";
const CNKD_SCOPE = "profile.basic profile.status";
const CNKD_PENDING_TTL = 10 * 60 * 1000;
const CNKD_TICKET_TTL = 5 * 60 * 1000;

const VT_KEY = process.env.VT_API_KEY || "";
const VT_TTL = 30 * 60 * 1000;
const vtCache = new Map();

/* ---------- 同源代理：让任意域名都能直接跑 ----------
 * 数据面（/.cloud/**）的跨源预检会返回 403 且不带 CORS 头，浏览器必然报
 * "TypeError: Failed to fetch"。把 /.cloud/** 反代到发布的 endpoint 后，
 * 浏览器看到的是同源请求，不再有预检，也不依赖对方返回 CORS。
 */
const DEFAULT_ENDPOINT = "https://pixelsong.app.workbuddy.host";
const PS_UPSTREAM = String(process.env.PS_UPSTREAM || "").trim().replace(/\/+$/, "");
const PS_ENDPOINT = String(process.env.PS_ENDPOINT || "").trim().replace(/\/+$/, "");
const PS_PUBLISHABLE_KEY =
  process.env.PS_PUBLISHABLE_KEY ||
  "wbpk_ASDGMaTrV7dAuvQijziP8z_1cmrp1ZytZS54tR74qrBdBG6NGJrS6c0";

/**
 * 决定这次请求的数据面走向。
 *  - 显式 PS_UPSTREAM：全部走代理
 *  - 显式 PS_ENDPOINT：直连，不代理
 *  - 两者都没配：在官方域名上直连，在其他域名（IP、localhost、自有域名）上自动代理
 */
function upstreamFor(req) {
  if (PS_UPSTREAM) return PS_UPSTREAM;
  if (PS_ENDPOINT) return "";
  const host = String(req.headers.host || "").toLowerCase();
  const prodHost = new URL(DEFAULT_ENDPOINT).host.toLowerCase();
  return host === prodHost ? "" : DEFAULT_ENDPOINT;
}

/** 下发给浏览器的运行配置；代理模式下省略 endpoint，SDK 自动用 location.origin */
function bootConfig(req) {
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

async function vtLookup(hash) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(`https://www.virustotal.com/api/v3/files/${hash}`, {
      headers: { "x-apikey": VT_KEY },
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
  const signToken = hmacSha256(String(lot_number), GEETEST_KEY);
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
      `https://gcaptcha4.geetest.com/validate?captcha_id=${encodeURIComponent(GEETEST_ID)}`,
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
  return CNKD_REDIRECT_URI || `${originOf(req)}/api/cnkd/callback`;
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
  delete headers.host;
  delete headers.origin;
  delete headers.referer;
  delete headers["accept-encoding"]; // 交给上游压缩，避免二次编码
  headers["x-forwarded-host"] = req.headers.host || "";
  headers["x-forwarded-proto"] =
    (req.headers["x-forwarded-proto"] || "").split(",")[0].trim() ||
    (req.socket.encrypted ? "https" : "http");

  const upReq = lib.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      path: target.pathname + target.search,
      method: req.method,
      headers,
      timeout: 120000,
    },
    (upRes) => {
      const out = Object.assign({}, upRes.headers);
      // 同源场景不需要 CORS 头，也避免把上游白名单暴露给浏览器
      for (const k of Object.keys(out)) {
        if (k.toLowerCase().startsWith("access-control-")) delete out[k];
      }
      out["x-proxied-by"] = "pixelsong";
      res.writeHead(upRes.statusCode || 502, out);
      upRes.pipe(res);
      upRes.on("error", () => res.destroy());
    }
  );

  upReq.on("timeout", () => upReq.destroy(new Error("upstream_timeout")));
  upReq.on("error", (err) => {
    if (res.headersSent) return res.destroy();
    sendJson(res, 502, { error: "upstream_unreachable", message: err.message });
  });
  req.pipe(upReq);
}

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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      version: APP_VERSION,
      uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000),
      node: process.version,
      geetest: {
        enabled: Boolean(GEETEST_ID && GEETEST_KEY),
        hasId: Boolean(GEETEST_ID),
        hasKey: Boolean(GEETEST_KEY),
      },
      cnkd: {
        enabled: Boolean(CNKD_CLIENT_ID),
        mode: CNKD_CLIENT_SECRET ? "confidential" : "public",
      },
      scan: {
        enabled: Boolean(VT_KEY),
      },
      checks: {
        nodeFetch: typeof fetch === "function",
        envFile: fs.existsSync(path.join(ROOT, ".env")),
      },
      dataPlane: {
        mode: PS_UPSTREAM ? "proxy" : PS_ENDPOINT ? "direct" : "auto",
        upstream: PS_UPSTREAM || PS_ENDPOINT || DEFAULT_ENDPOINT,
      },
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
    return sendJson(res, 200, {
      enabled: Boolean(GEETEST_ID && GEETEST_KEY),
      captchaId: GEETEST_ID || null,
    });
  }

  if (url.pathname === "/api/geetest/validate") {
    if (req.method !== "POST") return sendJson(res, 405, { ok: false, reason: "method_not_allowed" });
    if (!GEETEST_ID || !GEETEST_KEY) {
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
    if (!VT_KEY) return sendJson(res, 200, { ok: true, enabled: false });
    const hash = (url.searchParams.get("hash") || "").toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(hash)) return sendJson(res, 400, { ok: false, reason: "bad_hash" });
    const hit = vtCache.get(hash);
    if (hit && Date.now() - hit.at < VT_TTL) {
      return sendJson(res, 200, { ok: true, enabled: true, cached: true, ...hit.v });
    }
    const result = await vtLookup(hash);
    vtCache.set(hash, { at: Date.now(), v: result });
    return sendJson(res, 200, { ok: true, enabled: true, ...result });
  }

  if (url.pathname === "/api/cnkd/config") {
    return sendJson(res, 200, {
      enabled: Boolean(CNKD_CLIENT_ID),
      mode: CNKD_CLIENT_SECRET ? "confidential" : "public",
      scope: CNKD_SCOPE,
      site: CNKD_BASE,
    });
  }

  if (url.pathname === "/api/cnkd/start") {
    if (!CNKD_CLIENT_ID) {
      return sendRedirect(res, "/#/cnkd?error=" + encodeURIComponent("CNKD 登录尚未配置客户端 ID"));
    }
    pruneCnkd();
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
    const state = crypto.randomBytes(16).toString("hex");
    cnkdPending.set(state, { verifier, at: Date.now() });
    const target = new URL(CNKD_BASE + "/account/oauth/authorize");
    target.searchParams.set("response_type", "code");
    target.searchParams.set("client_id", CNKD_CLIENT_ID);
    target.searchParams.set("redirect_uri", redirectUriOf(req));
    target.searchParams.set("scope", CNKD_SCOPE);
    target.searchParams.set("state", state);
    target.searchParams.set("code_challenge", challenge);
    target.searchParams.set("code_challenge_method", "S256");
    return sendRedirect(res, target.toString());
  }

  if (url.pathname === "/api/cnkd/callback") {
    const fail = (msg) => sendRedirect(res, "/#/cnkd?error=" + encodeURIComponent(msg));
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
      client_id: CNKD_CLIENT_ID,
      code,
      redirect_uri: redirectUriOf(req),
      code_verifier: rec.verifier,
    };
    if (CNKD_CLIENT_SECRET) body.client_secret = CNKD_CLIENT_SECRET;

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

const REQUIRED_FILES = ["index.html", "css/app.css", "js/main.js", "js/core.js"];
const missingFiles = REQUIRED_FILES.filter((f) => !fs.existsSync(path.join(ROOT, f)));
if (missingFiles.length) {
  console.error(`[pixelsong] 启动失败：缺少必要文件 ${missingFiles.join(", ")}`);
  process.exit(1);
}

server.listen(PORT, HOST, () => {
  console.log(`[pixelsong] v${APP_VERSION} listening on ${HOST}:${PORT}`);
  console.log(`[pixelsong] geetest ${GEETEST_ID && GEETEST_KEY ? "enabled" : "disabled"}`);
  console.log(`[pixelsong] cnkd    ${CNKD_CLIENT_ID ? (CNKD_CLIENT_SECRET ? "confidential" : "public") : "disabled"}`);
  console.log(
    PS_UPSTREAM
      ? `[pixelsong] data    proxy → ${PS_UPSTREAM}`
      : PS_ENDPOINT
      ? `[pixelsong] data    direct → ${PS_ENDPOINT}`
      : `[pixelsong] data    auto → 官方域名直连，其他域名自动代理到 ${DEFAULT_ENDPOINT}`
  );
});
