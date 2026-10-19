import {
  cloud, state, shell, bindShell, navigate, toast, esc, fmtDate, fmtFull, timeLeft, ago,
  loadMe, loadActivity, requireLogin, busy, errMsg, db, unwrap, renderDoc, isStaff, sha256Hex,
} from "./core.js";
import {
  TRACKS, trackOf, DIMENSIONS, DEFAULT_ACTIVITY, PARTNER_ROLES, JUDGE_DOC, judgePlainText,
} from "./config.js";
import {
  allSubmissions, listAnnouncements, rankSubmissions, allReviews, trackCounts, awardPlan,
  getDocument, listPartners, listSponsors, publicWorks, publicWork, getIntro,
  listJudgesPublic, getJudgeAck, signJudgeCode,
} from "./api.js";
import { verifyCaptcha } from "./geetest.js";
import { cnkdConfig, startCnkdLogin, fetchCnkdTicket } from "./cnkd.js";
import { signedDownload } from "./upload.js";

let pendingOtp = null;

/* ---------------------------- 首页 ---------------------------- */

/**
 * 首页底部的捐助入口。只有后台开启且填了爱发电链接才会渲染，
 * 刻意做得轻：一条虚线卡片，不抢正文的注意力。
 */
function donateBlock(cfg) {
  const d = cfg && cfg.donate;
  if (!d || !d.enabled || !d.url) return "";
  return `
    <div class="donate-card">
      <span class="donate-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 20s-7-4.35-7-9a4 4 0 0 1 7-2.65A4 4 0 0 1 19 11c0 4.65-7 9-7 9Z" />
        </svg>
      </span>
      <div style="min-width:0;flex:1">
        <div class="donate-title">${esc(d.title || "支持像素松")}</div>
        <p class="donate-note">${esc(
          d.note || "活动不收取任何费用，服务器与域名由志愿者承担。"
        )}</p>
      </div>
      <div class="donate-actions">
        <a class="donate-link" href="#/sponsors">鸣谢名单</a>
        <a class="btn btn-sm donate-btn" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">
          去爱发电 →
        </a>
      </div>
    </div>`;
}

export async function homeView(el) {
  const a = state.activity || DEFAULT_ACTIVITY;
  let teams = [];
  let subs = [];
  let notices = [];
  try {
    subs = await allSubmissions();
  } catch (_) {}
  try {
    notices = (await listAnnouncements()).slice(0, 3);
  } catch (_) {}
  let partners = [];
  try {
    partners = await listPartners();
  } catch (_) {}
  let intro = null;
  try {
    intro = await getIntro();
  } catch (_) {}
  if (state.session) {
    try {
      const { unwrap, db } = await import("./core.js");
      teams = unwrap(await db.from("teams").select("*")) || [];
    } catch (_) {}
  }

  const cd = timeLeft(a.submitDeadline);
  const phases = [
    { key: "signup", label: "报名与组队", time: a.signupDeadline, desc: "个人报名，赛前完成组队，3–5 人一队" },
    { key: "start", label: "开幕 · 发布正式题目", time: a.eventStart, desc: "宣布主题与特别要求，开发计时开始" },
    { key: "submit", label: "提交截止", time: a.submitDeadline, desc: "72 小时开发窗口关闭，作品包与材料锁定" },
    { key: "judge", label: "评审与公示", time: a.judgeDeadline, desc: "兼容性测试 → 评委独立打分 → 结果公示" },
    { key: "road", label: "公示与颁奖", time: a.roadshowAt, desc: "结果公示 24 小时，无异议后颁奖" },
  ];

  const stats = [
    { label: "赛道", value: TRACKS.length, unit: "条" },
    { label: "已注册队伍", value: state.session ? teams.length : "—", unit: state.session ? "支" : "" },
    { label: "已提交作品", value: subs.length, unit: "件" },
    { label: "距提交截止", value: state.session || true ? cd.text : "—", unit: "", small: true },
  ];

  el.innerHTML = shell(`
    <section class="hero">
      <div class="hero-eyebrow">MINECRAFT × RUSTED WARFARE</div>
      <h1>像素松 · 限时创作</h1>
      <p class="hero-sub">${esc(intro?.first || "全程线上，72 小时，做出一个能装进游戏、别人下载后能跑起来的模组或地图。一队 3–5 人，按赛道独立评审，不设路演。")}</p>
      <div class="row row-wrap" style="margin-top:18px;gap:8px">
        <span class="tag tag-teal">本期主题 · ${esc(a.theme)}</span>
        <span class="tag">${esc(a.venue || "")}</span>
        <span class="tag">提交截止 ${esc(fmtDate(a.submitDeadline))}</span>
      </div>
      <div class="row row-wrap" style="margin-top:20px;gap:10px">
        ${state.session
          ? `<a class="btn btn-primary" href="#/work">提交作品</a><a class="btn" href="#/team">我的队伍</a>`
          : `<a class="btn btn-primary" href="#/login">登录 / 报名</a><a class="btn" href="#/rules">先看规则</a>`}
      </div>
    </section>

    <div class="grid grid-4 block">
      ${stats.map((s) => `
        <div class="stat">
          <div class="stat-label">${esc(s.label)}</div>
          <div class="stat-value" style="${s.small ? "font-size:17px" : ""}">${esc(s.value)}<small>${esc(s.unit)}</small></div>
        </div>`).join("")}
    </div>

    <div class="block">
      <div class="block-head"><h2>四条赛道</h2><span class="card-note">按游戏 + 作品类型分赛道，跨赛道不直接比较</span></div>
      <div class="grid grid-4">
        ${TRACKS.map((t) => `
          <div class="card track-card track-${t.code}">
            <div class="row-between" style="margin-bottom:8px">
              <span class="tag ${t.side === "mc" ? "tag-blue" : "tag-amber"}">赛道 ${t.code}</span>
              <span class="card-note">${esc(t.game)}</span>
            </div>
            <div class="strong" style="font-size:15px;margin-bottom:6px">${esc(t.name)}</div>
            <p class="small muted" style="margin:0">${
              t.code === "A" ? "机制创新、兼容性、稳定性、前置依赖" :
              t.code === "B" ? "建筑、关卡、剧情、命令与游玩体验" :
              t.code === "C" ? "单位与机制设计、平衡性、联机兼容" :
              "布局、触发器与脚本、对抗或合作体验"
            }</p>
          </div>`).join("")}
      </div>
    </div>

    <div class="grid grid-2 block">
      <div class="card">
        <div class="card-head"><h2>赛程</h2><span class="card-note">当前阶段</span></div>
        <div class="timeline">
          ${phases.map((p, i) => {
            const t = timeLeft(p.time);
            const passed = t.over;
            const next = !passed && (i === 0 || timeLeft(phases[i - 1].time).over);
            return `<div class="tl-item ${passed ? "done" : next ? "active" : ""}">
              <div class="tl-rail"><span class="tl-dot"></span>${i < phases.length - 1 ? '<span class="tl-line"></span>' : ""}</div>
              <div class="tl-body">
                <div class="tl-title ${passed ? "muted" : "strong"}">${esc(p.label)}</div>
                <div class="tl-time">${esc(fmtFull(p.time))}</div>
                <div class="small dim" style="margin-top:2px">${esc(p.desc)}</div>
              </div>
            </div>`;
          }).join("")}
        </div>
      </div>
      <div class="col" style="gap:14px">
        <div class="card">
          <div class="card-head"><h2>怎么评</h2><span class="card-note">六个维度加权</span></div>
          ${DIMENSIONS.map((d) => `
            <div class="row-between" style="margin-bottom:9px">
              <span class="small">${esc(d.name)}</span>
              <span class="mono small muted">${d.weight}%</span>
            </div>
            <div class="bar" style="margin-bottom:11px"><i style="width:${d.weight * 3.4}%"></i></div>`).join("")}
          <p class="tiny dim" style="margin:0">总分低于 60 分的作品不授予等级奖；同分按可运行性、创意、玩法依次排序。</p>
        </div>
        <div class="card">
          <div class="card-head"><h2>公告</h2><a class="card-note" href="#/notices">全部</a></div>
          ${notices.length ? notices.map((n) => `
            <div class="notice-item">
              <div class="notice-title">${n.pinned ? '<span class="tag tag-amber" style="margin-right:6px">置顶</span>' : ""}${esc(n.title)}</div>
              <div class="notice-meta">${esc(ago(n.created_at))}</div>
            </div>`).join("") : '<div class="empty" style="padding:22px">暂无公告</div>'}
        </div>
      </div>
    </div>

    ${partnerWall(partners, "组织单位", "主办、协办与支持")}
    <div id="donate-slot"></div>
  `);
  bindShell();

  // 捐助入口单独异步补：配置接口慢或挂掉都不能影响首页本身
  loadAuthCfg().then(() => {
    const slot = el.querySelector("#donate-slot");
    if (slot) slot.innerHTML = donateBlock(AUTH_CFG);
  });
}

