/**
 * S3 兼容对象存储（MinIO / Cloudflare R2 / AWS S3 / 阿里云 OSS V4）。
 * 自己实现 SigV4，项目保持零依赖。
 */
const crypto = require("crypto");

const EMPTY_SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const ALGO = "AWS4-HMAC-SHA256";

function cfgOf(raw) {
  const c = raw || {};
  return {
    enabled: Boolean(c.enabled),
    endpoint: String(c.endpoint || "").trim().replace(/\/+$/, ""),
    region: String(c.region || "us-east-1").trim() || "us-east-1",
    bucket: String(c.bucket || "").trim(),
    accessKey: String(c.accessKey || "").trim(),
    secretKey: String(c.secretKey || ""),
    prefix: String(c.prefix || "").replace(/^\/+/, "").replace(/\/*$/, ""),
    publicBaseUrl: String(c.publicBaseUrl || "").trim().replace(/\/+$/, ""),
    pathStyle: Boolean(c.pathStyle),
  };
}

function ready(c) {
  return Boolean(c && c.enabled && c.endpoint && c.bucket && c.accessKey && c.secretKey);
}

function objectKey(c, p) {
  const key = String(p || "").replace(/^\/+/, "");
  return c.prefix ? `${c.prefix}/${key}` : key;
}

function encodeRfc3986(s) {
  return encodeURIComponent(String(s)).replace(/[!'()*]/g, (ch) => "%" + ch.charCodeAt(0).toString(16).toUpperCase());
}

function encodePath(p) {
  return String(p)
    .split("/")
    .map((seg) => encodeRfc3986(seg))
    .join("/");
}

function hmac(key, data) {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function amzDate(d) {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function target(c, key) {
  const u = new URL(c.endpoint);
  const path = encodePath(objectKey(c, key));
  const host = c.pathStyle ? u.host : `${c.bucket}.${u.host}`;
  const pathname = c.pathStyle ? `/${encodeRfc3986(c.bucket)}/${path}` : `/${path}`;
  return { u, host, pathname };
}

function signHeaders(c, method, pathname, headers, payloadHash, now) {
  const stamp = amzDate(now);
  const date = stamp.slice(0, 8);
  headers["x-amz-date"] = stamp;
  headers["x-amz-content-sha256"] = payloadHash;

  const names = Object.keys(headers)
    .map((k) => k.toLowerCase())
    .sort();
  const canonicalHeaders = names.map((k) => `${k}:${String(headers[k]).trim()}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [method, pathname, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${date}/${c.region}/s3/aws4_request`;
  const stringToSign = [ALGO, stamp, scope, sha256Hex(canonicalRequest)].join("\n");

  const kDate = hmac("AWS4" + c.secretKey, date);
  const kRegion = hmac(kDate, c.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  headers.authorization = `${ALGO} Credential=${c.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function request(c, method, key, opt = {}) {
  return new Promise((resolve, reject) => {
    let t;
    try {
      t = target(c, key);
    } catch (e) {
      return reject(new Error("对象存储 Endpoint 不是合法 URL"));
    }
    const lib = t.u.protocol === "https:" ? require("https") : require("http");
    const headers = { host: t.host, ...(opt.headers || {}) };
    const body = opt.body || null;
    if (body) headers["content-length"] = String(body.length);
    if (opt.contentType) headers["content-type"] = opt.contentType;

    const payloadHash = body ? sha256Hex(body) : EMPTY_SHA;
    signHeaders(c, method, t.pathname, headers, payloadHash, opt.now || new Date());

    const req = lib.request(
      {
        protocol: t.u.protocol,
        hostname: t.u.hostname,
        port: t.u.port || (t.u.protocol === "https:" ? 443 : 80),
        method,
        path: t.pathname,
        headers,
        timeout: opt.timeout || 30000,
        servername: t.u.hostname,
      },
      (res) => resolve(res)
    );
    req.on("timeout", () => req.destroy(new Error("对象存储请求超时")));
    req.on("error", (e) => reject(new Error(`对象存储连接失败：${e.message}`)));
    if (body) req.write(body);
    req.end();
  });
}

async function readError(res) {
  let text = "";
  try {
    for await (const chunk of res) {
      text += chunk.toString("utf8");
      if (text.length > 2048) break;
    }
  } catch (_) {}
  const code = (text.match(/<Code>([^<]+)<\/Code>/) || [])[1];
  return `S3 ${res.statusCode}${code ? ` ${code}` : ""}`;
}

async function put(c, key, buf, contentType) {
  const res = await request(c, "PUT", key, {
    body: buf,
    contentType: contentType || "application/octet-stream",
    timeout: 120000,
  });
  res.resume();
  if (res.statusCode >= 300) throw new Error(await readError(res));
  return { key: objectKey(c, key), size: buf.length };
}

async function get(c, key, range) {
  const headers = range ? { range } : {};
  const res = await request(c, "GET", key, { headers, timeout: 120000 });
  if (res.statusCode >= 300) {
    const msg = await readError(res);
    const err = new Error(msg);
    err.statusCode = res.statusCode;
    throw err;
  }
  return res;
}

async function head(c, key) {
  const res = await request(c, "HEAD", key);
  res.resume();
  if (res.statusCode >= 300) throw new Error(await readError(res));
  return { size: Number(res.headers["content-length"] || 0), type: res.headers["content-type"] || "" };
}

async function remove(c, key) {
  const res = await request(c, "DELETE", key);
  res.resume();
  if (res.statusCode >= 300 && res.statusCode !== 404) throw new Error(await readError(res));
  return true;
}

async function copy(c, from, to) {
  const src = `/${c.bucket}/${encodePath(objectKey(c, from))}`;
  const res = await request(c, "PUT", to, { headers: { "x-amz-copy-source": src } });
  res.resume();
  if (res.statusCode >= 300) throw new Error(await readError(res));
  return true;
}

function presignGet(c, key, ttl = 600) {
  const t = target(c, key);
  const now = new Date();
  const stamp = amzDate(now);
  const date = stamp.slice(0, 8);
  const scope = `${date}/${c.region}/s3/aws4_request`;
  const params = {
    "X-Amz-Algorithm": ALGO,
    "X-Amz-Credential": `${c.accessKey}/${scope}`,
    "X-Amz-Date": stamp,
    "X-Amz-Expires": String(Math.max(1, Math.min(604800, Number(ttl) || 600))),
    "X-Amz-SignedHeaders": "host",
  };
  const qs = Object.keys(params)
    .sort()
    .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(params[k])}`)
    .join("&");
  const canonicalRequest = ["GET", t.pathname, qs, `host:${t.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = [ALGO, stamp, scope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac("AWS4" + c.secretKey, date);
  const kRegion = hmac(kDate, c.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const sig = crypto.createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  return `${t.u.protocol}//${t.host}${t.pathname}?${qs}&X-Amz-Signature=${sig}`;
}

function publicUrl(c, key) {
  if (!c.publicBaseUrl) return "";
  return `${c.publicBaseUrl}/${encodePath(objectKey(c, key))}`;
}

async function test(raw) {
  const c = cfgOf(raw);
  if (!ready(c)) throw new Error("对象存储未启用或配置不完整");
  const key = `_healthcheck-${Date.now()}.txt`;
  const buf = Buffer.from(`pixelsong ${new Date().toISOString()}`, "utf8");
  await put(c, key, buf, "text/plain; charset=utf-8");
  const info = await head(c, key);
  const res = await get(c, key);
  let text = "";
  for await (const chunk of res) text += chunk.toString("utf8");
  await remove(c, key);
  return { size: info.size, echo: text.slice(0, 40) };
}

module.exports = { cfgOf, ready, put, get, head, remove, copy, presignGet, publicUrl, test, objectKey };
