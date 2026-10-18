#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const results = [];

function check(name, fn, hint) {
  let ok = false;
  let detail = "";
  try {
    const r = fn();
    if (r && typeof r === "object") {
      ok = !!r.ok;
      detail = r.detail || "";
    } else {
      ok = !!r;
    }
  } catch (e) {
    detail = e.message;
  }
  results.push({ name, ok, detail, hint });
}

check("Node 版本 ≥ 18", () => {
  const major = Number(process.versions.node.split(".")[0]);
  return { ok: major >= 18, detail: `v${process.versions.node}` };
}, "升级 Node 到 18 以上（需要全局 fetch）");

check("必要文件齐全", () => {
  const need = ["index.html", "server.js", "package.json", "css/app.css", "js/main.js", "js/core.js", "js/api.js"];
  const miss = need.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  return { ok: miss.length === 0, detail: miss.length ? "缺少 " + miss.join(", ") : `${need.length} 个文件` };
});

check("package.json 可解析且有 start", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const has = pkg.scripts && typeof pkg.scripts.start === "string";
  return { ok: has, detail: has ? pkg.scripts.start : "缺少 scripts.start" };
});

check("前端无硬编码密钥", () => {
  const files = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(js|html)$/.test(name)) files.push(p);
    }
  })(path.join(ROOT, "js"));
  files.push(path.join(ROOT, "index.html"));
  const bad = [];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    if (/GEETEST_CAPTCHA_KEY|gcaptcha4\.geetest\.com|CNKD_CLIENT_SECRET/.test(src)) bad.push(path.basename(f));
  }
  return { ok: bad.length === 0, detail: bad.length ? "疑似泄露于 " + bad.join(", ") : `${files.length} 个文件` };
}, "Captcha Key 只能走服务端环境变量");

check("源码不可通过静态服务访问", () => {
  const src = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  const ok = src.includes("DENY_FILES") && src.includes('"server.js"');
  return { ok, detail: ok ? "DENY_FILES 已生效" : "server.js 未加入 DENY_FILES" };
}, "否则 /server.js 可被直接下载");

const envFile = path.join(ROOT, ".env");
const hasEnv = fs.existsSync(envFile);
check(".env 文件", () => ({
  ok: true,
  detail: hasEnv ? "存在，本地读取" : "未创建（使用平台注入的环境变量）",
}));

let id = "";
let key = "";
if (hasEnv) {
  const text = fs.readFileSync(envFile, "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(GEETEST_CAPTCHA_ID|GEETEST_CAPTCHA_KEY)\s*=\s*(.*)\s*$/);
    if (m) {
      if (m[1] === "GEETEST_CAPTCHA_ID") id = m[2].trim();
      else key = m[2].trim();
    }
  }
}
check("极验配置", () => {
  if (!id && !key) return { ok: true, detail: "未配置（降级：跳过人机验证）" };
  if (!id || !key) return { ok: false, detail: "只填了一个，需同时配置 ID 与 Key" };
  return { ok: true, detail: "ID 与 Key 均已配置" };
}, "到 console.geetest.com 新建行为验证 4.0 应用");

let cnkdId = process.env.CNKD_CLIENT_ID || "";
let cnkdUri = process.env.CNKD_REDIRECT_URI || "";
if (hasEnv) {
  const text = fs.readFileSync(envFile, "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(CNKD_CLIENT_ID|CNKD_REDIRECT_URI)\s*=\s*(.*)\s*$/);
    if (m) {
      if (m[1] === "CNKD_CLIENT_ID") cnkdId = cnkdId || m[2].trim();
      else cnkdUri = cnkdUri || m[2].trim();
    }
  }
}
check("CNKD 一证通行", () => {
  if (!cnkdId) return { ok: true, detail: "未配置（登录页按钮置灰）" };
  if (!cnkdUri) return { ok: false, detail: "已配 client_id 但未配 CNKD_REDIRECT_URI" };
  if (!/^https:\/\//.test(cnkdUri)) return { ok: false, detail: "回调地址必须是 HTTPS（127.0.0.1 除外）" };
  if (!cnkdUri.endsWith("/api/cnkd/callback")) return { ok: false, detail: "回调路径应为 /api/cnkd/callback" };
  return { ok: true, detail: cnkdUri };
}, "回调地址必须与 CNKD 平台登记值逐字一致");

check("病毒扫描（VirusTotal）", () => {
  const k = process.env.VT_API_KEY || "";
  return { ok: true, detail: k ? "已配置" : "未配置（提交页显示未启用）" };
}, "在 virustotal.com 申请免费 API key");

const pad = (s, n) => s + " ".repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 2 : 1), 0)));

console.log("\n像素松 · 部署前自检\n" + "─".repeat(52));
let failed = 0;
for (const r of results) {
  const mark = r.ok ? " PASS " : " FAIL ";
  if (!r.ok) failed++;
  console.log(`${mark} ${pad(r.name, 22)} ${r.detail}`);
  if (!r.ok && r.hint) console.log(`        → ${r.hint}`);
}
console.log("─".repeat(52));
if (failed) {
  console.log(`${failed} 项未通过，修复后再部署。\n`);
  process.exit(1);
}
console.log("全部通过，可以部署：node server.js\n");