/* ---------------------------- 组织单位 ---------------------------- */

function orgMonogram(name) {
  const s = String(name || "").trim();
  if (!s) return "·";
  if (/^[\x00-\x7F]+$/.test(s)) {
    return s
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  }
  return s.slice(0, 2);
}

function partnerCard(p) {
  const inner = `
    <span class="org-logo">${
      p.logo_url
        ? `<img src="${esc(p.logo_url)}" alt="${esc(p.name)}" loading="lazy" />`
        : `<b>${esc(orgMonogram(p.name))}</b>`
    }</span>
    <span class="org-meta">
      <b>${esc(p.name)}</b>
      ${p.note ? `<small>${esc(p.note)}</small>` : ""}
    </span>`;
  return p.site_url
    ? `<a class="org-card" href="${esc(p.site_url)}" target="_blank" rel="noopener noreferrer">${inner}<i class="org-out">↗</i></a>`
    : `<div class="org-card">${inner}</div>`;
}

function partnerWall(list, title, note) {
  const rows = (list || []).slice().sort((a, b) => (a.sort || 100) - (b.sort || 100));
  if (!rows.length) return "";
  const groups = PARTNER_ROLES.map((r) => ({ ...r, items: rows.filter((p) => p.role === r.key) })).filter(
    (g) => g.items.length
  );
  const rest = rows.filter((p) => !PARTNER_ROLES.some((r) => r.key === p.role));
  if (rest.length) groups.push({ key: "other", name: "其他单位", note: "", items: rest });

  return `
    <div class="block" id="orgs">
      <div class="block-head"><h2>${esc(title)}</h2><span class="card-note">${esc(note || "")}</span></div>
      <div class="org-wall">
        ${groups
          .map(
            (g) => `
          <div class="org-group">
            <div class="org-role">
              <span class="org-role-name">${esc(g.name)}</span>
              ${g.note ? `<span class="org-role-note">${esc(g.note)}</span>` : ""}
            </div>
            <div class="org-row">${g.items.map(partnerCard).join("")}</div>
          </div>`
          )
          .join("")}
      </div>
    </div>`;
}

/* ---------------------------- 赞助者 ---------------------------- */

const SPONSOR_TIERS = [
  { key: "patron", min: 200, name: "特别鸣谢", note: "为本届赛事提供主要支持" },
  { key: "support", min: 50, name: "热心支持", note: "" },
  { key: "friend", min: 0, name: "同行者", note: "" },
];

function sponsorTier(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return "friend";
  if (n >= SPONSOR_TIERS[0].min) return "patron";
  if (n >= SPONSOR_TIERS[1].min) return "support";
  return "friend";
}

const fmtMoney = (n) =>
  Number(n).toLocaleString("zh-CN", { maximumFractionDigits: 2 });

/** 头像位只放一个字，避免和旁边的昵称重复 */
function sponsorMark(name) {
  const s = String(name || "").trim();
  if (!s) return "·";
  if (/^[\x00-\x7F]+$/.test(s)) return s.slice(0, 2).toUpperCase();
  return s.slice(0, 1);
}

function sponsorCard(s) {
  return `
    <article class="sponsor-card">
      <span class="sponsor-avatar">${
        s.avatar_url
          ? `<img src="${esc(s.avatar_url)}" alt="" loading="lazy" />`
          : esc(sponsorMark(s.name))
      }</span>
      <div class="sponsor-body">
        <div class="sponsor-line">
          <b class="sponsor-name">${esc(s.name)}</b>
          ${
            s.show_amount && Number(s.amount) > 0
              ? `<span class="sponsor-amount">¥ ${esc(fmtMoney(s.amount))}</span>`
              : ""
          }
        </div>
        ${s.message ? `<p class="sponsor-msg">${esc(s.message)}</p>` : ""}
        <div class="sponsor-meta">${esc(fmtDate(s.created_at))}</div>
      </div>
    </article>`;
}

export async function sponsorsView(el) {
  let list = [];
  try {
    list = await listSponsors();
  } catch (_) {}

  const rows = (list || []).slice().sort((a, b) => {
    const amt = (Number(b.amount) || 0) - (Number(a.amount) || 0);
    if (amt) return amt;
    const sort = (a.sort || 100) - (b.sort || 100);
    if (sort) return sort;
    return String(a.name || "").localeCompare(String(b.name || ""), "zh");
  });

  const groups = SPONSOR_TIERS.map((t) => ({
    ...t,
    items: rows.filter((s) => sponsorTier(s.amount) === t.key),
  })).filter((g) => g.items.length);

  el.innerHTML = shell(`
    <div class="sponsor-head block">
      <div class="sponsor-kicker">SPONSORS · 鸣谢</div>
      <h1 class="sponsor-title">赞助者</h1>
      <p class="sponsor-lead">
        像素松全程公益免费，报名、参赛与评审均不收取任何费用。
        以下朋友为服务器、域名与赛事运营提供了支持，让这件事得以持续。
      </p>
      ${
        rows.length
          ? `<div class="sponsor-count"><b>${rows.length}</b><span>位支持者</span></div>`
          : ""
      }
    </div>

    ${
      rows.length
        ? groups
            .map(
              (g) => `
        <section class="sponsor-tier">
          <div class="sponsor-tier-head">
            <h2>${esc(g.name)}</h2>
            ${g.note ? `<span class="card-note">${esc(g.note)}</span>` : ""}
            <span class="sponsor-tier-num">${g.items.length}</span>
          </div>
          <div class="sponsor-grid">
            ${g.items.map(sponsorCard).join("")}
          </div>
        </section>`
            )
            .join("")
        : `<div class="empty" style="padding:48px 20px">
             <p>还没有公开的赞助记录</p>
             <p class="tiny" style="margin-top:8px">赛事期间收到的支持会陆续记录在这里。</p>
             <a class="btn" href="#/home" style="margin-top:16px">返回首页</a>
           </div>`
    }

    ${
      rows.length
        ? `<p class="tiny dim center" style="margin:26px 0 0">
             名单由主办方维护；如需匿名或更正称呼，请联系主办方。
           </p>`
        : ""
    }
    <div id="donate-slot"></div>
  `);
  bindShell();

  // 与首页一致：捐助入口异步补，配置接口出问题也不影响页面
  loadAuthCfg().then(() => {
    const slot = el.querySelector("#donate-slot");
    if (slot) slot.innerHTML = donateBlock(AUTH_CFG);
  });
}

/* ---------------------------- 规则 ---------------------------- */

