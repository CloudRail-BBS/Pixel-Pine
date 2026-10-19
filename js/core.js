import { PUBLIC_CONFIG, DEFAULT_ACTIVITY } from "./config.js";
import { createLocalCloud } from "./local-cloud.js";

// 本地模式用内置后端，云模式用官方 SDK；两者接口形状一致
export const cloud = PUBLIC_CONFIG.local
  ? createLocalCloud(PUBLIC_CONFIG)
  : window.WorkBuddyCloud.createWorkBuddyCloud(PUBLIC_CONFIG);

export const state = {
  session: null,
  me: null,
  activity: null,
  route: "/home",
  unread: 0,
};

export const db = cloud.database;

export function unwrap(res) {
  if (res && res.error) throw res.error;
  return res ? res.data : null;
}

export async function loadSession() {
  const { data, error } = await cloud.auth.getSession();
  if (error) {
    state.session = null;
    return null;
  }
  state.session = data || null;
  return state.session;
}

export async function loadMe(force = false) {
  if (!state.session) return null;
  if (state.me && !force) return state.me;
  const uid = sessionUid();
  if (!uid) return null;
  const found = unwrap(
    await db.from("profiles").select("*").eq("owner_id", uid).maybeSingle()
  );
  if (found) {
    state.me = found;
    return found;
  }
  const name = state.session.user?.name || null;
  unwrap(
    await db.from("profiles").insert({ owner_name: name, nickname: name }).select()
  );
  const created = unwrap(
    await db.from("profiles").select("*").eq("owner_id", uid).maybeSingle()
  );
  state.me = created;
  return created;
}

export function sessionUid() {
  const u = state.session?.user || {};
  return u.id || u.uid || u.sub || null;
}

export function isAdmin() {
  return state.me?.role === "admin";
}

export function isStaff() {
  return state.me?.role === "admin" || state.me?.role === "judge";
}

export async function loadActivity() {
  const row = unwrap(await db.from("activity").select("*").eq("id", 1).maybeSingle());
  state.activity = row ? { ...DEFAULT_ACTIVITY, ...(row.data || {}) } : { ...DEFAULT_ACTIVITY };
  return state.activity;
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const esc = (v) =>
  String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

const pad = (n) => (n < 10 ? "0" + n : "" + n);

export function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtFull(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function timeLeft(iso) {
  if (!iso) return { text: "—", ms: 0, over: true };
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return { text: "已截止", ms: 0, over: true };
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return { text: d > 0 ? `${d} 天 ${h} 小时` : `${h} 小时 ${m} 分`, ms, over: false };
}

export function ago(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return fmtDate(iso);
}

let toastHost = null;
export function toast(msg, type = "") {
  if (!toastHost) {
    toastHost = document.createElement("div");
    toastHost.className = "toast-host";
    document.body.appendChild(toastHost);
  }
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = msg;
  toastHost.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity .2s";
    setTimeout(() => el.remove(), 220);
  }, 3200);
}

export function modal(html, opts = {}) {
  const host = document.createElement("div");
  host.className = "modal-host";
  host.innerHTML = `<div class="modal">${html}</div>`;
  host.addEventListener("click", (e) => {
    if (e.target === host) close();
  });
  function close() {
    host.remove();
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) {
    if (e.key === "Escape") close();
  }
  document.addEventListener("keydown", onKey);
  document.body.appendChild(host);
  if (opts.onMount) opts.onMount(host);
  return { close, host };
}

export function confirmBox(title, body, okText = "确认") {
  return new Promise((resolve) => {
    const m = modal(
      `<h3>${esc(title)}</h3><p class="muted small">${body}</p>
       <div class="row" style="justify-content:flex-end;margin-top:18px">
         <button class="btn btn-ghost" data-x="no">取消</button>
         <button class="btn btn-primary" data-x="yes">${esc(okText)}</button>
       </div>`,
      {
        onMount(host) {
          host.querySelector('[data-x="no"]').onclick = () => { m.close(); resolve(false); };
          host.querySelector('[data-x="yes"]').onclick = () => { m.close(); resolve(true); };
        },
      }
    );
  });
}

export function busy(btn, on, text) {
  if (!btn) return;
  if (on) {
    if (!btn.dataset.label) btn.dataset.label = btn.textContent;
    btn.disabled = true;
    btn.textContent = text || "处理中…";
  } else {
    btn.disabled = false;
    if (btn.dataset.label) {
      btn.textContent = btn.dataset.label;
      delete btn.dataset.label;
    }
  }
}

export function errMsg(e, fallback = "操作失败，请稍后重试") {
  const code = e?.code || e?.error?.code;
  if (code === "23505") return "记录已存在，请不要重复提交";
  if (code === "42501") return "没有权限执行该操作";
  if (code === "42P01") return "数据表不存在，请联系主办方";
  return e?.message || e?.error?.description || fallback;
}

