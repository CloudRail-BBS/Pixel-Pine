import {
  cloud, state, shell, bindShell, navigate, toast, esc, fmtDate, fmtFull, timeLeft, ago,
  loadMe, loadSession, loadActivity, requireLogin, busy, errMsg, db, unwrap, renderDoc, isStaff, sha256Hex, emptyState,
} from "./core.js";
import {
  TRACKS, trackOf, DIMENSIONS, DEFAULT_ACTIVITY, PARTNER_ROLES, JUDGE_DOC, judgePlainText,
} from "./config.js";
import {
  allSubmissions, listAnnouncements, rankSubmissions, rankByPublicScores, publicScores,
  allReviews, trackCounts, awardPlan,
  getDocument, listPartners, listSponsors, publicWorks, publicWork, getIntro,
  listJudgesPublic, getJudgeAck, signJudgeCode,
} from "./api.js";
import { verifyCaptcha } from "./geetest.js";
import { cnkdConfig, startCnkdLogin } from "./cnkd.js";
import { setSeo } from "./seo.js";
import { FAQS } from "./faq.js";
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
    subs = await publicWorks();
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

  const cdMs = cd.over ? 0 : cd.ms;
  const cdD = Math.floor(cdMs / 86400000);
  const cdH = Math.floor((cdMs % 86400000) / 3600000);
  const cdM = Math.floor((cdMs % 3600000) / 60000);
  const pad2 = (n) => String(n).padStart(2, "0");
  const maxWeight = Math.max(...DIMENSIONS.map((d) => d.weight));
  const totalWeight = DIMENSIONS.reduce((n, d) => n + d.weight, 0);
  const cnCount = (n) => ["一", "二", "三", "四", "五", "六", "七", "八"][n - 1] || String(n);

  const stats = [
    { label: "Tracks", value: TRACKS.length, unit: "条" },
    { label: "Teams", value: state.session ? teams.length : "—", unit: state.session ? "支" : "" },
    { label: "Entries", value: subs.length, unit: "件" },
    { label: "Deadline", value: cd.text, unit: "", small: true },
  ];

  const trackBlurb = (code) =>
    code === "A"
      ? "机制创新、兼容性、稳定性、前置依赖"
      : code === "B"
      ? "建筑、关卡、剧情、命令与游玩体验"
      : code === "C"
      ? "单位与机制设计、平衡性、联机兼容"
      : "布局、触发器与脚本、对抗或合作体验";

  el.innerHTML = shell(`
    <section class="hero-ed">
      <div class="hero-copy">
        <div class="eyebrow">MINECRAFT × RUSTED WARFARE · 2026</div>
        <h1 class="hero-title">像素松<span class="hero-mark"> / </span><br /><em>限时创作</em></h1>
        <p class="hero-sub">${esc(intro?.first || "全程线上，72 小时，做出一个能装进游戏、别人下载后能跑起来的模组或地图。一队 3–5 人，按赛道独立评审，不设路演。")}</p>
        <div class="hero-cta">
          ${
            state.session
              ? `<a class="btn btn-primary" href="#/work">提交作品</a><a class="btn" href="#/team">我的队伍</a>`
              : `<a class="btn btn-primary" href="#/login">登录 / 报名</a><a class="btn" href="#/rules">先看规则</a>`
          }
          <a class="hero-link mono" href="#/works">浏览参赛作品 <span>→</span></a>
        </div>
        <div class="hero-meta mono">
          <span>THEME · ${esc(a.theme)}</span><i></i>
          <span>${esc(a.venue || "全程线上")}</span><i></i>
          <span>DEADLINE · ${esc(fmtDate(a.submitDeadline))}</span>
        </div>
      </div>

      <div class="hero-side">
        <div class="terminal">
          <div class="terminal-bar"><b>pixelsong.config</b><span class="dots"><i></i><i></i><i></i></span></div>
          <pre><code><span class="cm">// 72h build sprint</span>
<span class="kw">const</span> run = {
  theme: <span class="st">"${esc(a.theme)}"</span>,
  tracks: <span class="nu">${TRACKS.length}</span>,
  team: <span class="st">"3–5"</span>,
  window: <span class="st">"72h"</span>,
  mode: <span class="st">"online"</span>,
};</code></pre>
          <div class="terminal-foot mono">STATUS · ${cd.over ? "CLOSED" : "OPEN FOR SUBMISSION"}</div>
        </div>
        <div class="countdown${cd.over ? " is-over" : ""}">
          <div class="cd-label mono">${cd.over ? "提交已截止" : "距提交截止"}</div>
          ${cd.over
            ? `<div class="cd-closed mono">${esc(fmtDate(a.submitDeadline))}</div>`
            : `<div class="cd-digits">
            <b>${pad2(cdD)}</b><span>D</span>
            <b>${pad2(cdH)}</b><span>H</span>
            <b>${pad2(cdM)}</b><span>M</span>
          </div>`}
        </div>
      </div>
    </section>

    <div class="stat-strip">
      ${stats.map((s, i) => `
        <div class="stat-cell">
          <div class="stat-k mono">0${i + 1} / ${esc(s.label)}</div>
          <div class="stat-v" style="${s.small ? "font-size:20px;letter-spacing:-.6px" : ""}">${esc(s.value)}<small>${esc(s.unit)}</small></div>
        </div>`).join("")}
    </div>

    <section class="sec">
      <div class="sec-head">
        <span class="sec-no mono">01</span>
        <div class="sec-title"><h2>四条赛道</h2><p>按游戏 + 作品类型分赛道，跨赛道不直接比较</p></div>
        <span class="sec-meta mono">2 GAMES · 4 TRACKS</span>
      </div>
      <div class="track-grid">
        ${TRACKS.map((t, i) => {
          const n = subs.filter((x) => x.track === t.code).length;
          return `
          <a class="track-panel tc-${t.code}" href="#/works?track=${t.code}" aria-label="赛道 ${t.code} · ${esc(t.name)}，查看该赛道作品">
            <span class="track-wm" aria-hidden="true">${t.code}</span>
            <div class="track-top">
              <span class="track-idx mono">0${i + 1}</span>
              <span class="track-game mono"><i aria-hidden="true"></i>${t.side === "mc" ? "MINECRAFT" : "RUSTED WARFARE"}</span>
            </div>
            <div class="track-title">
              <h3>${esc(t.name)}</h3>
              <span class="track-type mono">${esc(t.type)}</span>
            </div>
            <p>${esc(trackBlurb(t.code))}</p>
            <div class="track-foot">
              <span class="mono">TRACK ${t.code}</span>
              <span class="track-go mono">${n ? `${n} 件作品` : "查看作品"} <b>→</b></span>
            </div>
          </a>`;
        }).join("")}
      </div>
    </section>

    <section class="sec">
      <div class="sec-head">
        <span class="sec-no mono">02</span>
        <div class="sec-title"><h2>赛程</h2><p>从报名到颁奖，五个节点</p></div>
        <span class="sec-meta mono">5 MILESTONES</span>
      </div>
      <div class="split-sec">
        <div class="steps">
          ${phases.map((p, i) => {
            const t = timeLeft(p.time);
            const passed = t.over;
            const next = !passed && (i === 0 || timeLeft(phases[i - 1].time).over);
            return `<div class="step ${passed ? "done" : next ? "now" : ""}"${next ? ' aria-current="step"' : ""}>
              <span class="step-no mono">${pad2(i + 1)}</span>
              <div class="step-body">
                <div class="step-head">
                  <h3>${esc(p.label)}</h3>
                  <span class="step-state mono">${passed ? "DONE" : next ? "NOW" : ""}</span>
                </div>
                <div class="step-time">${esc(fmtFull(p.time))}</div>
                <p>${esc(p.desc)}</p>
              </div>
            </div>`;
          }).join("")}
        </div>
        <aside class="score-panel">
          <div class="score-head">
            <div>
              <span class="score-eyebrow mono">RUBRIC · 评审标准</span>
              <h3>${cnCount(DIMENSIONS.length)} 个维度，加权计分</h3>
            </div>
            <div class="score-total">
              <b>${totalWeight}</b>
              <span class="mono">TOTAL</span>
            </div>
          </div>
          <ol class="score-list">
            ${DIMENSIONS.map((d, i) => `
              <li class="score-row">
                <span class="score-index mono">0${i + 1}</span>
                <span class="score-name">${esc(d.name)}</span>
                <span class="score-bar"><i style="width:${Math.round((d.weight / maxWeight) * 100)}%"></i></span>
                <span class="score-w mono">${d.weight}<small>%</small></span>
              </li>`).join("")}
          </ol>
          <div class="score-floor">
            <span class="score-floor-k mono">THRESHOLD</span>
            <p>总分低于 <b>60</b> 分不授予等级奖；同分按可运行性、创意、玩法依次排序。</p>
          </div>
        </aside>
      </div>
    </section>

    <section class="sec">
      <div class="sec-head">
        <span class="sec-no mono">03</span>
        <div class="sec-title"><h2>常见问题</h2><p>报名、提交与评审</p></div>
        <a class="sec-link mono" href="#/rules">完整规则 →</a>
      </div>
      <div class="faq-grid">
        ${FAQS.map((f, i) => `
          <article class="faq-item">
            <div class="faq-q">
              <span class="faq-no mono">Q${String(i + 1).padStart(2, "0")}</span>
              <h3>${esc(f.q)}</h3>
            </div>
            <p class="faq-a">${esc(f.a)}</p>
          </article>`).join("")}
      </div>
    </section>

    <section class="sec">
      <div class="sec-head">
        <span class="sec-no mono">04</span>
        <div class="sec-title"><h2>公告</h2><p>赛程变更与重要通知</p></div>
        <a class="sec-link mono" href="#/notices">ALL →</a>
      </div>
      ${notices.length
        ? `<div class="notice-list">${notices.map((n) => `
            <a class="notice-row" href="#/notices">
              <span class="notice-title">${n.pinned ? '<span class="tag tag-amber" style="margin-right:8px">置顶</span>' : ""}${esc(n.title)}</span>
              <span class="notice-meta mono">${esc(ago(n.created_at))}</span>
            </a>`).join("")}</div>`
        : '<div class="empty" style="padding:22px">暂无公告</div>'}
    </section>

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
    <section class="sec" id="orgs">
      <div class="sec-head">
        <span class="sec-no mono">05</span>
        <div class="sec-title"><h2>${esc(title)}</h2><p>${esc(note || "")}</p></div>
      </div>
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
    </section>`;
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
      <span class="sponsor-avatar">
        <b>${esc(sponsorMark(s.name))}</b>
        ${
          s.avatar_url
            ? `<img src="${esc(s.avatar_url)}" alt="" loading="lazy" onerror="this.remove()" />`
            : ""
        }
      </span>
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

  const a = state.activity || DEFAULT_ACTIVITY;
  const { html, toc } = renderDoc(doc.body);
  setSeo({
    title: doc.title,
    desc: "像素松活动规则：赛制与时间、四条赛道、提交材料、原创性边界、兼容性测试、评审与奖项、知识产权与违规处理。",
    path: "/rules",
  });

  el.innerHTML = shell(`
    <header class="page-head">
      <div class="eyebrow">RULES & REGULATIONS · 2026</div>
      <h1>${esc(doc.title)}</h1>
      <div class="page-meta mono">UPDATED ${esc(fmtFull(doc.updated_at))} · 主办方在线维护</div>
    </header>

    <div class="facts">
      <div class="fact fact-theme">
        <span class="fact-k mono">THEME / 主题</span>
        <b>${esc(a.theme)}</b>
        <p>赛前公布方向性主题，正式题目于开幕时公布</p>
      </div>
      <div class="fact">
        <span class="fact-k mono">TRACKS / 赛道</span>
        <b>${TRACKS.length} 条赛道</b>
        <p class="fact-tracks">${TRACKS.map(
          (t) => `<span class="tc-${t.code}"><i></i>${esc(t.name)}</span>`
        ).join("")}</p>
      </div>
      <div class="fact">
        <span class="fact-k mono">TEAM / 队伍</span>
        <b>3–5 人</b>
        <p>也可个人参赛，每人只能提交 1 个作品</p>
      </div>
      <div class="fact">
        <span class="fact-k mono">WINDOW / 开发窗口</span>
        <b>72 小时</b>
        <p>连续计时，不补时</p>
      </div>
      <div class="fact">
        <span class="fact-k mono">DEADLINE / 提交截止</span>
        <b>${esc(fmtDate(a.submitDeadline))}</b>
        <p>作品包与参评材料同时锁定</p>
      </div>
      <div class="fact">
        <span class="fact-k mono">FORMAT / 形式</span>
        <b>${esc(a.venue || "全程线上")}</b>
        <p>不设路演，按赛道独立评审</p>
      </div>
    </div>

    <div class="rules-layout">
      <aside class="side-nav rules-toc">
        <div class="toc-label mono">CONTENTS</div>
        ${toc.map((t) => `<a href="#" data-scroll="${t.id}">${esc(t.title)}</a>`).join("")}
        <a href="#/integrity" class="toc-extra">《诚信比赛公约》</a>
      </aside>
      <article class="rules">
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
    <div class="field">
      <label id="otp-pwd-label">登录密码</label>
      <input type="password" id="f-pwd-o" placeholder="至少 8 位，含字母和数字" autocomplete="new-password" />
      <div class="hint" id="otp-pwd-hint">首次使用该邮箱时必须设置；已有密码可留空</div>
    </div>
    <div class="field">
      <label>确认密码</label>
      <input type="password" id="f-pwd2-o" placeholder="再输一次（已有密码可留空）" autocomplete="new-password" />
    </div>
    <button class="btn btn-primary btn-block" id="btn-otp" type="button">登录 / 注册</button>
    <p class="tiny dim" style="margin-top:12px">新邮箱首次验证码登录会创建账号，需同时填写昵称并设置密码；已有账号可直接用验证码登录。</p>`;
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
          ? `<div class="hint">密码至少 6 位 · <a href="#" id="link-forgot">忘记密码？</a></div>`
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

  // OAuth 失败会带 oauth_error 回到登录页
  const oauthError = new URLSearchParams(location.search.slice(1) || location.hash.split("?")[1] || "").get("oauth_error");
  if (oauthError) {
    toast(oauthError, "err");
    history.replaceState(null, "", "/login");
  }
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
  const githubOn = Boolean(LOCAL_MODE && cfg.github && cfg.github.enabled);
  const showThirdParty = cnkdOn || githubOn || !LOCAL_MODE;

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
                 ${githubOn ? `<button class="btn btn-block" id="btn-github" type="button" style="margin-top:9px">GitHub 登录 / 注册</button>` : ""}
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
    return {
      email,
      verificationId: sent.data.verificationId,
      isExistingUser: sent.data.isExistingUser,
      hasPassword: sent.data.hasPassword,
    };
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
    const pwdEl = el.querySelector("#f-pwd-o");
    const pwd2El = el.querySelector("#f-pwd2-o");
    const pwdHint = el.querySelector("#otp-pwd-hint");

    sendBtn.onclick = async () => {
      const email = emailEl.value.trim();
      if (!EMAIL_RE.test(email)) return toast("请输入正确的邮箱地址", "err");
      pendingOtp = await sendCode(sendBtn, email);
      if (!pendingOtp) return;
      // 先验证码后注册的场景：只有新账号才要求填昵称
      const isNew = pendingOtp.isExistingUser === false;
      if (nameWrap) nameWrap.style.display = isNew ? "" : "none";
      if (pwdHint) {
        pwdHint.textContent = pendingOtp.hasPassword
          ? "该邮箱已设置密码，留空即可直接用验证码登录"
          : "该邮箱尚未设置密码，必须填写后才能完成登录";
      }
      if (isNew && nameEl) nameEl.focus();
      else if (!pendingOtp.hasPassword && pwdEl) pwdEl.focus();
    };

    loginBtn.onclick = async () => {
      const email = emailEl.value.trim();
      const token = codeEl.value.trim();
      const password = pwdEl ? pwdEl.value : "";
      const password2 = pwd2El ? pwd2El.value : "";
      if (!pendingOtp || pendingOtp.email !== email) return toast("请先获取该邮箱的验证码", "err");
      if (!token) return toast("请输入验证码", "err");
      const isNew = pendingOtp.isExistingUser === false;
      const name = isNew ? (nameEl ? nameEl.value.trim() : "") : "";
      if (isNew && [...name].length < 2) {
        if (nameEl) nameEl.focus();
        return toast("首次登录请填写昵称，至少 2 个字", "err");
      }
      // 新账号或尚未设置密码的账号，验证码登录必须同时设置密码
      if (!pendingOtp.hasPassword && !password) {
        if (pwdEl) pwdEl.focus();
        return toast("请设置登录密码", "err");
      }
      if (password && !pwdOk(password)) {
        return toast("密码至少 8 位，且需同时包含字母和数字", "err");
      }
      if (password && password !== password2) {
        return toast("两次输入的密码不一致", "err");
      }
      busy(loginBtn, true, isNew ? "注册中…" : "登录中…");
      try {
        const done = await cloud.auth.verifyOtp({
          email,
          verificationId: pendingOtp.verificationId,
          isExistingUser: pendingOtp.isExistingUser,
          token,
          name,
          password,
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
          resetCtx = { email, verificationId: started.data.verificationId };
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
          const done = await cloud.auth.confirmPasswordReset({
            email: resetCtx.email,
            verificationId: resetCtx.verificationId,
            token: code,
            password: p1,
          });
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
  const githubBtn = el.querySelector("#btn-github");
  if (githubBtn) githubBtn.onclick = () => location.assign("/api/github/start");

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
  try {
    subs = (await allSubmissions()).filter((s) => s.status === "public");
  } catch (e) {
    subs = [];
  }

  // 访客读不到 reviews 表，分数改由只读聚合接口提供；
  // 云端部署没有这个接口时，退回原始评分（只有评委/主办方能读到）。
  let ranked = [];
  try {
    ranked = rankByPublicScores(subs, await publicScores());
  } catch (_) {
    let reviews = [];
    try {
      reviews = await allReviews();
    } catch (_) {}
    ranked = rankSubmissions(subs, reviews);
  }
  const groups = TRACKS.map((t) => ({ ...t, rows: ranked.filter((r) => r.sub.track === t.code) }));

  el.innerHTML = shell(`
    <header class="page-head">
      <div class="eyebrow">RESULTS · ${TRACKS.length} TRACKS</div>
      <h1>作品与结果</h1>
      <div class="page-meta mono">${subs.length} PUBLIC ENTRIES · 按赛道独立排序</div>
    </header>
    ${
      !subs.length
        ? emptyState({
             title: "还没有已公示的作品",
             desc: "提交截止后统一公开，此前作品仅本队与评委可见。",
             href: "/rules",
             action: "查看活动规则",
             mark: "RESULTS / 0",
           })
        : groups.map((g) => `
          <div class="block">
            <div class="row-between" style="margin-bottom:12px">
              <div class="row" style="gap:10px">
                <span class="track-badge tc-${g.code}" style="font-size:11px">赛道 ${g.code}</span>
                <span class="strong">${esc(g.name)}</span>
              </div>
              <span class="card-note">${g.rows.length} 件</span>
            </div>
            <div class="grid grid-2">
              ${g.rows.map((r, i) => `
                <div class="card result-card tc-${g.code}">
                  <div class="row-between" style="margin-bottom:8px">
                    <div class="row" style="gap:9px;min-width:0">
                      <span class="result-idx mono">${String(i + 1).padStart(2, "0")}</span>
                      <a class="strong" style="font-size:15px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" href="#/works/${r.sub.id}">${esc(r.sub.title)}</a>
                    </div>
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
    <a class="wk-chip tc-${code || "all"} ${track === code ? "on" : ""}" href="#/works${code ? "?track=" + code : ""}">
      ${esc(label)}<b>${n}</b>
    </a>`;

  el.innerHTML = shell(`
    <header class="page-head">
      <div class="eyebrow">EXHIBITION · ${TRACKS.length} TRACKS</div>
      <h1>参赛作品</h1>
      <div class="page-meta mono">${all.length} PUBLIC ENTRIES · 提交截止后统一公示</div>
    </header>

    ${
      !all.length
        ? emptyState({
             title: "还没有已公示的作品",
             desc: "提交截止后由主办方统一公示；在此之前作品仅本队与评委可见。",
             href: "/rules",
             action: "查看活动规则",
             mark: "WORKS / 0",
           })
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
                     <span class="track-badge tc-${esc(w.track)}">${esc(trackOf(w.track).name)}</span>
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
    setSeo({ title: "作品不存在", desc: "这件作品尚未公示，或已被撤回。", path: `/works/${id}`, noindex: true });
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
  setSeo({
    title: w.title,
    desc: w.summary || `${w.title} · 像素松参赛作品`,
    path: `/works/${w.id}`,
    type: "article",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "CreativeWork",
      name: w.title,
      description: w.summary || "",
      url: location.origin + `/works/${w.id}`,
      genre: t.name,
      author: { "@type": "Organization", name: w.owner_name || "匿名队伍" },
      datePublished: w.created_at,
    },
  });
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
    <header class="page-head">
      <div class="eyebrow">JURY · 2026</div>
      <h1>评委团队</h1>
      <div class="page-meta mono">${judges.length} 位 · 按赛道独立评审</div>
    </header>

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
        : emptyState({
             title: "评委名单尚未公布",
             desc: "名单由主办方在评审开始前录入，届时会展示赛道分工。",
             href: "/rules",
             action: "查看评审规则",
             mark: "JURY / 0",
           })
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
    <header class="page-head">
      <div class="eyebrow">NOTICES · 2026</div>
      <h1>公告</h1>
      <div class="page-meta mono">${list.length} 条 · 赛程变更与重要通知</div>
    </header>
    ${list.length
      ? `<div class="card">${list.map((n) => `
          <div class="notice-item">
            <div class="row-between" style="margin-bottom:4px">
              <div class="notice-title">${n.pinned ? '<span class="tag tag-amber" style="margin-right:6px">置顶</span>' : ""}${esc(n.title)}</div>
              <span class="notice-meta">${esc(fmtDate(n.created_at))}</span>
            </div>
            <p class="small muted" style="white-space:pre-wrap;margin:0">${esc(n.body || "")}</p>
          </div>`).join("")}</div>`
      : emptyState({
          title: "暂无公告",
          desc: "赛程变更、评审安排与重要通知会在这里发布。",
          href: "/rules",
          action: "查看活动规则",
          mark: "NOTICES / 0",
        })}
  `);
  bindShell();
}

/* ---------------------------- CNKD 身份 ---------------------------- */

export async function cnkdView(el, path) {
  const q = new URLSearchParams((path || "").split("?")[1] || "");
  const err = q.get("error");
  const c = await cnkdConfig();
  if (state.session) await loadMe(true).catch(() => {});
  else await loadSession().catch(() => {});

  const signedIn = Boolean(state.session);
  const bound = Boolean(state.me && state.me.cnkd_sub);
  const name = state.me?.nickname || state.me?.owner_name || "";

  let action = "";
  if (!c.enabled) {
    action = `<button class="btn btn-block" disabled>尚未配置 CNKD 客户端</button>
              <p class="tiny dim" style="margin-top:10px">需要平台方发放 client_id 并登记回调地址。</p>`;
  } else if (signedIn && bound) {
    action = `<div class="row" style="gap:8px;align-items:center;margin-bottom:12px">
                <span class="tag tag-teal">已绑定</span>
                <span class="small muted">当前账号「${esc(name)}」已关联 CNKD</span>
              </div>
              <a class="btn btn-primary btn-block" href="#/me">回到我的</a>`;
  } else if (signedIn) {
    action = `<p class="small muted" style="margin-bottom:12px">把 CNKD 身份绑定到当前账号「${esc(name)}」，之后可以直接用它登录。</p>
              <button class="btn btn-primary btn-block" id="btn-cnkd-bind">绑定到当前账号</button>`;
  } else {
    action = `<p class="small muted" style="margin-bottom:12px">首次使用会直接创建本站账号，无需先注册。</p>
              <button class="btn btn-primary btn-block" id="btn-cnkd-login">用 CNKD 登录 / 注册</button>`;
  }

  el.innerHTML = shell(`
    <div class="auth-wrap">
      <div class="card">
        <div class="card-head" style="margin-bottom:10px">
          <h2>CNKD 一证通行</h2>
          <span class="tag ${bound ? "tag-teal" : ""}">${bound ? "已绑定" : signedIn ? "未绑定" : "未登录"}</span>
        </div>
        <p class="small muted">用 CNKD 账号完成一次身份核验。本站的报名、组队与作品数据仍由站内账号承载，CNKD 负责确认「你是 CNKD 生态里的哪个人」。</p>
        ${
          err
            ? `<div class="card" style="border-color:rgba(240,149,149,.35);margin-top:14px;padding:12px 14px">
                 <p class="small" style="margin:0;color:var(--red)">${esc(err)}</p>
               </div>`
            : ""
        }
        <div class="divider"></div>
        ${action}
        <a class="btn btn-ghost btn-block" href="#/home" style="margin-top:9px">返回首页</a>
      </div>
    </div>`);
  bindShell();

  const loginBtn = el.querySelector("#btn-cnkd-login");
  if (loginBtn) loginBtn.onclick = () => startCnkdLogin(false);
  const bindBtn = el.querySelector("#btn-cnkd-bind");
  if (bindBtn) bindBtn.onclick = () => startCnkdLogin(true);
}