export async function rulesView(el) {
  let doc = null;
  try {
    doc = await getDocument("rules");
  } catch (_) {}

  if (!doc) {
    el.innerHTML = shell(`
      <div class="empty">
        <p style="margin-bottom:6px">规则暂时无法加载</p>
        <p class="tiny">请刷新重试，或联系主办方</p>
      </div>`);
    bindShell();
    return;
  }

  const { html, toc } = renderDoc(doc.body);

  el.innerHTML = shell(`
    <div class="split">
      <aside class="side-nav">
        ${toc.map((t) => `<a href="#" data-scroll="${t.id}">${esc(t.title)}</a>`).join("")}
        <a href="#/integrity" style="color:var(--accent);margin-top:6px">《诚信比赛公约》</a>
      </aside>
      <article class="rules">
        <h1 style="font-size:22px;margin-bottom:6px">${esc(doc.title)}</h1>
        <p class="small dim" style="margin-bottom:24px">本页由主办方在线维护 · 更新于 ${esc(fmtFull(doc.updated_at))}</p>
        ${html}
        <div class="divider"></div>
        <div class="card">
          <div class="row-between" style="gap:12px">
            <div>
              <div class="strong" style="margin-bottom:3px">《诚信比赛公约》</div>
              <div class="tiny dim">全队成员需各自在线签署，签署后方可提交作品。</div>
            </div>
            <a class="btn btn-sm btn-primary nowrap" href="#/integrity">去签署</a>
          </div>
        </div>
      </article>
    </div>
  `);
  bindShell();

  el.querySelectorAll("[data-scroll]").forEach((a) => {
    a.onclick = (e) => {
      e.preventDefault();
      const target = document.getElementById(a.dataset.scroll);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    };
  });
}

/* ---------------------------- 登录 ---------------------------- */

const LOCAL_MODE = Boolean(
  typeof window !== "undefined" && window.__PS_CONFIG__ && window.__PS_CONFIG__.local
);
// 后台未维护「登录页说明」时的兜底文案
const DEFAULT_LOGIN_NOTE = LOCAL_MODE
  ? "本实例为独立部署：账号、数据与作品文件都保存在这台服务器上。注册需要邮箱验证码，空库时的首个账号免验证码并成为主办方。"
  : "CNKD 一证通行用于核验你在 CNKD 生态的身份并绑定到本站账号；本站作品与报名数据仍由站内账号承载。";
let loginMode = "otp";
let AUTH_CFG = null;

// 每次进登录页都重新拉取：后台开关（验证码 / 人机验证 / CNKD）改完要立即生效
async function loadAuthCfg() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const r = await fetch("/api/auth/config", {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!r.ok) throw new Error(String(r.status));
    AUTH_CFG = await r.json();
  } catch (_) {
    AUTH_CFG = AUTH_CFG || { otp: true, captcha: { enabled: false }, donate: { enabled: false } };
  } finally {
    clearTimeout(timer);
  }
  return AUTH_CFG;
}
let resetCtx = null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const pwdOk = (p) => p.length >= 8 && /\d/.test(p) && /[A-Za-z]/.test(p);

function otpPane() {
  return `
    <div class="field">
      <label class="req">邮箱</label>
      <input type="email" id="f-email" placeholder="you@example.com" autocomplete="email" />
      <div class="hint">用于接收验证码与活动通知</div>
    </div>
    <div class="field">
      <label class="req">邮箱验证码</label>
      <div class="row">
        <input type="text" id="f-code" placeholder="6 位验证码" class="grow" inputmode="numeric" autocomplete="one-time-code" />
        <button class="btn" id="btn-send" type="button">获取验证码</button>
      </div>
    </div>
    <div class="field" id="otp-name-wrap" style="display:none">
      <label class="req">昵称</label>
      <input type="text" id="f-name-o" maxlength="20" placeholder="展示给其他参赛者的昵称" autocomplete="nickname" />
      <div class="hint">新账号需要填写昵称，会出现在队伍、作品与证书上。</div>
    </div>
    <button class="btn btn-primary btn-block" id="btn-otp" type="button">登录 / 注册</button>
    <p class="tiny dim" style="margin-top:12px">新邮箱首次验证码登录会创建账号，需同时填写昵称。想改用密码登录，请先走「忘记密码」设置一次。</p>`;
}

function pwdPane() {
  return `
    <div class="field">
      <label class="req">邮箱</label>
      <input type="email" id="f-email-p" placeholder="you@example.com" autocomplete="email" />
    </div>
    <div class="field">
      <label class="req">密码</label>
      <input type="password" id="f-password" placeholder="输入密码" autocomplete="current-password" />
      ${
        LOCAL_MODE
          ? `<div class="hint">密码至少 6 位。还没有账号请点下方「注册」。</div>`
          : `<div class="hint"><a href="#" id="link-forgot">忘记密码，或首次设置密码</a></div>`
      }
    </div>
    <button class="btn btn-primary btn-block" id="btn-pwd" type="button">登录</button>`;
}

/** 注册：邮箱验证码 + 昵称 + 密码，昵称必填并作为账号展示名写入 profiles */
function registerPane() {
  // 空库时没有 SMTP 可用，首个账号（主办方）免验证码
  const firstRun = LOCAL_MODE && Boolean(AUTH_CFG && AUTH_CFG.firstRun);
  return `
    <h2 style="margin-bottom:4px">创建账号</h2>
    <p class="small muted" style="margin-bottom:18px">${
      firstRun
        ? "当前是全新部署，注册的第一个账号将成为主办方。"
        : "先验证邮箱归属，再设置昵称与密码。昵称会展示在队伍、作品与证书上。"
    }</p>
    <div class="field">
      <label class="req">邮箱</label>
      <input type="email" id="f-email-r" placeholder="you@example.com" autocomplete="email" />
    </div>
    ${
      LOCAL_MODE && !firstRun
        ? `<div class="field">
             <label class="req">邮箱验证码</label>
             <div class="row">
               <input type="text" id="f-code-r" placeholder="6 位验证码" class="grow" inputmode="numeric" autocomplete="one-time-code" />
               <button class="btn" id="btn-send-r" type="button">获取验证码</button>
             </div>
             <div class="hint">发送到上面的邮箱，10 分钟内有效</div>
           </div>`
        : firstRun
        ? `<div class="hint" style="margin:-4px 0 16px">首个账号无需验证码；配置 SMTP 之后，后续注册都需要邮箱验证。</div>`
        : ""
    }
    <div class="field">
      <label class="req">昵称</label>
      <input type="text" id="f-name-r" maxlength="20" placeholder="展示给其他参赛者的昵称" autocomplete="nickname" />
      <div class="hint">2–20 个字，建议用常用昵称；注册后可在「我的」里修改。</div>
    </div>
    <div class="field">
      <label class="req">密码</label>
      <input type="password" id="f-password-r" placeholder="至少 8 位，含字母和数字" autocomplete="new-password" />
    </div>
    <button class="btn btn-primary btn-block" id="btn-register" type="button">注册</button>
    <p class="tiny dim center" style="margin-top:14px">已有账号？<a href="#" id="link-login-back">直接登录</a></p>`;
}

function resetPane() {
  const step2 = !!resetCtx;
  return `
    <button class="btn btn-ghost btn-sm" id="link-back" style="margin-bottom:16px">← 返回登录</button>
    <h2 style="margin-bottom:6px">${step2 ? "设置新密码" : "重置 / 设置密码"}</h2>
    <p class="small muted" style="margin-bottom:18px">${
      step2
        ? `验证码已发送至 <span class="mono tiny">${esc(resetCtx.email)}</span>`
        : "向邮箱发送验证码，验证通过后即可设置新密码。首次设置密码也走这里。"
    }</p>
    ${
      step2
        ? `
      <div class="field">
        <label class="req">验证码</label>
        <input type="text" id="f-r-code" placeholder="6 位验证码" inputmode="numeric" autocomplete="one-time-code" />
      </div>
      <div class="field">
        <label class="req">新密码</label>
        <input type="password" id="f-r-pwd" placeholder="至少 8 位，含字母和数字" autocomplete="new-password" />
      </div>
      <div class="field">
        <label class="req">确认新密码</label>
        <input type="password" id="f-r-pwd2" placeholder="再输一次" autocomplete="new-password" />
      </div>
      <button class="btn btn-primary btn-block" id="btn-reset-set" type="button">设置并登录</button>`
        : `
      <div class="field">
        <label class="req">邮箱</label>
        <input type="email" id="f-r-email" placeholder="you@example.com" autocomplete="email" />
      </div>
      <button class="btn btn-primary btn-block" id="btn-reset-send" type="button">发送验证码</button>`
    }`;
}