const routes = new Map();
export function route(path, handler) {
  routes.set(path, handler);
}

const cache = new Map();
export async function cached(key, ttlMs, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await loader();
  cache.set(key, { t: Date.now(), v });
  return v;
}
export function invalidate(...keys) {
  if (!keys.length) return cache.clear();
  for (const k of keys) {
    for (const ck of [...cache.keys()]) {
      if (ck === k || ck.startsWith(k + ":")) cache.delete(ck);
    }
  }
}
export function navigate(path, replace = false) {
  if (replace) {
    location.replace("#" + path);
  } else if (location.hash.slice(1) === path) {
    render();
  } else {
    location.hash = path;
  }
}
export function currentPath() {
  return location.hash.replace(/^#/, "") || "/home";
}

let barTimer = null;
function barStart() {
  const bar = document.getElementById("top-progress");
  if (!bar) return;
  clearTimeout(barTimer);
  bar.className = "on";
  bar.style.width = "16%";
  requestAnimationFrame(() => {
    bar.style.width = "72%";
  });
}
function barDone() {
  const bar = document.getElementById("top-progress");
  if (!bar) return;
  bar.className = "done";
  barTimer = setTimeout(() => {
    bar.className = "";
    bar.style.width = "0";
  }, 620);
}

function resolveRoute(path) {
  if (routes.has(path)) return routes.get(path);
  let best = null;
  let bestLen = -1;
  for (const key of routes.keys()) {
    if (!key.endsWith("/*")) continue;
    const prefix = key.slice(0, -2);
    if ((path === prefix || path.startsWith(prefix + "/")) && prefix.length > bestLen) {
      best = routes.get(key);
      bestLen = prefix.length;
    }
  }
  return best || routes.get("*");
}

function skeletonHtml() {
  return `<div class="skel">
    <div class="skel-line" style="width:34%;height:22px;margin-bottom:10px"></div>
    <div class="skel-line" style="width:58%;height:14px;margin-bottom:26px"></div>
    <div class="grid grid-3" style="margin-bottom:22px">
      <div class="skel-block" style="height:78px"></div>
      <div class="skel-block" style="height:78px"></div>
      <div class="skel-block" style="height:78px"></div>
    </div>
    <div class="skel-block" style="height:180px;margin-bottom:16px"></div>
    <div class="skel-block" style="height:120px"></div>
  </div>`;
}

export async function render() {
  const path = currentPath();
  const base = path.split("?")[0];
  const changed = state.route !== base;
  state.route = base;
  const handler = resolveRoute(base);
  const el = document.getElementById("app");
  barStart();

  let done = false;
  const slowTimer = setTimeout(() => {
    if (!done && !el.querySelector("header.top")) el.innerHTML = skeletonHtml();
  }, 150);

  try {
    await handler(el, path);
  } catch (e) {
    console.error(e);
    el.innerHTML = shell(
      `<div class="card"><h2>页面加载失败</h2><p class="muted small">${esc(errMsg(e))}</p>
       <button class="btn" onclick="location.reload()">重新加载</button></div>`
    );
  } finally {
    done = true;
    clearTimeout(slowTimer);
  }
  barDone();
  if (changed) window.scrollTo(0, 0);
}

export function navItems() {
  const items = [
    ["/home", "首页"],
    ["/rules", "规则"],
    ["/works", "参赛作品"],
    ["/results", "结果"],
    ["/judges", "评委团"],
    ["/notices", "公告"],
  ];
  if (state.session) {
    items.push(["/me", "我的"]);
    items.push(["/team", "组队"]);
    items.push(["/work", "作品"]);
    if (isStaff()) items.push(["/judge", "评审"]);
    if (isAdmin()) items.push(["/admin", "后台"]);
  }
  return items;
}

export function shell(content, opts = {}) {
  const items = navItems();
  const active = state.route;
  const isOn = (p) => active === p || (p !== "/" && active.startsWith(p + "/"));
  const user = state.session?.user;
  const name = state.me?.nickname || user?.name || (user?.email ? user.email.split("@")[0] : "");
  const initials = name ? name.slice(0, 1).toUpperCase() : "·";
  return `
  <header class="top">
    <div class="top-inner">
      <a class="brand" href="#/home">
        <img class="brand-logo" src="assets/logo.svg" alt="" width="22" height="22" />
        像素松
      </a>
      <nav class="main">
        ${items.map(([p, t]) => `<a href="#${p}" class="${isOn(p) ? "active" : ""}">${t}</a>`).join("")}
      </nav>
      <div class="top-user">
        <button class="theme-toggle" type="button" data-theme-toggle aria-label="切换明暗模式" title="切换明暗模式">
          <svg class="icon-moon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M13.6 9.7A5.9 5.9 0 0 1 6.3 2.4a5.9 5.9 0 1 0 7.3 7.3Z" />
          </svg>
          <svg class="icon-sun" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
            <circle cx="8" cy="8" r="3.1" />
            <path d="M8 1.3v1.5M8 13.2v1.5M1.3 8h1.5M13.2 8h1.5M3.3 3.3l1.1 1.1M11.6 11.6l1.1 1.1M12.7 3.3l-1.1 1.1M4.4 11.6l-1.1 1.1" />
          </svg>
        </button>
        ${
          state.session
            ? `<span class="avatar">${esc(initials)}</span>
               <span class="small">${esc(name || "已登录")}</span>
               <button class="btn btn-sm btn-ghost" id="btn-logout">退出</button>`
            : `<a class="btn btn-sm btn-primary" href="#/login">登录 / 报名</a>`
        }
      </div>
    </div>
  </header>
  <main class="${opts.wide ? "wide" : ""}">${content}</main>
  <nav class="mobile-nav">
    ${items.map(([p, t]) => `<a href="#${p}" class="${isOn(p) ? "active" : ""}">${t}</a>`).join("")}
  </nav>`;
}

export function bindShell() {
  const btn = document.getElementById("btn-logout");
  if (btn) {
    btn.onclick = async () => {
      btn.disabled = true;
      await cloud.auth.signOut();
      state.session = null;
      state.me = null;
      toast("已退出登录", "ok");
      navigate("/home");
    };
  }
}

/* ------------------------------ 明暗主题 ------------------------------ */

const THEME_KEY = "ps-theme";
const THEME_BG = { dark: "#0b0d11", light: "#f7f8f5" };

export function currentTheme() {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function paintTheme(theme, persist) {
  // 切换瞬间统一挂 240ms 过渡，避免大面积颜色硬切；首屏不触发
  if (persist) {
    document.documentElement.classList.add("theme-switching");
    clearTimeout(paintTheme._timer);
    paintTheme._timer = setTimeout(
      () => document.documentElement.classList.remove("theme-switching"),
      260
    );
  }
  document.documentElement.dataset.theme = theme;
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (_) {}
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_BG[theme]);
  const label = `切换到${theme === "light" ? "深色" : "浅色"}模式`;
  document.querySelectorAll("[data-theme-toggle]").forEach((b) => {
    b.setAttribute("aria-label", label);
    b.setAttribute("title", label);
    b.setAttribute("aria-pressed", theme === "light" ? "true" : "false");
  });
}

/** 页面启动时调用一次：同步按钮状态，并接管所有切换按钮的点击 */
export function initTheme() {
  paintTheme(currentTheme(), false);
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-theme-toggle]");
    if (!btn) return;
    e.preventDefault();
    paintTheme(currentTheme() === "light" ? "dark" : "light", true);
    // 重新渲染后按钮会重建，这里同步一次最新状态
    paintTheme(currentTheme(), false);
  });
}

