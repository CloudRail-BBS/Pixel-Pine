#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const BASE = (process.argv[2] || "https://pixelsong.app.workbuddy.host").replace(/\/$/, "");
const ROOT = path.resolve(__dirname, "..");

let pkgVersion = "unknown";
try {
  pkgVersion = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
} catch (_) {}

const results = [];
const pad = (s, n) => s + " ".repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 2 : 1), 0)));

async function probe(name, fn) {
  try {
    const r = await fn();
    results.push({ name, ...r });
  } catch (e) {
    results.push({ name, ok: false, detail: e.message || "请求失败" });
  }
}

const get = (p) => fetch(BASE + p, { redirect: "manual" });

(async () => {
  await probe("首页可访问", async () => {
    const r = await get("/");
    const text = r.status === 200 ? await r.text() : "";
    const ok = r.status === 200 && text.includes("像素松");
    return { ok, detail: `${r.status}${ok ? "" : " 内容异常"}` };
  });

  await probe("站点图标可加载", async () => {
    const r = await get("/assets/logo.svg");
    const ct = r.headers.get("content-type") || "";
    return { ok: r.status === 200 && ct.includes("svg"), detail: `${r.status} ${ct.split(";")[0]}` };
  });

  await probe("SDK 走本地资源", async () => {
    const r = await get("/assets/vendor/workbuddy-cloud-sdk.js");
    const text = r.status === 200 ? await r.text() : "";
    const ok = r.status === 200 && text.includes("WorkBuddyCloud");
    return { ok, detail: ok ? `${Math.round(text.length / 1024)} KB` : `${r.status} 资源缺失` };
  });

  await probe("首页不再引 CDN", async () => {
    const r = await get("/");
    const text = r.status === 200 ? await r.text() : "";
    const local = text.includes("assets/vendor/workbuddy-cloud-sdk.js");
    const cdn = text.includes("cdn.jsdelivr.net");
    return { ok: local && !cdn, detail: local ? (cdn ? "仍引用 CDN" : "仅本地资源") : "未引用本地 SDK" };
  });

  await probe("数据面模式", async () => {
    const r = await get("/api/health");
    const j = await r.json();
    const mode = (j.dataPlane || {}).mode || "?";
    const ok = mode === "local" || mode === "proxy" || mode === "direct" || mode === "auto";
    return { ok, detail: mode };
  });

  await probe("健康检查", async () => {
    const r = await get("/api/health");
    const j = await r.json();
    if (!j.ok) return { ok: false, detail: "ok=false" };
    const same = j.version === pkgVersion;
    return {
      ok: same,
      detail: `v${j.version}${same ? "" : ` ≠ 本地 v${pkgVersion}`} · node ${j.node}`,
    };
  });

  await probe("CNKD 配置接口", async () => {
    const r = await get("/api/cnkd/config");
    const j = await r.json();
    return { ok: typeof j.enabled === "boolean", detail: j.enabled ? "已启用" : "未配置（按钮置灰）" };
  });

  await probe("极验配置接口", async () => {
    const r = await get("/api/geetest/config");
    const j = await r.json();
    return { ok: typeof j.enabled === "boolean", detail: j.enabled ? "已启用" : "未配置（跳过机验）" };
  });

  await probe("病毒扫描接口", async () => {
    const r = await get("/api/scan?hash=" + "0".repeat(64));
    const j = await r.json();
    const ok = j.ok === true && typeof j.enabled === "boolean";
    return { ok, detail: j.enabled ? `已启用（${j.status || "查询中"}）` : "未配置（显示未启用）" };
  });

  await probe("源码 server.js 不可下载", async () => {
    const r = await get("/server.js");
    return { ok: r.status === 404, detail: String(r.status) };
  });

  await probe("脚本目录不可下载", async () => {
    const r = await get("/scripts/preflight.js");
    return { ok: r.status === 404, detail: String(r.status) };
  });

  await probe("package.json 不可下载", async () => {
    const r = await get("/package.json");
    return { ok: r.status === 404, detail: String(r.status) };
  });

  await probe("核心模块可加载", async () => {
    const r = await get("/js/core.js");
    const ct = r.headers.get("content-type") || "";
    const ok = r.status === 200 && ct.includes("javascript");
    return { ok, detail: `${r.status} ${ct.split(";")[0]}` };
  });

  await probe("后台模块可加载", async () => {
    const r = await get("/js/views-admin.js");
    return { ok: r.status === 200, detail: String(r.status) };
  });

  await probe("缺失资源返回 404", async () => {
    const r = await get("/js/__missing__.js");
    return { ok: r.status === 404, detail: String(r.status) };
  });

  await probe("极验伪造校验被拒", async () => {
    const r = await fetch(BASE + "/api/geetest/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lot_number: "fake",
        captcha_output: "fake",
        pass_token: "fake",
        gen_time: "0",
      }),
    });
    const j = await r.json();
    const ok = j.ok === false;
    return { ok, detail: ok ? `已拒绝（${j.reason}）` : "竟然通过了" };
  });

  console.log(`\n像素松 · 线上冒烟测试  ${BASE}\n${"─".repeat(58)}`);
  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed++;
    console.log(`${r.ok ? " PASS " : " FAIL "} ${pad(r.name, 24)} ${r.detail}`);
  }
  console.log("─".repeat(58));
  if (failed) {
    console.log(`${failed} 项未通过。\n`);
    process.exit(1);
  }
  console.log("线上状态正常。\n");
})();