export async function loginView(el) {
  const cfg = await loadAuthCfg();
  const allowOtp = !LOCAL_MODE || Boolean(cfg.otp);
  // 只在没有验证码入口时把 otp 降级为密码登录；register / reset 不能被覆盖
  if (!allowOtp && loginMode === "otp") loginMode = "pwd";

  // 登录页说明由后台「内容 → 登录页说明」维护；读不到时用内置兜底
  let noteHtml = "";
  try {
    const doc = await getDocument("login");
    if (doc && doc.body && doc.body.trim()) noteHtml = renderDoc(doc.body).html;
  } catch (_) {}
  if (!noteHtml) noteHtml = `<p>${esc(DEFAULT_LOGIN_NOTE)}</p>`;

  const cnkdOn = !LOCAL_MODE || Boolean(cfg.cnkd && cfg.cnkd.enabled);
  const showThirdParty = cnkdOn || !LOCAL_MODE;

  el.innerHTML = shell(`
    <div class="auth-wrap">
      <div class="card">
        ${
          resetCtx || loginMode === "reset"
            ? resetPane()
            : loginMode === "register"
            ? registerPane()
            : `
          ${
            LOCAL_MODE && !allowOtp
              ? `<div class="auth-tabs"><button class="on" type="button">邮箱密码登录</button></div>
                 ${pwdPane()}
                 <p class="tiny dim center" style="margin-top:14px">还没有账号？<a href="#" id="link-register">注册</a></p>`
              : `<div class="auth-tabs">
                   <button class="${loginMode === "otp" ? "on" : ""}" data-mode="otp" type="button">验证码登录</button>
                   <button class="${loginMode === "pwd" ? "on" : ""}" data-mode="pwd" type="button">密码登录</button>
                 </div>
                 ${loginMode === "otp" ? otpPane() : pwdPane()}
                 <p class="tiny dim center" style="margin-top:14px">还没有账号？<a href="#" id="link-register">注册</a></p>`
          }
          ${
            showThirdParty
              ? `<div class="row" style="margin:20px 0 16px;gap:12px">
                   <span style="flex:1;height:1px;background:var(--line)"></span>
                   <span class="tiny dim">或</span>
                   <span style="flex:1;height:1px;background:var(--line)"></span>
                 </div>
                 ${cnkdOn ? `<button class="btn btn-block" id="btn-cnkd" type="button">CNKD 一证通行</button>` : ""}
                 ${LOCAL_MODE ? "" : `<button class="btn btn-block" id="btn-wechat" type="button" style="margin-top:9px">微信扫码登录</button>`}`
              : ""
          }
        `
        }
      </div>
      <div class="auth-note">${noteHtml}</div>
      <p class="tiny dim center" style="margin-top:14px">登录即表示同意活动规则与隐私说明</p>
    </div>
  `);
  bindShell();
  wireLogin(el);
}

/** 发送冷却：自己维护文案与禁用态，别和 busy() 抢 dataset.label */
function startCooldown(btn, seconds = 60) {
  if (!btn) return;
  if (!btn.dataset.label) btn.dataset.label = "获取验证码";
  btn.disabled = true;
  let left = seconds;
  btn.textContent = `${left}s 后重发`;
  const tick = setInterval(() => {
    left -= 1;
    if (left > 0) {
      btn.textContent = `${left}s 后重发`;
    } else {
      clearInterval(tick);
      btn.textContent = "重新获取";
      btn.disabled = false;
      delete btn.dataset.label;
    }
  }, 1000);
}

async function sendCode(btn, email) {
  busy(btn, true, "验证中…");
  let counting = false;
  try {
    // 用登录页已经取到的配置：未开启人机验证时零请求直接放行
    const gate = await verifyCaptcha(AUTH_CFG && AUTH_CFG.captcha);
    if (!gate.ok) {
      if (gate.reason) toast(gate.reason, "err");
      return null;
    }
    busy(btn, true, "发送中…");
    const sent = await cloud.auth.sendOtp({ email });
    if (sent.error) throw sent.error;
    toast("验证码已发送，请查收邮箱", "ok");
    counting = true;
    startCooldown(btn);
    return { email, verificationId: sent.data.verificationId, isExistingUser: sent.data.isExistingUser };
  } catch (e) {
    toast(errMsg(e, "验证码发送失败"), "err");
    return null;
  } finally {
    // 进入冷却时按钮交给 startCooldown 管，别在这里恢复成可点
    if (!counting) busy(btn, false);
  }
}

async function afterLogin(message = "登录成功") {
  const { loadSession } = await import("./core.js");
  await loadSession();
  await loadMe(true);
  toast(message, "ok");
  navigate("/me");
}

/**
 * 本地模式服务端在创建账号时已写入昵称；云端模式不接受 name 参数，
 * 这里补写一次。昵称已经一致时不会发请求。
 */
async function syncNickname(name) {
  try {
    const uid = state.session?.user?.id || state.session?.user?.uid;
    if (!uid || !state.me) return;
    if ((state.me.nickname || "") === name) return;
    await db.from("profiles").update({ nickname: name }).eq("owner_id", uid);
    await loadMe(true);
  } catch (_) {}
}