export function requireLogin(el) {
  if (!state.session) {
    el.innerHTML = shell(`
      <div class="card" style="max-width:460px;margin:60px auto;text-align:center">
        <h2 style="margin-bottom:8px">需要先登录</h2>
        <p class="muted small">报名、组队与提交作品都需要登录账号。</p>
        <a class="btn btn-primary btn-block" href="#/login" style="margin-top:16px">去登录</a>
      </div>`);
    bindShell();
    return false;
  }
  return true;
}

export function renderDoc(src) {
  const lines = String(src || "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  const toc = [];
  let list = null;
  let para = [];

  const inline = (s) =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, '<span class="mono">$1</span>');

  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${para.map(inline).join("<br>")}</p>`);
      para = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      closeList();
      continue;
    }
    const h2 = line.match(/^##\s+(.*)$/);
    if (h2) {
      flushPara();
      closeList();
      const id = "sec-" + (toc.length + 1);
      toc.push({ id, title: h2[1] });
      out.push(`<h2 id="${id}">${inline(h2[1])}</h2>`);
      continue;
    }
    const h3 = line.match(/^###\s+(.*)$/);
    if (h3) {
      flushPara();
      closeList();
      out.push(`<h3>${inline(h3[1])}</h3>`);
      continue;
    }
    const li = line.match(/^[-*]\s+(.*)$/);
    if (li) {
      flushPara();
      if (list !== "ul") {
        closeList();
        out.push("<ul>");
        list = "ul";
      }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    const ol = line.match(/^\d+\.\s+(.*)$/);
    if (ol) {
      flushPara();
      if (list !== "ol") {
        closeList();
        out.push("<ol>");
        list = "ol";
      }
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }
    closeList();
    para.push(line);
  }
  flushPara();
  closeList();
  return { html: out.join("\n"), toc };
}