function wireLogin(el) {
  el.querySelectorAll("[data-mode]").forEach((b) => {
    b.onclick = () => {
      loginMode = b.dataset.mode;
      loginView(el);
    };
  });

  const back = el.querySelector("#link-back");
  if (back) {
    back.onclick = (e) => {
      e.preventDefault();
      resetCtx = null;
      loginMode = "pwd";
      loginView(el);
    };
  }

  const toRegister = el.querySelector("#link-register");
  if (toRegister) {
    toRegister.onclick = (e) => {
      e.preventDefault();
      pendingOtp = null; // 换页清空，避免沿用上一轮验证码
      loginMode = "register";
      loginView(el);
    };
  }

  const toLogin = el.querySelector("#link-login-back");
  if (toLogin) {
    toLogin.onclick = (e) => {
      e.preventDefault();
      loginMode = !LOCAL_MODE || (AUTH_CFG && AUTH_CFG.otp) ? "otp" : "pwd";
      loginView(el);
    };
  }

  /* ---- 验证码登录 ---- */
  if (loginMode === "otp") {
    const emailEl = el.querySelector("#f-email");
    const codeEl = el.querySelector("#f-code");
    const sendBtn = el.querySelector("#btn-send");
    const loginBtn = el.querySelector("#btn-otp");
    const nameWrap = el.querySelector("#otp-name-wrap");
    const nameEl = el.querySelector("#f-name-o");

    sendBtn.onclick = async () => {
      const email = emailEl.value.trim();
      if (!EMAIL_RE.test(email)) return toast("请输入正确的邮箱地址", "err");
      pendingOtp = await sendCode(sendBtn, email);
      if (!pendingOtp) return;
      // 先验证码后注册的场景：只有新账号才要求填昵称
      const isNew = pendingOtp.isExistingUser === false;
      if (nameWrap) nameWrap.style.display = isNew ? "" : "none";
      if (isNew && nameEl) nameEl.focus();
    };

    loginBtn.onclick = async () => {
      const email = emailEl.value.trim();
      const token = codeEl.value.trim();
      if (!pendingOtp || pendingOtp.email !== email) return toast("请先获取该邮箱的验证码", "err");
      if (!token) return toast("请输入验证码", "err");
      const isNew = pendingOtp.isExistingUser === false;
      const name = isNew ? (nameEl ? nameEl.value.trim() : "") : "";
      if (isNew && [...name].length < 2) {
        if (nameEl) nameEl.focus();
        return toast("首次登录请填写昵称，至少 2 个字", "err");
      }
      busy(loginBtn, true, "登录中…");
      try {
        const done = await cloud.auth.verifyOtp({
          email,
          verificationId: pendingOtp.verificationId,
          isExistingUser: pendingOtp.isExistingUser,
          token,
          name,
        });
        if (done.error) throw done.error;
        pendingOtp = null;
        await afterLogin(isNew ? "注册成功" : "登录成功");
      } catch (e) {
        toast(errMsg(e, "验证码错误或已过期"), "err");
        busy(loginBtn, false);
      }
    };
  }

  /* ---- 密码登录 ---- */
  if (loginMode === "pwd") {
    const emailEl = el.querySelector("#f-email-p");
    const pwdEl = el.querySelector("#f-password");
    const btn = el.querySelector("#btn-pwd");
    const forgot = el.querySelector("#link-forgot");

    btn.onclick = async () => {
      const email = emailEl.value.trim();
      const password = pwdEl.value;
      if (!EMAIL_RE.test(email)) return toast("请输入正确的邮箱地址", "err");
      if (!password) return toast("请输入密码", "err");
      busy(btn, true, "登录中…");
      try {
        const res = await cloud.auth.signInWithPassword({ email, password });
        if (res.error) throw res.error;
        await afterLogin();
      } catch (e) {
        toast("邮箱或密码错误", "err");
        busy(btn, false);
      }
    };

    pwdEl.onkeydown = (e) => {
      if (e.key === "Enter") btn.click();
    };

    if (forgot) {
      forgot.onclick = (e) => {
        e.preventDefault();
        resetCtx = null;
        loginMode = "reset";
        loginView(el);
      };
    }
  }

  /* ---- 注册（邮箱验证码 + 昵称 + 密码） ---- */
  if (loginMode === "register") {
    const emailEl = el.querySelector("#f-email-r");
    const codeEl = el.querySelector("#f-code-r");
    const nameEl = el.querySelector("#f-name-r");
    const pwdEl = el.querySelector("#f-password-r");
    const sendBtn = el.querySelector("#btn-send-r");
    const btn = el.querySelector("#btn-register");

    if (sendBtn) {
      sendBtn.onclick = async () => {
        const email = emailEl.value.trim();
        if (!EMAIL_RE.test(email)) return toast("请输入正确的邮箱地址", "err");
        pendingOtp = await sendCode(sendBtn, email);
        if (pendingOtp && pendingOtp.isExistingUser) {
          toast("该邮箱已注册，请直接登录", "err");
        }
      };
    }

    btn.onclick = async () => {
      const email = emailEl.value.trim();
      const code = codeEl ? codeEl.value.trim() : "";
      const name = nameEl.value.trim();
      const password = pwdEl.value;

      if (!EMAIL_RE.test(email)) return toast("请输入正确的邮箱地址", "err");
      const needCode = LOCAL_MODE && !(AUTH_CFG && AUTH_CFG.firstRun);
      if (needCode) {
        if (!pendingOtp || pendingOtp.email !== email) {
          return toast("请先获取该邮箱的验证码", "err");
        }
        if (!code) return toast("请输入邮箱验证码", "err");
      }
      if ([...name].length < 2) return toast("请填写昵称，至少 2 个字", "err");
      if ([...name].length > 20) return toast("昵称不能超过 20 个字", "err");
      if (!pwdOk(password)) return toast("密码至少 8 位，且同时包含字母和数字", "err");

      busy(btn, true, "注册中…");
      try {
        if (needCode) {
          const res = await cloud.auth.register({
            email,
            password,
            name,
            code,
            verificationId: pendingOtp.verificationId,
          });
          if (res.error) throw res.error;
          pendingOtp = null;
        } else if (LOCAL_MODE) {
          // 首个账号：无需验证码，直接创建
          const res = await cloud.auth.register({ email, password, name, code: "", verificationId: "" });
          if (res.error) throw res.error;
        } else {
          const res = await cloud.auth.signInWithPassword({ email, password, name });
          if (res.error) throw res.error;
          // 云端模式拿不到 isNew，退回用昵称补写兜底
          if (res.data && res.data.isNew === false) {
            toast("该邮箱已注册，请直接登录", "err");
            busy(btn, false);
            return;
          }
        }
        await afterLogin("注册成功");
        syncNickname(name);
      } catch (e) {
        toast(errMsg(e, "注册失败，请稍后重试"), "err");
        busy(btn, false);
      }
    };

    const fields = codeEl ? [emailEl, codeEl, nameEl, pwdEl] : [emailEl, nameEl, pwdEl];
    fields.forEach((input, i) => {
      input.onkeydown = (e) => {
        if (e.key !== "Enter") return;
        if (i < fields.length - 1) fields[i + 1].focus();
        else btn.click();
      };
    });
  }

  /* ---- 重置 / 设置密码 ---- */
  if (loginMode === "reset" || resetCtx) {
    const sendBtn = el.querySelector("#btn-reset-send");
    if (sendBtn) {
      const emailEl = el.querySelector("#f-r-email");
      sendBtn.onclick = async () => {
        const email = emailEl.value.trim();
        if (!EMAIL_RE.test(email)) return toast("请输入正确的邮箱地址", "err");
        busy(sendBtn, true, "验证中…");
        try {
          const gate = await verifyCaptcha(AUTH_CFG && AUTH_CFG.captcha);
          if (!gate.ok) {
            if (gate.reason) toast(gate.reason, "err");
            return;
          }
          busy(sendBtn, true, "发送中…");
          const started = await cloud.auth.resetPasswordForEmail(email);
          if (started.error) throw started.error;
          resetCtx = { email, handle: started.data };
          toast("验证码已发送", "ok");
          loginView(el);
        } catch (e) {
          toast(errMsg(e, "发送失败，请确认邮箱是否已注册"), "err");
        } finally {
          busy(sendBtn, false);
        }
      };
    }

    const setBtn = el.querySelector("#btn-reset-set");
    if (setBtn) {
      setBtn.onclick = async () => {
        const code = el.querySelector("#f-r-code").value.trim();
        const p1 = el.querySelector("#f-r-pwd").value;
        const p2 = el.querySelector("#f-r-pwd2").value;
        if (!code) return toast("请输入验证码", "err");
        if (!pwdOk(p1)) return toast("密码至少 8 位，且需同时包含字母和数字", "err");
        if (p1 !== p2) return toast("两次输入的密码不一致", "err");
        busy(setBtn, true, "设置中…");
        try {
          const done = await resetCtx.handle.updateUser({ nonce: code, password: p1 });
          if (done.error) throw done.error;
          resetCtx = null;
          loginMode = "otp";
          await afterLogin();
        } catch (e) {
          toast(errMsg(e, "验证码错误或已过期"), "err");
          busy(setBtn, false);
        }
      };
    }
  }

  /* ---- 第三方 ---- */
  const cnkdBtn = el.querySelector("#btn-cnkd");
  if (cnkdBtn) {
    cnkdConfig().then((c) => {
      if (c.enabled) {
        cnkdBtn.onclick = () => startCnkdLogin();
      } else {
        cnkdBtn.disabled = true;
        cnkdBtn.textContent = "CNKD 一证通行（待接入）";
        cnkdBtn.title = "尚未配置 CNKD 客户端 ID";
      }
    });
  }

  const wechatBtn = el.querySelector("#btn-wechat");
  if (wechatBtn) {
    wechatBtn.onclick = async () => {
      try {
        const { data, error } = await cloud.auth.signInWithOAuth({ provider: "wechat", redirectTo: location.origin });
        if (error) throw error;
        location.assign(data.url);
      } catch (e) {
        toast(errMsg(e, "微信登录暂不可用"), "err");
      }
    };
  }
}

/* ---------------------------- 作品与结果 ---------------------------- */

export async function resultsView(el) {
  let subs = [];
  let reviews = [];
  try {
    subs = (await allSubmissions()).filter((s) => s.status === "public");
  } catch (e) {
    subs = [];
  }
  try {
    reviews = await allReviews();
  } catch (_) {}
  const ranked = rankSubmissions(subs, reviews);
  const groups = TRACKS.map((t) => ({ ...t, rows: ranked.filter((r) => r.sub.track === t.code) }));

  el.innerHTML = shell(`
    <div class="block-head"><h2>作品与结果</h2><span class="card-note">共 ${subs.length} 件已公示作品</span></div>
    ${
      !subs.length
        ? `<div class="empty">
             <p style="margin-bottom:6px">还没有已公示的作品</p>
             <p class="tiny">提交截止后统一公开，此前作品仅本队与评委可见</p>
           </div>`
        : groups.map((g) => `
          <div class="block">
            <div class="row-between" style="margin-bottom:12px">
              <div class="row">
                <span class="tag ${g.side === "mc" ? "tag-blue" : "tag-amber"}">赛道 ${g.code}</span>
                <span class="strong">${esc(g.name)}</span>
              </div>
              <span class="card-note">${g.rows.length} 件</span>
            </div>
            <div class="grid grid-2">
              ${g.rows.map((r) => `
                <div class="card">
                  <div class="row-between" style="margin-bottom:8px">
                    <a class="strong" style="font-size:15px" href="#/works/${r.sub.id}">${esc(r.sub.title)}</a>
                    ${r.judgeCount ? `<span class="tag ${r.qualified ? "tag-teal" : "tag-red"}">${r.avg} 分</span>` : ""}
                  </div>
                  <p class="small muted" style="margin-bottom:12px">${esc(r.sub.summary || "")}</p>
                  <div class="row row-wrap" style="gap:6px">
                    <span class="tag">${esc(r.sub.owner_name || "匿名队伍")}</span>
                    ${r.judgeCount ? `<span class="tag">${r.judgeCount} 位评委</span>` : ""}
                  </div>
                </div>`).join("")}
            </div>
          </div>`).join("")
    }
  `);
  bindShell();
}

/* ---------------------------- 参赛作品 ---------------------------- */

/** 由作品标题生成一张确定性的像素色块，用作卡片封面 */
function pixelBanner(seed) {
  const s = String(seed);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const cells = [];
  for (let i = 0; i < 60; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const v = (h >>> 0) % 100;
    if (v < 44) {
      cells.push(
        `<rect x="${i % 12}" y="${Math.floor(i / 12)}" width="1" height="1" opacity="${(
          0.14 + (v % 34) / 100
        ).toFixed(2)}" />`
      );
    }
  }
  return `<svg class="work-pixels" viewBox="0 0 12 5" preserveAspectRatio="none" aria-hidden="true">${cells.join(
    ""
  )}</svg>`;
}

const workDate = (w) => fmtDate(w.created_at);

export async function worksView(el, path) {
  const qp = new URLSearchParams((path || "").split("?")[1] || "");
  const track = (qp.get("track") || "").toUpperCase();

  let all = [];
  try {
    all = await publicWorks();
  } catch (_) {}

  const rows = track ? all.filter((w) => w.track === track) : all;
  const counts = TRACKS.map((t) => ({ ...t, n: all.filter((w) => w.track === t.code).length })).filter(
    (t) => t.n > 0
  );

  const chip = (code, label, n) => `
    <a class="wk-chip ${track === code ? "on" : ""}" href="#/works${code ? "?track=" + code : ""}">
      ${esc(label)}<b>${n}</b>
    </a>`;

  el.innerHTML = shell(`
    <div class="block-head">
      <h2>参赛作品</h2>
      <span class="card-note">共 ${all.length} 件已公示</span>
    </div>

    ${
      !all.length
        ? `<div class="empty">
             <p style="margin-bottom:6px">还没有已公示的作品</p>
             <p class="tiny">提交截止后由主办方统一公示；在此之前作品仅本队与评委可见。</p>
           </div>`
        : `<div class="wk-bar">
             <div class="row row-wrap" style="gap:6px">
               ${chip("", "全部", all.length)}
               ${counts.map((t) => chip(t.code, `赛道 ${t.code} · ${t.name}`, t.n)).join("")}
             </div>
             <input type="search" id="wk-q" class="wk-search" placeholder="搜索作品名、队伍或简介" />
           </div>
           <div class="grid grid-auto" id="wk-grid">
             ${rows
               .map(
                 (w) => `
               <a class="work-card track-${esc(w.track)}" href="#/works/${w.id}"
                  data-text="${esc(`${w.title} ${w.summary || ""} ${w.owner_name || ""}`.toLowerCase())}">
                 <div class="work-cover">
                   ${pixelBanner(`${w.id}-${w.title}`)}
                   <span class="work-code">${esc(w.track)}</span>
                 </div>
                 <div class="work-body">
                   <div class="row-between" style="margin-bottom:7px">
                     <span class="tag ${w.track === "A" || w.track === "B" ? "tag-blue" : "tag-amber"}">${esc(
                   trackOf(w.track).name
                 )}</span>
                     <span class="tiny dim">${esc(workDate(w))}</span>
                   </div>
                   <h3 class="work-title">${esc(w.title)}</h3>
                   <p class="work-sum">${esc(w.summary || "")}</p>
                   <div class="work-foot">
                     <span class="tiny dim">${esc(w.owner_name || "匿名队伍")}</span>
                     <span class="tiny">详情 →</span>
                   </div>
                 </div>
               </a>`
               )
               .join("")}
           </div>
           <div class="empty" id="wk-none" style="display:none">
             <p>${track ? "该赛道没有匹配的作品" : "没有匹配的作品"}</p>
           </div>`
    }
  `);
  bindShell();

  const q = el.querySelector("#wk-q");
  if (q) {
    const cards = [...el.querySelectorAll(".work-card")];
    const none = el.querySelector("#wk-none");
    q.oninput = () => {
      const kw = q.value.trim().toLowerCase();
      let shown = 0;
      for (const c of cards) {
        const hit = !kw || c.dataset.text.includes(kw);
        c.style.display = hit ? "" : "none";
        if (hit) shown++;
      }
      none.style.display = shown ? "none" : "";
      none.querySelector("p").textContent = rows.length && !shown ? "没有匹配的作品" : "该赛道没有匹配的作品";
    };
  }
}

export async function workDetailView(el, path) {
  const id = Number(((path || "").split("?")[0].split("/")[2] || "").replace(/\D/g, ""));
  let w = null;
  try {
    w = await publicWork(id);
  } catch (_) {}

  if (!w) {
    el.innerHTML = shell(`
      <div class="empty" style="max-width:520px;margin:70px auto">
        <p style="margin-bottom:6px">没有找到这件作品</p>
        <p class="tiny">它可能尚未公示，或已被撤回。</p>
        <a class="btn btn-sm" href="#/works" style="margin-top:14px">返回作品列表</a>
      </div>`);
    bindShell();
    return;
  }

  const d = w.detail || {};
  const l = w.links || {};
  const t = trackOf(w.track);
  const sections = [
    ["创意来源", d.origin],
    ["核心玩法", d.gameplay],
    ["技术实现", d.tech],
    ["亮点", d.highlight],
    ["安装说明", d.install],
    ["依赖与许可证", d.license],
    ["已知问题", d.known],
  ].filter(([, v]) => v && String(v).trim());

  const scanBadge = (() => {
    const sc = w.scan;
    if (!sc || sc.enabled === false) return "";
    const map = {
      clean: ["tag-teal", "未检出威胁"],
      malicious: ["tag-red", "检出恶意"],
      suspicious: ["tag-amber", "有可疑项"],
      notfound: ["tag", "未被收录"],
      ratelimited: ["tag-amber", "查询受限"],
      unavailable: ["tag", "查询失败"],
      unauthorized: ["tag-red", "密钥无效"],
      unknown: ["tag", "结果未知"],
    };
    const [cls, label] = map[sc.status] || ["tag", sc.status || "未知"];
    return `<span class="${cls}">${esc(label)}</span>`;
  })();

  el.innerHTML = shell(`
    <div class="block-head" style="align-items:flex-start">
      <div style="min-width:0">
        <a href="#/works" class="tiny dim">← 参赛作品</a>
        <h2 style="margin:8px 0 6px">${esc(w.title)}</h2>
        <p class="small muted" style="margin:0;max-width:62ch">${esc(w.summary || "")}</p>
      </div>
      <span class="tag ${w.track === "A" || w.track === "B" ? "tag-blue" : "tag-amber"}" style="flex:0 0 auto">
        赛道 ${esc(w.track)} · ${esc(t.name)}
      </span>
    </div>

    <div class="work-split">
      <article class="col" style="gap:16px">
        ${
          sections.length
            ? sections
                .map(
                  ([k, v]) => `
              <div class="card">
                <div class="card-head"><h2>${esc(k)}</h2></div>
                <p class="small" style="white-space:pre-wrap;margin:0;line-height:1.85">${esc(v)}</p>
              </div>`
                )
                .join("")
            : `<div class="card"><div class="empty" style="padding:28px">该队伍没有填写项目说明</div></div>`
        }
      </article>

      <aside class="col" style="gap:14px">
        <div class="card">
          <div class="card-head"><h2>作品信息</h2></div>
          <div class="kv"><span>队伍</span><b>${esc(w.owner_name || "匿名队伍")}</b></div>
          <div class="kv"><span>游戏</span><b>${esc(t.game || "—")}</b></div>
          <div class="kv"><span>类型</span><b>${esc(t.type || "—")}</b></div>
          <div class="kv"><span>提交版本</span><b class="mono">v${esc(w.version_no)}</b></div>
          <div class="kv"><span>公示时间</span><b>${esc(workDate(w))}</b></div>
          ${w.pkg_size ? `<div class="kv"><span>包体大小</span><b class="mono">${esc(w.pkg_size)}</b></div>` : ""}
          ${
            w.pkg_sha256
              ? `<div class="kv col-kv"><span>SHA-256</span><b class="mono tiny dim" style="word-break:break-all">${esc(
                  w.pkg_sha256
                )}</b></div>`
              : ""
          }
          ${scanBadge ? `<div class="row" style="margin-top:10px">${scanBadge}</div>` : ""}
        </div>

        <div class="card">
          <div class="card-head"><h2>获取作品</h2></div>
          ${
            w.shared_path
              ? `<button class="btn btn-primary btn-block" id="btn-dl">下载作品包</button>
                 <p class="tiny dim" style="margin:8px 0 0">下载链接 1 小时内有效。</p>`
              : `<p class="tiny dim" style="margin:0">队伍尚未发布作品包。</p>`
          }
          ${
            l.video
              ? `<a class="btn btn-block" href="${esc(l.video)}" target="_blank" rel="noopener noreferrer" style="margin-top:8px">观看演示视频</a>`
              : ""
          }
          ${
            l.repo
              ? `<a class="btn btn-ghost btn-block" href="${esc(l.repo)}" target="_blank" rel="noopener noreferrer" style="margin-top:8px">源码仓库</a>`
              : ""
          }
          <div class="row row-wrap" style="gap:8px;margin-top:12px">
            <button class="btn btn-sm" id="btn-copy">复制链接</button>
            <a class="btn btn-sm" href="#/works">回到列表</a>
          </div>
        </div>
      </aside>
    </div>
  `);
  bindShell();

  const dl = el.querySelector("#btn-dl");
  if (dl) {
    if (!state.session) {
      dl.textContent = "登录后下载";
      dl.onclick = () => navigate("/login");
    } else {
      dl.onclick = async () => {
        busy(dl, true, "生成链接…");
        try {
          const url = await signedDownload(w.shared_path, 3600);
          if (!url) throw new Error("无法生成下载链接");
          window.open(url, "_blank", "noopener");
          busy(dl, false);
        } catch (e) {
          toast(errMsg(e), "err");
          busy(dl, false);
        }
      };
    }
  }

  const cp = el.querySelector("#btn-copy");
  if (cp) {
    cp.onclick = async () => {
      const url = `${location.origin}${location.pathname}#/works/${w.id}`;
      try {
        await navigator.clipboard.writeText(url);
        toast("链接已复制", "ok");
      } catch (_) {
        toast(url, "ok");
      }
    };
  }
}

/* ---------------------------- 评委团队 ---------------------------- */

function judgeTrackList(j) {
  const codes = String(j.tracks || "")
    .split(/[,，、\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return TRACKS.filter((t) => codes.includes(t.code));
}

function judgeMonogram(j) {
  const s = String(j.name || "").trim();
  if (!s) return "·";
  if (/^[\x00-\x7F]+$/.test(s)) {
    return s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  }
  return s.slice(0, 1);
}

function judgeCard(j) {
  const ts = judgeTrackList(j);
  return `
    <div class="judge-card">
      <div class="judge-ava">
        ${j.avatar_url ? `<img src="${esc(j.avatar_url)}" alt="" loading="lazy" />` : `<b>${esc(judgeMonogram(j))}</b>`}
      </div>
      <div class="judge-name">${esc(j.name)}</div>
      <div class="judge-role">${esc([j.title, j.org].filter(Boolean).join(" · ") || "评委")}</div>
      ${j.bio ? `<p class="judge-bio">${esc(j.bio)}</p>` : ""}
      ${
        ts.length
          ? `<div class="row row-wrap" style="gap:5px;margin-top:auto">
               ${ts.map((t) => `<span class="tag ${t.side === "mc" ? "tag-blue" : "tag-amber"}">${esc(t.code)} · ${esc(t.name)}</span>`).join("")}
             </div>`
          : ""
      }
    </div>`;
}

export async function judgesView(el) {
  let judges = [];
  try {
    judges = await listJudgesPublic();
  } catch (_) {}

  const doc = JUDGE_DOC;
  const text = judgePlainText(doc);
  const hash = await sha256Hex(text);
  let ack = null;
  if (state.session && isStaff()) ack = await getJudgeAck(doc).catch(() => null);

  el.innerHTML = shell(`
    <div class="block-head"><h2>评委团队</h2><span class="card-note">${judges.length} 位</span></div>

    <div class="card block">
      <p class="small muted" style="margin:0 0 10px;max-width:72ch">
        评审按赛道分组进行：A、B 两条《我的世界》赛道与 C、D 两条《铁锈战争》赛道各自独立打分，
        跨赛道不直接比较。每位评委只看得到分配给自己的作品，独立打分、独立写评语，互不协商。
      </p>
      <p class="small dim" style="margin:0;max-width:72ch">
        3 位评委取平均；5 位及以上去掉一个最高分与一个最低分后取平均。总分低于 60 分不授予等级奖。
      </p>
    </div>

    ${
      judges.length
        ? `<div class="grid grid-3 block">${judges.map(judgeCard).join("")}</div>`
        : `<div class="empty block">
             <p style="margin-bottom:6px">评委名单尚未公布</p>
             <p class="tiny">名单由主办方在评审开始前录入。</p>
           </div>`
    }

    <div class="block" id="judge-code">
      <div class="block-head">
        <h2>${esc(doc.title)}</h2>
        <span class="card-note">${esc(doc.version)} · ${esc(String(hash).slice(0, 12))}</span>
      </div>
      <div class="card">
        <p class="small muted" style="margin-bottom:16px">${esc(doc.preamble)}</p>
        <ol class="code-list">
          ${doc.items
            .map(
              (t, i) =>
                `<li><span class="mono tiny dim">${String(i + 1).padStart(2, "0")}</span><span>${esc(t)}</span></li>`
            )
            .join("")}
        </ol>
        <div class="divider"></div>
        <p class="tiny dim" style="margin:0 0 14px">${esc(doc.footer)}</p>

        ${
          ack
            ? `<div class="row" style="gap:10px">
                 <span class="tag tag-teal">已签署</span>
                 <span class="tiny dim">${esc(fmtFull(ack.created_at))} · 署名 ${esc(ack.agreed_name)}</span>
               </div>`
            : isStaff() && state.session
            ? `<div class="field">
                 <label class="row" style="gap:9px;cursor:pointer;align-items:flex-start">
                   <input type="checkbox" id="jc-agree" style="margin-top:3px" />
                   <span class="small">我已逐条阅读并同意上述条款，愿意承担相应责任。</span>
                 </label>
               </div>
               <button class="btn btn-primary" id="btn-sign-code" disabled>签署评委公约</button>
               <p class="tiny dim" style="margin-top:10px">未签署公约时，评审页的打分入口会被锁定。</p>`
            : `<p class="tiny dim" style="margin:0">评委需登录并签署本公约后方可打分。</p>`
        }
      </div>
    </div>
  `);
  bindShell();

  const agree = el.querySelector("#jc-agree");
  const btn = el.querySelector("#btn-sign-code");
  if (agree && btn) {
    agree.onchange = () => {
      btn.disabled = !agree.checked;
    };
    btn.onclick = async () => {
      busy(btn, true, "签署中…");
      try {
        await signJudgeCode({ hash, name: state.me?.nickname || "评委" }, doc);
        toast("已签署，可以开始评审", "ok");
        judgesView(el);
      } catch (e) {
        toast(errMsg(e), "err");
        busy(btn, false);
      }
    };
  }
}

/* ---------------------------- 公告 ---------------------------- */

export async function noticesView(el) {
  let list = [];
  try {
    list = await listAnnouncements();
  } catch (_) {}
  el.innerHTML = shell(`
    <div class="block-head"><h2>公告</h2><span class="card-note">${list.length} 条</span></div>
    ${list.length
      ? `<div class="card">${list.map((n) => `
          <div class="notice-item">
            <div class="row-between" style="margin-bottom:4px">
              <div class="notice-title">${n.pinned ? '<span class="tag tag-amber" style="margin-right:6px">置顶</span>' : ""}${esc(n.title)}</div>
              <span class="notice-meta">${esc(fmtDate(n.created_at))}</span>
            </div>
            <p class="small muted" style="white-space:pre-wrap;margin:0">${esc(n.body || "")}</p>
          </div>`).join("")}</div>`
      : `<div class="empty">暂无公告</div>`}
  `);
  bindShell();
}

/* ---------------------------- CNKD 身份 ---------------------------- */

export async function cnkdView(el, path) {
  const qs = (path || "").split("?")[1] || "";
  const q = new URLSearchParams(qs);
  const ticket = q.get("ticket");
  const err = q.get("error");
  const clean = () => history.replaceState(null, "", "#/cnkd");

  if (err) {
    clean();
    el.innerHTML = shell(`
      <div class="auth-wrap">
        <div class="card center">
          <h2 style="margin-bottom:8px">CNKD 登录未完成</h2>
          <p class="small muted">${esc(err)}</p>
          <a class="btn btn-primary btn-block" href="#/login" style="margin-top:16px">返回登录</a>
        </div>
      </div>`);
    bindShell();
    return;
  }

  if (!ticket) {
    const c = await cnkdConfig();
    el.innerHTML = shell(`
      <div class="auth-wrap">
        <div class="card">
          <h2 style="margin-bottom:10px">CNKD 一证通行</h2>
          <p class="small muted">用 CNKD 账号完成一次身份核验，并把 <span class="mono tiny">${esc(c.scope || "profile.basic")}</span> 范围内的资料绑定到本站账号。</p>
          <div class="divider"></div>
          <p class="small muted" style="margin-bottom:14px">这不是替代登录：本站的报名、组队与作品数据由站内账号承载，CNKD 负责确认「你是 CNKD 生态里的哪个人」。</p>
          ${c.enabled
            ? `<button class="btn btn-primary btn-block" id="btn-cnkd-go">开始 CNKD 身份核验</button>`
            : `<button class="btn btn-block" disabled>尚未配置客户端 ID</button>
               <p class="tiny dim" style="margin-top:10px">需要平台方发放 client_id 并登记回调地址。</p>`}
          <a class="btn btn-ghost btn-block" href="#/login" style="margin-top:9px">返回登录</a>
        </div>
      </div>`);
    bindShell();
    const go = el.querySelector("#btn-cnkd-go");
    if (go) go.onclick = () => startCnkdLogin();
    return;
  }

  let profile = null;
  let error = "";
  try {
    profile = await fetchCnkdTicket(ticket);
  } catch (e) {
    error = e.message;
  }
  clean();

  if (!profile) {
    el.innerHTML = shell(`
      <div class="auth-wrap">
        <div class="card center">
          <h2 style="margin-bottom:8px">身份核验失败</h2>
          <p class="small muted">${esc(error || "未知错误")}</p>
          <a class="btn btn-primary btn-block" href="#/cnkd" style="margin-top:16px">重新发起</a>
        </div>
      </div>`);
    bindShell();
    return;
  }

  await loadMe(true).catch(() => {});
  const me = state.me;
  const bound = me && me.cnkd_sub === profile.sub;
  const initials = (profile.displayName || profile.username || "C").slice(0, 1).toUpperCase();
  const avatar = profile.avatarUrl
    ? `<img src="${esc(profile.avatarUrl)}" alt="" style="width:48px;height:48px;border-radius:50%;object-fit:cover;border:1px solid var(--line-strong)" />`
    : `<div class="avatar" style="width:48px;height:48px;font-size:16px">${esc(initials)}</div>`;

  el.innerHTML = shell(`
    <div class="auth-wrap">
      <div class="card">
        <div class="row" style="gap:13px;margin-bottom:16px">
          ${avatar}
          <div style="min-width:0">
            <div class="strong" style="font-size:15px">${esc(profile.displayName || profile.username || "CNKD 用户")}</div>
            <div class="tiny dim mono">${esc(profile.username || "")}</div>
          </div>
          <span class="tag tag-teal" style="margin-left:auto">已核验</span>
        </div>
        <div class="tbl-wrap"><table class="tbl"><tbody>
          <tr><td class="small muted" style="width:96px">唯一标识</td><td class="mono tiny" style="word-break:break-all">${esc(profile.sub)}</td></tr>
          <tr><td class="small muted">账号状态</td><td class="small">${esc(profile.accountStatus || "—")}</td></tr>
          <tr><td class="small muted">风控</td><td class="small">${esc(profile.riskLevel || "—")}</td></tr>
        </tbody></table></div>
        <div class="divider"></div>
        ${
          !me
            ? `<p class="small muted" style="margin-bottom:12px">身份已确认，但还没有本站会话。请先用邮箱登录，再回到本页完成绑定。</p>
               <a class="btn btn-primary btn-block" href="#/login">去登录</a>`
            : bound
            ? `<p class="small" style="color:var(--accent);margin-bottom:12px">已绑定到当前账号（${esc(me.nickname || me.owner_name || "我")}）。</p>
               <a class="btn btn-block" href="#/me">回到我的</a>`
            : `<p class="small muted" style="margin-bottom:12px">把该 CNKD 身份绑定到当前账号（${esc(me.nickname || me.owner_name || "我")}）？绑定后可用于身份识别与申诉核验。</p>
               <button class="btn btn-primary btn-block" id="btn-bind">绑定到当前账号</button>`
        }
        <a class="btn btn-ghost btn-block" href="#/home" style="margin-top:9px">返回首页</a>
      </div>
    </div>`);
  bindShell();

  const bindBtn = el.querySelector("#btn-bind");
  if (bindBtn) {
    bindBtn.onclick = async () => {
      busy(bindBtn, true, "绑定中…");
      try {
        const rows = unwrap(
          await db.from("profiles").update({ cnkd_sub: profile.sub }).eq("owner_id", me.owner_id).select()
        );
        if (!rows || !rows.length) throw new Error("绑定失败：没有权限修改该账号");
        await loadMe(true);
        toast("已绑定 CNKD 账号", "ok");
        cnkdView(el, "/cnkd");
      } catch (e) {
        toast(e?.code === "23505" ? "该 CNKD 账号已绑定到其他本站账号" : errMsg(e), "err");
        busy(bindBtn, false);
      }
    };
  }
}
