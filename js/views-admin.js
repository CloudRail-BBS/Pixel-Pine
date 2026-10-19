import {
  state, shell, bindShell, navigate, toast, esc, fmtDate, fmtFull, timeLeft, ago,
  requireLogin, busy, errMsg, modal, confirmBox, db, unwrap, isAdmin,
} from "./core.js";
import { TRACKS, trackOf, STATUS_TEXT, TEAM_STATUS, DIMENSIONS, AWARDS, PARTNER_ROLES, partnerRoleOf } from "./config.js";
import {
  listTeams, allSubmissions, allReviews, listJudges, listAnnouncements, createAnnouncement,
  deleteAnnouncement, setTeamStatus, setCompatibility, assignReviews, publishResults,
  rankSubmissions, trackCounts, awardPlan, saveActivity, listAllAppeals, replyAppeal,
  setUserRole, listVersions, listDocuments, saveDocument,
  listCertificates, issueCertificates, revokeCertificate, issueJudgeCertificate,
  listPartners, savePartner, deletePartner,
  listSponsors, saveSponsor, deleteSponsor,
  listJudgesAll, saveJudge, deleteJudge, getIntro, plainFirst,
  getSiteSettings, saveSiteSettings, sendTestMail, authConfig,
} from "./api.js";

const val = (root, sel) => (root.querySelector(sel)?.value || "").trim();
const checked = (root, sel) => !!root.querySelector(sel).checked;

const TABS = [
  { key: "overview", label: "概览" },
  { key: "teams", label: "队伍" },
  { key: "works", label: "作品" },
  { key: "review", label: "评审" },
  { key: "judges", label: "评委" },
  { key: "results", label: "结果" },
  { key: "certs", label: "证书" },
  { key: "notices", label: "公告" },
  { key: "content", label: "内容" },
  { key: "partners", label: "单位" },
  { key: "sponsors", label: "赞助者" },
  { key: "settings", label: "设置" },
  { key: "appeals", label: "申诉" },
  { key: "system", label: "系统" },
];

const ROLE_TEXT = { participant: "参赛者", judge: "评委", admin: "主办方" };

function toLocal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const p = (n) => (n < 10 ? "0" + n : "" + n);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fromLocal(v) {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d) ? "" : d.toISOString();
}

export async function adminView(el, path) {
  if (!requireLogin(el)) return;
  if (!isAdmin()) {
    el.innerHTML = shell(`<div class="empty"><p>需要主办方权限</p><p class="tiny" style="margin-top:6px">当前角色：${esc(ROLE_TEXT[state.me?.role] || state.me?.role || "未知")}</p></div>`);
    bindShell();
    return;
  }

  const tab = (path || "").split("/")[2] || "overview";

  const [teams, subs, reviews, notices, appeals, profiles, members, sigs, docs, certs, partners, judgeList, intro, health, siteCfg, authCfg, sponsorList] = await Promise.all([
    listTeams().catch(() => []),
    allSubmissions().catch(() => []),
    allReviews().catch(() => []),
    listAnnouncements().catch(() => []),
    listAllAppeals().catch(() => []),
    db.from("profiles").select("*").order("created_at").then(unwrap).catch(() => []),
    db.from("team_members").select("team_id, owner_id, member_name").then(unwrap).catch(() => []),
    db.from("signatures").select("owner_id, agreed_name, created_at, doc_version, doc_key").then(unwrap).catch(() => []),
    listDocuments().catch(() => []),
    listCertificates().catch(() => []),
    listPartners().catch(() => []),
    listJudgesAll().catch(() => []),
    getIntro().catch(() => null),
    fetch("/api/health").then((r) => r.json()).catch(() => null),
    getSiteSettings().catch(() => null),
    authConfig().catch(() => null),
    listSponsors().catch(() => []),
  ]);

  const reviewed = reviews.filter((r) => r.status === "submitted");
  const counts = trackCounts(teams, subs);
  const pendingAppeals = appeals.filter((a) => a.status === "open");
  const pendingTeams = teams.filter((t) => t.status === "pending");
  const pendingWorks = subs.filter((s) => s.status === "submitted");

  const body = (() => {
    switch (tab) {
      case "teams": return teamsTab(teams, members);
      case "works": return worksTab(subs);
      case "review": return reviewTab(reviews, profiles, subs);
      case "judges": return judgesTab(judgeList, sigs, certs);
      case "results": return resultsTab(subs, reviews);
      case "certs": return certsTab(subs, teams, members, certs);
      case "notices": return noticesTab(notices);
      case "content": return contentTab(docs);
      case "partners": return partnersTab(partners);
      case "sponsors": return sponsorsTab(sponsorList);
      case "settings": return settingsTab(siteCfg, authCfg);
      case "appeals": return appealsTab(appeals);
      case "system": return systemTab(health, profiles);
      default: return overviewTab({ teams, subs, reviews, counts, reviewed, pendingAppeals, pendingTeams, pendingWorks, health, members, profiles, sigs, intro });
    }
  })();

  el.innerHTML = shell(`
    <div class="block-head"><h2>主办方后台</h2>
      <span class="card-note">${esc(state.activity?.theme || "")} · v${esc(health?.version || "—")}</span>
    </div>
    <div class="admin-layout">
      <aside class="admin-side">
        ${TABS.map((t) => {
          const badge =
            t.key === "teams" ? pendingTeams.length :
            t.key === "works" ? pendingWorks.length :
            t.key === "appeals" ? pendingAppeals.length : 0;
          return `<a href="#/admin/${t.key}" class="${tab === t.key ? "active" : ""}">
            <span>${t.label}</span>${badge ? `<b class="pill">${badge}</b>` : ""}
          </a>`;
        }).join("")}
      </aside>
      <section class="admin-body">${body}</section>
    </div>
  `, { wide: true });
  bindShell();

  wireAdmin(el, { teams, subs, reviews, notices, appeals, profiles, members, certs, partners, judgeList, sponsors: sponsorList, tab });
}

/* ------------------------------ 概览 ------------------------------ */

function overviewTab(d) {
  const now = Date.now();
  const a = state.activity || {};
  const stages = [
    { label: "报名中", from: 0, to: new Date(a.signupDeadline || 0).getTime() },
    { label: "赛前准备", from: new Date(a.signupDeadline || 0).getTime(), to: new Date(a.eventStart || 0).getTime() },
    { label: "开发中", from: new Date(a.eventStart || 0).getTime(), to: new Date(a.submitDeadline || 0).getTime() },
    { label: "评审中", from: new Date(a.submitDeadline || 0).getTime(), to: new Date(a.judgeDeadline || 0).getTime() },
    { label: "公示与颁奖", from: new Date(a.judgeDeadline || 0).getTime(), to: Infinity },
  ];
  const cur = stages.find((s) => now >= s.from && now < s.to) || stages[stages.length - 1];
  const totalReviews = d.reviews.length;
  const doneReviews = d.reviewed.length;

  const todo = [
    { n: d.pendingTeams.length, t: "支队伍待审核", href: "#/admin/teams", on: d.pendingTeams.length > 0 },
    { n: d.pendingWorks.length, t: "件作品待兼容性检查", href: "#/admin/works", on: d.pendingWorks.length > 0 },
    { n: totalReviews - doneReviews, t: "份评分待提交", href: "#/admin/review", on: totalReviews - doneReviews > 0 },
    { n: d.pendingAppeals.length, t: "条申诉待处理", href: "#/admin/appeals", on: d.pendingAppeals.length > 0 },
  ].filter((x) => x.on);

  const intro = d.intro;
  return `
    <div class="card block">
      <div class="card-head">
        <h2>活动介绍</h2>
        <div class="row" style="gap:10px">
          ${intro ? `<span class="card-note">v${esc(String(intro.version))} · ${esc(fmtFull(intro.updated_at))}</span>` : ""}
          <a class="card-note" href="#/admin/content">编辑</a>
        </div>
      </div>
      ${
        intro
          ? `<p class="small muted" style="white-space:pre-wrap;margin:0 0 10px;max-width:78ch">${esc(intro.body)}</p>
             <p class="tiny dim" style="margin:0">这段文字同时用于前台首页标题下方那句导语（取第一段）。</p>`
          : `<p class="small dim" style="margin:0">尚未填写。到「内容 → 活动介绍」写一段，前台首页与这里会一起更新。</p>`
      }
    </div>

    <div class="grid grid-4 block">
      <div class="stat"><div class="stat-label">队伍</div><div class="stat-value">${d.teams.length}</div></div>
      <div class="stat"><div class="stat-label">作品</div><div class="stat-value">${d.subs.filter((s) => s.status !== "draft").length}</div></div>
      <div class="stat"><div class="stat-label">评分进度</div><div class="stat-value">${doneReviews}<small>/ ${totalReviews}</small></div></div>
      <div class="stat"><div class="stat-label">当前阶段</div><div class="stat-value" style="font-size:17px">${esc(cur.label)}</div></div>
    </div>

    <div class="card block">
      <div class="card-head"><h2>待办</h2><span class="card-note">${todo.length ? todo.length + " 项" : "已清空"}</span></div>
      ${todo.length ? todo.map((x) => `
        <a class="todo-row" href="${x.href}">
          <span class="todo-n">${x.n}</span>
          <span class="todo-t">${esc(x.t)}</span>
          <span class="todo-arrow">→</span>
        </a>`).join("") : '<p class="small dim" style="margin:0">当前没有待处理事项</p>'}
    </div>

    <div class="card block">
      <div class="card-head"><h2>签署与确认</h2>
        <span class="card-note">${((d.profiles || []).length) || 0} 个账号</span>
      </div>
      ${(() => {
        const total = (d.profiles || []).length || 0;
        const integ = (d.sigs || []).filter((s) => (s.doc_key || "integrity") === "integrity");
        const rules = (d.sigs || []).filter((s) => s.doc_key === "rules");
        const pct = (n) => (total ? Math.round((n / total) * 100) : 0);
        return `
          <div class="row-between small" style="margin-bottom:6px">
            <span>《诚信比赛公约》</span>
            <span class="mono muted">${integ.length} / ${total}</span>
          </div>
          <div class="bar" style="margin-bottom:12px"><i style="width:${pct(integ.length)}%"></i></div>

          <div class="row-between small" style="margin-bottom:6px">
            <span>《活动规则》阅读确认</span>
            <span class="mono muted">${rules.length} / ${total}</span>
          </div>
          <div class="bar" style="margin-bottom:10px"><i style="width:${pct(rules.length)}%"></i></div>

          <p class="tiny dim" style="margin:0">公约需全队成员各自签署才能提交作品；规则确认在提交时弹出，每人每版本一次，规则正文更新后需重新确认。</p>`;
      })()}
    </div>

    <div class="card block">
      <div class="card-head"><h2>赛道与设奖判定</h2><span class="card-note">按队伍数自动判定</span></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>赛道</th><th>队伍</th><th>已通过</th><th>作品</th><th>设奖方式</th></tr></thead>
        <tbody>${d.counts.map((c) => {
          const p = awardPlan(c.teams);
          return `<tr>
            <td><span class="tag ${c.side === "mc" ? "tag-blue" : "tag-amber"}">${c.code}</span> ${esc(c.name)}</td>
            <td class="mono">${c.teams}</td>
            <td class="mono">${c.approved}</td>
            <td class="mono">${c.subs}</td>
            <td><span class="tag ${p.mode === "independent" ? "tag-teal" : p.mode === "empty" ? "" : "tag-amber"}">${esc(p.label)}</span>
              <span class="tiny dim" style="margin-left:6px">${esc(p.detail)}</span></td>
          </tr>`;
        }).join("")}</tbody>
      </table></div>
    </div>

    <div class="card">
      <div class="card-head"><h2>服务状态</h2><a class="card-note" href="#/admin/system">系统详情</a></div>
      ${d.health ? `
        <div class="row row-wrap" style="gap:8px">
          <span class="tag tag-teal">服务正常</span>
          <span class="tag">v${esc(d.health.version)}</span>
          <span class="tag">Node ${esc(d.health.node)}</span>
          <span class="tag ${d.health.geetest?.enabled ? "tag-teal" : "tag-amber"}">人机验证 ${d.health.geetest?.enabled ? "已启用" : "未配置"}</span>
        </div>` : '<p class="small" style="color:var(--red);margin:0">健康检查不可达，可能仍在运行静态版本</p>'}
    </div>`;
}

/* ------------------------------ 队伍 ------------------------------ */

function teamsTab(teams, members) {
  const countOf = (id) => members.filter((m) => m.team_id === id).length;
  return `
    <div class="card">
      <div class="card-head"><h2>报名审核</h2><span class="card-note">${teams.filter((t) => t.status === "pending").length} 支待审</span></div>
      ${teams.length ? `<div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>队伍</th><th>赛道</th><th>队长</th><th>人数</th><th>状态</th><th class="right">操作</th></tr></thead>
        <tbody>${teams.map((t) => {
          const n = countOf(t.id);
          return `<tr>
            <td class="strong">${esc(t.name)}${
              t.kind === "individual" ? ' <span class="tag">个人</span>' : ""
            }<div class="mono tiny dim">${esc(t.invite_code)}</div></td>
            <td><span class="tag">${esc(t.track)}</span></td>
            <td class="small">${esc(t.owner_name || "—")}</td>
            <td class="mono ${n < 3 ? "tag-red" : ""}">${n}</td>
            <td><span class="${(TEAM_STATUS[t.status] || {}).cls || "tag"}">${esc((TEAM_STATUS[t.status] || {}).label || t.status)}</span></td>
            <td class="right nowrap">
              <button class="btn btn-sm" data-team="${t.id}" data-st="approved">通过</button>
              <button class="btn btn-sm btn-danger" data-team="${t.id}" data-st="rejected">驳回</button>
            </td>
          </tr>`;
        }).join("")}</tbody>
      </table></div>` : '<div class="empty">暂无队伍</div>'}
    </div>`;
}

/* ------------------------------ 作品 ------------------------------ */

function worksTab(subs) {
  return `
    <div class="card">
      <div class="card-head"><h2>作品与兼容性</h2><span class="card-note">${subs.filter((s) => s.status === "submitted").length} 件待检查</span></div>
      ${subs.length ? `<div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>作品</th><th>赛道</th><th>版本</th><th>作品包</th><th>扫描</th><th>状态</th><th class="right">操作</th></tr></thead>
        <tbody>${subs.map((s) => {
          const sc = s.scan || null;
          const scMap = { clean: ["tag-teal", "通过"], malicious: ["tag-red", "恶意"], suspicious: ["tag-amber", "可疑"], notfound: ["tag", "未收录"] };
          const [scls, slabel] = sc ? scMap[sc.status] || ["tag", sc.status] : ["tag", "未扫描"];
          return `<tr>
          <td class="strong">${esc(s.title)}<div class="tiny dim">${esc(s.owner_name || "")}</div></td>
          <td><span class="tag">${esc(s.track)}</span></td>
          <td class="mono tiny">v${s.version_no}</td>
          <td class="tiny">${s.file_path ? esc(s.file_name || "已上传") + `<div class="tiny dim">${s.shared_path ? "已发布" : "未发布"}</div>` : '<span class="dim">—</span>'}</td>
          <td><span class="tag ${scls}">${esc(slabel)}${sc && sc.stats ? ` ${sc.stats.malicious}/${sc.stats.total}` : ""}</span></td>
          <td><span class="${(STATUS_TEXT[s.status] || {}).cls || "tag"}">${esc((STATUS_TEXT[s.status] || {}).label || s.status)}</span></td>
          <td class="right nowrap">
            <button class="btn btn-sm" data-vers="${s.id}">版本</button>
            <button class="btn btn-sm" data-check="${s.id}">兼容性</button>
          </td>
        </tr>`;
        }).join("")}</tbody>
      </table></div>` : '<div class="empty">暂无作品</div>'}
    </div>`;
}

/* ------------------------------ 评审 ------------------------------ */

function reviewTab(reviews, profiles, subs) {
  const byJudge = new Map();
  for (const r of reviews) {
    if (!byJudge.has(r.judge_uid)) byJudge.set(r.judge_uid, []);
    byJudge.get(r.judge_uid).push(r);
  }
  const subById = new Map(subs.map((s) => [s.id, s]));

  return `
    <div class="card block">
      <div class="card-head"><h2>派评</h2><span class="card-note">把已通过的作品分配给评委</span></div>
      <div class="row row-wrap" style="gap:10px;margin-bottom:10px">
        <select id="a-track" style="max-width:190px">
          ${TRACKS.map((t) => `<option value="${t.code}">${esc(t.name)}</option>`).join("")}
        </select>
        <select id="a-judge" style="max-width:220px">
          ${profiles.filter((p) => p.role === "judge" || p.role === "admin").map((j) =>
            `<option value="${j.owner_id}">${esc(j.nickname || j.owner_name || "未命名")}（${ROLE_TEXT[j.role]}）</option>`).join("")
            || '<option value="">尚无评委</option>'}
        </select>
        <button class="btn btn-primary" id="btn-assign">分配该赛道全部作品</button>
      </div>
      <p class="tiny dim" style="margin:0">重复分配会自动跳过，已存在的评分不会被覆盖。</p>
    </div>

    <div class="card block">
      <div class="card-head"><h2>评分进度</h2><span class="card-note">${reviews.filter((r) => r.status === "submitted").length} / ${reviews.length}</span></div>
      ${byJudge.size ? [...byJudge.entries()].map(([uid, list]) => {
        const p = profiles.find((x) => x.owner_id === uid);
        const done = list.filter((r) => r.status === "submitted").length;
        const pct = Math.round((done / list.length) * 100);
        return `<div style="margin-bottom:14px">
          <div class="row-between" style="margin-bottom:5px">
            <span class="small">${esc(p?.nickname || p?.owner_name || uid.slice(0, 8))}</span>
            <span class="mono tiny muted">${done} / ${list.length}</span>
          </div>
          <div class="bar"><i style="width:${pct}%"></i></div>
        </div>`;
      }).join("") : '<p class="small dim" style="margin:0">还没有分配任何作品</p>'}
    </div>

    <div class="card">
      <div class="card-head"><h2>已提交评分</h2><span class="card-note">按作品汇总</span></div>
      ${reviews.filter((r) => r.status === "submitted").length ? `<div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>作品</th><th>评委</th><th>总分</th><th>提交时间</th></tr></thead>
        <tbody>${reviews.filter((r) => r.status === "submitted").map((r) => {
          const s = subById.get(r.submission_id);
          return `<tr>
            <td class="strong">${esc(s?.title || "#" + r.submission_id)}</td>
            <td class="small">${esc(r.judge_name || "—")}</td>
            <td class="mono strong">${r.total || 0}</td>
            <td class="mono tiny dim">${esc(fmtDate(r.updated_at))}</td>
          </tr>`;
        }).join("")}</tbody>
      </table></div>` : '<p class="small dim" style="margin:0">暂无</p>'}
    </div>`;
}

/* ------------------------------ 结果 ------------------------------ */

function resultsTab(subs, reviews) {
  const ranked = rankSubmissions(subs.filter((s) => s.status !== "draft"), reviews);
  return `
    <div class="card">
      <div class="card-head"><h2>排名与授奖建议</h2><span class="card-note">60 分以下不授等级奖</span></div>
      ${ranked.length ? `<div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>#</th><th>作品</th><th>赛道</th><th>评委</th><th>均分</th><th>资格</th></tr></thead>
        <tbody>${ranked.map((r, i) => `<tr>
          <td class="mono">${i + 1}</td>
          <td class="strong">${esc(r.sub.title)}</td>
          <td><span class="tag">${esc(r.sub.track)}</span></td>
          <td class="mono">${r.judgeCount}${r.trimmed ? " *" : ""}</td>
          <td class="mono strong">${r.avg}</td>
          <td>${r.qualified ? '<span class="tag tag-teal">达标</span>' : '<span class="tag tag-red">不达标</span>'}</td>
        </tr>`).join("")}</tbody>
      </table></div>
      ${ranked.some((r) => r.trimmed) ? '<p class="tiny dim" style="margin-top:8px">* 5 位及以上评委，已去掉最高分与最低分</p>' : ""}
      <div class="divider"></div>
      <button class="btn btn-primary" id="btn-publish">公示已通过作品</button>
      <p class="tiny dim" style="margin-top:8px">公示后作品对所有访客可见，作品包链接也会公开。</p>
      ` : '<div class="empty">还没有可排名的作品</div>'}
    </div>`;
}

/* ------------------------------ 公告 ------------------------------ */

function noticesTab(notices) {
  return `
    <div class="card block">
      <div class="card-head"><h2>发布公告</h2></div>
      <div class="field"><input type="text" id="an-title" placeholder="标题" /></div>
      <div class="field"><textarea id="an-body" placeholder="正文，支持换行"></textarea></div>
      <div class="row row-wrap" style="gap:12px">
        <label class="row small" style="cursor:pointer;gap:6px"><input type="checkbox" id="an-pin" /> 置顶</label>
        <button class="btn btn-primary" id="btn-announce">发布</button>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h2>历史公告</h2><span class="card-note">${notices.length} 条</span></div>
      ${notices.length ? notices.map((n) => `<div class="notice-item row-between">
        <div style="min-width:0">
          <div class="notice-title">${n.pinned ? '<span class="tag tag-amber" style="margin-right:6px">置顶</span>' : ""}${esc(n.title)}</div>
          <div class="notice-meta">${esc(fmtFull(n.created_at))}</div>
        </div>
        <button class="btn btn-sm btn-danger" data-del="${n.id}">删除</button>
      </div>`).join("") : '<p class="small dim" style="margin:0">暂无公告</p>'}
    </div>`;
}

/* ------------------------------ 申诉 ------------------------------ */

function appealsTab(appeals) {
  return `
    <div class="card">
      <div class="card-head"><h2>申诉处理</h2><span class="card-note">${appeals.filter((a) => a.status === "open").length} 条待处理</span></div>
      ${appeals.length ? appeals.map((a) => `<div class="notice-item">
        <div class="row-between" style="margin-bottom:4px">
          <span class="small strong">作品 #${a.submission_id} · ${esc(a.owner_name || "匿名")}</span>
          <span class="tag ${a.status === "open" ? "tag-amber" : "tag-teal"}">${a.status === "open" ? "待处理" : "已回复"}</span>
        </div>
        <p class="small muted" style="margin:0 0 8px;white-space:pre-wrap">${esc(a.reason)}</p>
        <div class="tiny dim" style="margin-bottom:8px">${esc(fmtFull(a.created_at))}</div>
        ${a.status === "open"
          ? `<div class="row"><input type="text" placeholder="回复内容" data-reply="${a.id}" class="grow" /><button class="btn btn-sm" data-replybtn="${a.id}">回复</button></div>`
          : `<p class="tiny dim" style="margin:0">回复：${esc(a.reply || "")}</p>`}
      </div>`).join("") : '<div class="empty">暂无申诉</div>'}
    </div>`;
}

/* ------------------------------ 内容 ------------------------------ */

function contentTab(docs) {
  const rules = (docs || []).find((d) => d.doc_key === "rules");
  const intro = (docs || []).find((d) => d.doc_key === "intro");
  const login = (docs || []).find((d) => d.doc_key === "login");
  return `
    <div class="card block">
      <div class="card-head"><h2>活动介绍</h2>
        <span class="card-note">${intro ? "更新于 " + esc(fmtFull(intro.updated_at)) : "未初始化"}</span>
      </div>
      <p class="small muted" style="margin-bottom:16px">
        这段文字用在两处：前台首页标题下方的导语（自动取<b>第一段</b>），以及后台概览的「活动介绍」卡片（显示全文）。
        支持与规则页相同的 Markdown 语法。
      </p>
      <div class="field">
        <label>标题</label>
        <input type="text" id="intro-title" value="${esc(intro?.title || "活动介绍")}" />
      </div>
      <div class="field">
        <label>正文</label>
        <textarea id="intro-body" style="min-height:200px">${esc(intro?.body || "")}</textarea>
        <div class="hint">第一段会被截成首页那一句导语，建议写 60–90 字能独立成句的话。</div>
      </div>
      <div class="row row-wrap" style="gap:10px">
        <button class="btn btn-primary" id="btn-save-intro">保存并立即生效</button>
        <a class="btn btn-ghost" href="#/home" target="_blank" rel="noopener">预览首页</a>
      </div>
    </div>

    <div class="card block">
      <div class="card-head"><h2>登录页说明</h2>
        <span class="card-note">${login ? "更新于 " + esc(fmtFull(login.updated_at)) : "使用默认文案"}</span>
      </div>
      <p class="small muted" style="margin-bottom:16px">
        显示在登录卡片下方，用于说明本站的账号规则、登录方式或注意事项。支持简单的 Markdown：<span class="mono tiny">**加粗**</span>、<span class="mono tiny">- 列表</span>、<span class="mono tiny">换行即分段</span>。留空则回退到内置文案。
      </p>
      <div class="field">
        <label>正文</label>
        <textarea id="login-body" style="min-height:130px">${esc(login?.body || "")}</textarea>
        <div class="hint">赛前写给参赛者看的短说明即可，建议 40–120 字。</div>
      </div>
      <div class="row row-wrap" style="gap:10px">
        <button class="btn btn-primary" id="btn-save-login">保存并立即生效</button>
        <a class="btn btn-ghost" href="#/login" target="_blank" rel="noopener">预览登录页</a>
      </div>
    </div>

    <div class="card block">
      <div class="card-head"><h2>活动规则</h2>
        <span class="card-note">${rules ? "更新于 " + esc(fmtFull(rules.updated_at)) : "未初始化"}</span>
      </div>
      <p class="small muted" style="margin-bottom:16px">这里是前台「规则」页的正文。支持简单的 Markdown：<span class="mono tiny">## 二级标题</span>、<span class="mono tiny">### 三级标题</span>、<span class="mono tiny">- 列表</span>、<span class="mono tiny">**加粗**</span>、<span class="mono tiny">\`代码\`</span>。保存后立即生效，无需重新部署。</p>
      <div class="field">
        <label>页面标题</label>
        <input type="text" id="doc-title" value="${esc(rules?.title || "活动规则")}" />
      </div>
      <div class="field">
        <label>正文</label>
        <textarea id="doc-body" style="min-height:420px;font-family:var(--mono);font-size:12.5px;line-height:1.75">${esc(rules?.body || "")}</textarea>
        <div class="hint">每个 <span class="mono">## 标题</span> 会自动出现在左侧目录中。</div>
      </div>
      <div class="row row-wrap" style="gap:10px">
        <button class="btn btn-primary" id="btn-save-doc">保存并立即生效</button>
        <a class="btn btn-ghost" href="#/rules" target="_blank" rel="noopener">预览前台页面</a>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>《诚信比赛公约》</h2><span class="card-note">不在此处编辑</span></div>
      <p class="small muted" style="margin-bottom:10px">公约每份签署都绑定了<b>文本哈希</b>。如果允许在后台直接改文本，已签署记录的哈希会对不上，"签的是哪一版"就失去凭证意义。</p>
      <p class="small muted" style="margin:0">公约如需修订，走版本升级：改代码中的文本、把版本号从 v1.0 提到 v1.1，再重新部署。届时所有人需要重新签署，旧记录仍然保留可查。</p>
    </div>`;
}

/* ------------------------------ 组织单位 ------------------------------ */

function monogram(name) {
  const s = String(name || "").trim();
  if (!s) return "·";
  if (/^[\x00-\x7F]+$/.test(s)) {
    return s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  }
  return s.slice(0, 2);
}

function partnersTab(partners) {
  const rows = (partners || []).slice().sort((a, b) => (a.sort || 100) - (b.sort || 100));
  return `
    <div class="card block">
      <div class="card-head"><h2>组织单位</h2><span class="card-note">显示在首页「组织单位」</span></div>
      <p class="small muted" style="margin-bottom:14px">
        按类型分组展示：主办 / 协办 / 支持。不填 Logo 时用单位名称生成文字标；一个单位都没有时，首页整块不显示。
      </p>
      <div class="row row-wrap" style="gap:10px">
        <button class="btn btn-primary" id="btn-add-partner">+ 添加单位</button>
        <a class="btn btn-ghost" href="#/home" target="_blank" rel="noopener">预览首页</a>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>已添加</h2><span class="card-note">${rows.length} 个</span></div>
      ${
        rows.length
          ? rows
              .map(
                (p) => `
        <div class="org-admin-row">
          <span class="org-logo sm">${
            p.logo_url
              ? `<img src="${esc(p.logo_url)}" alt="" />`
              : `<b>${esc(monogram(p.name))}</b>`
          }</span>
          <div style="min-width:0;flex:1">
            <div class="strong" style="font-size:13.5px">${esc(p.name)}</div>
            <div class="tiny dim">${esc(partnerRoleOf(p.role).name)}${
                  p.note ? " · " + esc(p.note) : ""
                }${p.site_url ? " · " + esc(p.site_url) : ""}</div>
          </div>
          <span class="mono tiny dim">${esc(String(p.sort ?? 100))}</span>
          <button class="btn btn-sm" data-edit-partner="${p.id}">编辑</button>
          <button class="btn btn-sm btn-ghost" data-del-partner="${p.id}">删除</button>
        </div>`
              )
              .join("")
          : `<div class="empty" style="padding:26px">还没有单位，点上方「+ 添加单位」</div>`
      }
    </div>`;
}

function openPartnerForm(el, existing) {
  const p = existing || {};
  const m = modal(
    `<h3>${existing ? "编辑单位" : "添加单位"}</h3>
     <div class="grid grid-2" style="margin-top:14px">
       <div class="field"><label class="req">单位名称</label>
         <input id="pf-name" value="${esc(p.name || "")}" placeholder="如：像素松组委会" maxlength="40" /></div>
       <div class="field"><label>类型</label>
         <select id="pf-role">
           ${PARTNER_ROLES.map(
             (r) => `<option value="${r.key}" ${p.role === r.key ? "selected" : ""}>${esc(r.name)}</option>`
           ).join("")}
         </select></div>
     </div>
     <div class="grid grid-2">
       <div class="field"><label>Logo 图片地址</label>
         <input id="pf-logo" value="${esc(p.logo_url || "")}" placeholder="https://…（留空用文字标）" /></div>
       <div class="field"><label>官网 / 主页</label>
         <input id="pf-site" value="${esc(p.site_url || "")}" placeholder="https://…" /></div>
     </div>
     <div class="grid grid-2">
       <div class="field"><label>一句话说明</label>
         <input id="pf-note" value="${esc(p.note || "")}" placeholder="如：提供赛事服务器与技术支持" maxlength="40" /></div>
       <div class="field"><label>排序</label>
         <input id="pf-sort" type="number" value="${esc(String(p.sort ?? 100))}" />
         <div class="hint">数字小的排前面</div></div>
     </div>
     <div class="row" style="justify-content:flex-end;gap:9px;margin-top:16px">
       <button class="btn btn-ghost" data-x="cancel">取消</button>
       <button class="btn btn-primary" data-x="save">${existing ? "保存" : "添加"}</button>
     </div>`,
    {
      onMount(host) {
        const btn = host.querySelector('[data-x="save"]');
        host.querySelector('[data-x="cancel"]').onclick = () => m.close();
        btn.onclick = async () => {
          const name = host.querySelector("#pf-name").value.trim();
          if (!name) return toast("请填写单位名称", "err");
          busy(btn, true, "保存中…");
          try {
            await savePartner({
              id: p.id,
              name,
              role: host.querySelector("#pf-role").value,
              logoUrl: host.querySelector("#pf-logo").value,
              siteUrl: host.querySelector("#pf-site").value,
              note: host.querySelector("#pf-note").value,
              sort: host.querySelector("#pf-sort").value,
            });
            m.close();
            toast(existing ? "已保存" : "已添加", "ok");
            adminView(el, "#/admin/partners");
          } catch (e) {
            toast(errMsg(e), "err");
            busy(btn, false);
          }
        };
      },
    }
  );
}

/* ------------------------------ 赞助者 ------------------------------ */

function sponsorsTab(sponsors) {
  const rows = (sponsors || []).slice().sort((a, b) => {
    const amt = (Number(b.amount) || 0) - (Number(a.amount) || 0);
    return amt || (a.sort || 100) - (b.sort || 100);
  });
  const total = rows.reduce((n, s) => n + (Number(s.amount) || 0), 0);
  const shown = rows.filter((s) => s.show_amount).length;

  return `
    <div class="card block">
      <div class="card-head"><h2>赞助者</h2><span class="card-note">显示在 #/sponsors</span></div>
      <p class="small muted" style="margin-bottom:14px">
        这里录入的是公开鸣谢名单，首页「鸣谢」入口与捐助卡片都能进。金额用于自动分档与排序，
        默认不对访客公开；勾选「公开金额」才会在页面上显示。
      </p>
      <div class="grid grid-3" style="margin-bottom:16px">
        <div class="stat"><div class="stat-label">支持者</div><div class="stat-value">${rows.length}</div></div>
        <div class="stat"><div class="stat-label">累计支持</div><div class="stat-value">¥ ${esc(
          total.toLocaleString("zh-CN", { maximumFractionDigits: 2 })
        )}</div></div>
        <div class="stat"><div class="stat-label">公开金额</div><div class="stat-value">${shown}<small>/ ${rows.length}</small></div></div>
      </div>
      <div class="row row-wrap" style="gap:10px">
        <button class="btn btn-primary" id="btn-add-sponsor">+ 添加赞助者</button>
        <a class="btn btn-ghost" href="#/sponsors" target="_blank" rel="noopener">预览鸣谢页</a>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>名单</h2><span class="card-note">${rows.length} 位</span></div>
      ${
        rows.length
          ? rows
              .map(
                (s) => `
        <div class="org-admin-row">
          <span class="org-logo sm">${
            s.avatar_url ? `<img src="${esc(s.avatar_url)}" alt="" />` : `<b>${esc(monogram(s.name))}</b>`
          }</span>
          <div style="min-width:0;flex:1">
            <div class="strong" style="font-size:13.5px">
              ${esc(s.name)}
              ${
                Number(s.amount) > 0
                  ? `<span class="tag" style="margin-left:6px">¥ ${esc(
                      Number(s.amount).toLocaleString("zh-CN", { maximumFractionDigits: 2 })
                    )}${s.show_amount ? "" : " · 不公开"}</span>`
                  : `<span class="tag" style="margin-left:6px">未填金额</span>`
              }
            </div>
            <div class="tiny dim">${esc(fmtDate(s.created_at))}${
                  s.message ? " · " + esc(s.message) : ""
                }</div>
          </div>
          <span class="mono tiny dim">${esc(String(s.sort ?? 100))}</span>
          <button class="btn btn-sm" data-edit-sponsor="${s.id}">编辑</button>
          <button class="btn btn-sm btn-ghost" data-del-sponsor="${s.id}">删除</button>
        </div>`
              )
              .join("")
          : `<div class="empty" style="padding:26px">还没有赞助者，点上方「+ 添加赞助者」</div>`
      }
    </div>`;
}

function openSponsorForm(el, existing) {
  const s = existing || {};
  const m = modal(
    `<h3>${existing ? "编辑赞助者" : "添加赞助者"}</h3>
     <div class="grid grid-2" style="margin-top:14px">
       <div class="field"><label class="req">称呼</label>
         <input id="sf-name" value="${esc(s.name || "")}" placeholder="如：初九 / 匿名支持者" maxlength="40" />
         <div class="hint">会原样展示在鸣谢页；需要匿名就填「匿名支持者」</div></div>
       <div class="field"><label>支持金额（元）</label>
         <input id="sf-amount" type="number" min="0" step="0.01" value="${esc(
           s.amount == null ? "" : String(s.amount)
         )}" placeholder="可不填" />
         <div class="hint">≥200 特别鸣谢，≥50 热心支持，其余同行者；档位会展示，金额默认不公开</div></div>
     </div>
     <div class="field"><label>留言</label>
       <input id="sf-msg" value="${esc(s.message || "")}" placeholder="一句想说的话，可留空" maxlength="120" /></div>
     <div class="grid grid-2">
       <div class="field"><label>头像地址</label>
         <input id="sf-avatar" value="${esc(s.avatar_url || "")}" placeholder="https://…（留空用文字标）" /></div>
       <div class="field"><label>排序</label>
         <input id="sf-sort" type="number" value="${esc(String(s.sort ?? 100))}" />
         <div class="hint">同档位内数字小的排前面</div></div>
     </div>
     <label class="row" style="gap:8px;cursor:pointer;margin-top:4px">
       <input type="checkbox" id="sf-show" ${s.show_amount ? "checked" : ""} />
       <span class="small">在鸣谢页公开这笔金额</span>
     </label>
     <div class="row" style="justify-content:flex-end;gap:9px;margin-top:16px">
       <button class="btn btn-ghost" data-x="cancel">取消</button>
       <button class="btn btn-primary" data-x="save">${existing ? "保存" : "添加"}</button>
     </div>`,
    {
      onMount(host) {
        const btn = host.querySelector('[data-x="save"]');
        host.querySelector('[data-x="cancel"]').onclick = () => m.close();
        btn.onclick = async () => {
          const name = host.querySelector("#sf-name").value.trim();
          if (!name) return toast("请填写赞助者称呼", "err");
          busy(btn, true, "保存中…");
          try {
            await saveSponsor({
              id: s.id,
              name,
              amount: host.querySelector("#sf-amount").value,
              message: host.querySelector("#sf-msg").value,
              avatarUrl: host.querySelector("#sf-avatar").value,
              showAmount: host.querySelector("#sf-show").checked,
              sort: host.querySelector("#sf-sort").value,
            });
            m.close();
            toast(existing ? "已保存" : "已添加", "ok");
            adminView(el, "#/admin/sponsors");
          } catch (e) {
            toast(errMsg(e), "err");
            busy(btn, false);
          }
        };
      },
    }
  );
}

/* ------------------------------ 评委团队 ------------------------------ */

function judgesTab(judges, sigs, certs) {
  const rows = (judges || []).slice().sort((a, b) => (a.sort || 100) - (b.sort || 100));
  const signed = (sigs || []).filter((x) => x.doc_key === "judge");
  const judgeCerts = (certs || []).filter((c) => c.award_key === "judge");
  const certOf = (j) => judgeCerts.find((c) => c.owner_id === `judge:${j.id}`);
  return `
    <div class="card block">
      <div class="card-head"><h2>评委团队</h2><span class="card-note">前台 #/judges</span></div>
      <p class="small muted" style="margin-bottom:14px">
        这里录入的是<b>公开展示</b>的评委资料。它和「系统 → 角色管理」里的评委权限是两件事：
        前者决定前台名单长什么样，后者决定账号能不能打分。
      </p>
      <div class="row row-wrap" style="gap:10px">
        <button class="btn btn-primary" id="btn-add-judge">+ 添加评委</button>
        <a class="btn btn-ghost" href="#/judges" target="_blank" rel="noopener">预览前台</a>
      </div>
    </div>

    <div class="card block">
      <div class="card-head"><h2>已录入</h2><span class="card-note">${rows.length} 位</span></div>
      ${
        rows.length
          ? rows
              .map(
                (j) => `
        <div class="org-admin-row">
          <span class="org-logo sm">${
            j.avatar_url ? `<img src="${esc(j.avatar_url)}" alt="" />` : `<b>${esc(monogram(j.name).slice(0, 1))}</b>`
          }</span>
          <div style="min-width:0;flex:1">
            <div class="strong" style="font-size:13.5px">
              ${esc(j.name)}
              ${j.published ? "" : '<span class="tag" style="margin-left:6px">未公开</span>'}
            </div>
            <div class="tiny dim">${esc([j.title, j.org].filter(Boolean).join(" · ") || "—")}${
                  j.tracks ? " · 赛道 " + esc(j.tracks) : ""
                }</div>
          </div>
          <span class="mono tiny dim">${esc(String(j.sort ?? 100))}</span>
          ${
            certOf(j)
              ? `<a class="btn btn-sm btn-ghost" href="#/certificate/${encodeURIComponent(certOf(j).cert_code)}" target="_blank" rel="noopener">查看证书</a>`
              : `<button class="btn btn-sm" data-issue-judge="${j.id}">颁发证书</button>`
          }
          <button class="btn btn-sm" data-edit-judge="${j.id}">编辑</button>
          <button class="btn btn-sm btn-ghost" data-del-judge="${j.id}">删除</button>
        </div>`
              )
              .join("")
          : `<div class="empty" style="padding:26px">还没有录入评委，点上方「+ 添加评委」</div>`
      }
    </div>

    <div class="card">
      <div class="card-head"><h2>评委公约签署</h2><span class="card-note">${signed.length} 位已签</span></div>
      ${
        signed.length
          ? `<div class="tbl-wrap"><table class="tbl">
              <thead><tr><th>署名</th><th>版本</th><th>签署时间</th></tr></thead>
              <tbody>${signed
                .map(
                  (x) => `<tr>
                    <td class="strong">${esc(x.agreed_name || "—")}</td>
                    <td class="mono tiny">${esc(x.doc_version)}</td>
                    <td class="mono tiny dim">${esc(fmtFull(x.created_at))}</td>
                  </tr>`
                )
                .join("")}</tbody></table></div>`
          : `<p class="small dim" style="margin:0">还没有评委签署公约。未签署的账号在「评审」页会被拦下，无法打分。</p>`
      }
    </div>`;
}

function openJudgeForm(el, existing) {
  const j = existing || {};
  const picked = String(j.tracks || "").toUpperCase();
  const m = modal(
    `<h3>${existing ? "编辑评委" : "添加评委"}</h3>
     <div class="grid grid-2" style="margin-top:14px">
       <div class="field"><label class="req">姓名</label>
         <input id="jf-name" value="${esc(j.name || "")}" maxlength="20" placeholder="如：李维" /></div>
       <div class="field"><label>职称 / 头衔</label>
         <input id="jf-title" value="${esc(j.title || "")}" maxlength="30" placeholder="如：模组作者" /></div>
     </div>
     <div class="grid grid-2">
       <div class="field"><label>所属机构</label>
         <input id="jf-org" value="${esc(j.org || "")}" maxlength="40" placeholder="如：某社区 / 独立开发者" /></div>
       <div class="field"><label>头像地址</label>
         <input id="jf-ava" value="${esc(j.avatar_url || "")}" placeholder="https://…（留空用姓氏字标）" /></div>
     </div>
     <div class="field"><label>负责赛道</label>
       <div class="row row-wrap" style="gap:14px">
         ${TRACKS.map(
           (t) => `<label class="row" style="gap:6px;cursor:pointer">
             <input type="checkbox" class="jf-track" value="${t.code}" ${picked.includes(t.code) ? "checked" : ""} />
             <span class="small">${t.code} · ${esc(t.name)}</span>
           </label>`
         ).join("")}
       </div>
       <div class="hint">不选表示全赛道</div>
     </div>
     <div class="field"><label>简介</label>
       <textarea id="jf-bio" maxlength="200" placeholder="一句话介绍评审背景，会显示在公开页">${esc(j.bio || "")}</textarea></div>
     <div class="grid grid-2">
       <div class="field"><label>排序</label>
         <input id="jf-sort" type="number" value="${esc(String(j.sort ?? 100))}" />
         <div class="hint">数字小的排前面</div></div>
       <div class="field"><label>公开</label>
         <label class="row" style="gap:8px;cursor:pointer;margin-top:8px">
           <input type="checkbox" id="jf-pub" ${j.published === false ? "" : "checked"} />
           <span class="small">在前台评委团展示</span>
         </label></div>
     </div>
     <div class="row" style="justify-content:flex-end;gap:9px;margin-top:16px">
       <button class="btn btn-ghost" data-x="cancel">取消</button>
       <button class="btn btn-primary" data-x="save">${existing ? "保存" : "添加"}</button>
     </div>`,
    {
      onMount(host) {
        const btn = host.querySelector('[data-x="save"]');
        host.querySelector('[data-x="cancel"]').onclick = () => m.close();
        btn.onclick = async () => {
          const name = host.querySelector("#jf-name").value.trim();
          if (!name) return toast("请填写评委姓名", "err");
          const tracks = [...host.querySelectorAll(".jf-track")]
            .filter((c) => c.checked)
            .map((c) => c.value)
            .join(",");
          busy(btn, true, "保存中…");
          try {
            await saveJudge({
              id: j.id,
              name,
              title: host.querySelector("#jf-title").value,
              org: host.querySelector("#jf-org").value,
              avatarUrl: host.querySelector("#jf-ava").value,
              bio: host.querySelector("#jf-bio").value,
              tracks,
              sort: host.querySelector("#jf-sort").value,
              published: host.querySelector("#jf-pub").checked,
            });
            m.close();
            toast(existing ? "已保存" : "已添加", "ok");
            adminView(el, "#/admin/judges");
          } catch (e) {
            toast(errMsg(e), "err");
            busy(btn, false);
          }
        };
      },
    }
  );
}

/* ------------------------------ 证书 ------------------------------ */

function certsTab(subs, teams, members, certs) {
  const eligible = subs.filter((s) => s.status === "passed" || s.status === "public");
  const teamName = (id) => (teams.find((t) => t.id === id) || {}).name || "—";
  const sizeOf = (id) => members.filter((m) => m.team_id === id).length;

  return `
    <div class="card block">
      <div class="card-head"><h2>颁发证书</h2><span class="card-note">按作品发给全队成员</span></div>
      ${
        eligible.length
          ? `<div class="field">
              <label class="req">作品</label>
              <select id="cert-sub">
                ${eligible
                  .map(
                    (s) =>
                      `<option value="${s.id}">[${esc(s.track)}] ${esc(s.title)} · ${esc(teamName(s.team_id))} · ${sizeOf(s.team_id)} 人</option>`
                  )
                  .join("")}
              </select>
            </div>
            <div class="grid grid-2">
              <div class="field">
                <label>奖项</label>
                <select id="cert-award">
                  ${AWARDS.map((a) => `<option value="${a.key}">${esc(a.name)}</option>`).join("")}
                </select>
              </div>
              <div class="field">
                <label>证书上显示的奖项名称</label>
                <input type="text" id="cert-award-name" placeholder="如「最佳创意」，留空则用左侧奖项名" />
              </div>
            </div>
            <button class="btn btn-primary" id="btn-issue">为全体成员颁发</button>
            <p class="tiny dim" style="margin-top:8px">同一作品同一奖项重复颁发会自动跳过，不会生成重复证书。</p>`
          : `<div class="empty">还没有「通过」或「已公示」的作品，先到「作品」里做兼容性检查</div>`
      }
    </div>

    <div class="card">
      <div class="card-head"><h2>已颁发</h2><span class="card-note">${certs.length} 张</span></div>
      ${
        certs.length
          ? `<div class="tbl-wrap"><table class="tbl">
              <thead><tr><th>持证人</th><th>作品</th><th>奖项</th><th>编号</th><th>时间</th><th class="right">操作</th></tr></thead>
              <tbody>${certs
                .map(
                  (c) => `<tr>
                    <td class="strong">${esc(c.holder_name)}</td>
                    <td class="small">${esc(c.work_title)}<div class="tiny dim">${esc(c.team_name || "")}</div></td>
                    <td><span class="tag ${c.award_key === "participant" ? "" : "tag-teal"}">${esc(c.award_name)}</span></td>
                    <td class="mono tiny">${esc(c.cert_code)}</td>
                    <td class="mono tiny dim">${esc(fmtDate(c.issued_at))}</td>
                    <td class="right"><button class="btn btn-sm btn-danger" data-revoke="${c.id}">撤销</button></td>
                  </tr>`
                )
                .join("")}</tbody>
            </table></div>`
          : '<p class="small dim" style="margin:0">还没有颁发任何证书</p>'
      }
    </div>`;
}

/* ------------------------------ 站点设置 ------------------------------ */

function secretHint(has, text) {
  return has
    ? `<div class="hint">已保存。留空表示不修改；勾选右侧「清除」可删除。</div>`
    : `<div class="hint">${text}</div>`;
}

function settingsTab(cfg, auth) {
  const mode = (auth && auth.mode) || (cfg ? "local" : "cloud");
  if (mode !== "local" || !cfg) {
    return `
      <div class="card block">
        <div class="card-head"><h2>站点设置</h2><span class="card-note">云端模式</span></div>
        <p class="small muted" style="margin:0">当前实例连接托管云服务，邮件、人机验证与病毒扫描由环境变量配置。切到 <span class="mono">PS_MODE=local</span> 后，这些项会出现在这里。</p>
      </div>`;
  }

  const smtp = cfg.smtp || {};
  const gt = cfg.geetest || {};
  const vt = cfg.virustotal || {};
  const ck = cfg.cnkd || {};
  const dn = cfg.donate || {};
  // 给极验控制台的填写示例，直接用当前访问地址生成，避免填错
  const siteOrigin = typeof location !== "undefined" ? location.origin : "https://你的域名";
  const siteHost = typeof location !== "undefined" ? location.hostname : "你的域名";

  return `
    <div class="card block">
      <div class="card-head">
        <h2>邮箱服务（SMTP）</h2>
        <span class="card-note">${smtp.enabled ? "已开启" : "未开启"}</span>
      </div>
      <p class="small muted" style="margin-bottom:16px">
        开启后登录页会出现「验证码登录」，注册与找回密码都走邮件。填写邮箱服务商提供的 SMTP 地址与授权码即可，不需要额外部署邮件服务器。
      </p>

      <label class="row" style="gap:9px;cursor:pointer;margin-bottom:16px">
        <input type="checkbox" id="st-enabled" ${smtp.enabled ? "checked" : ""} />
        <span class="small">开启邮箱验证码登录</span>
      </label>

      <div class="grid grid-2">
        <div class="field"><label>SMTP 服务器</label>
          <input id="st-host" value="${esc(smtp.host || "")}" placeholder="smtp.example.com" /></div>
        <div class="field"><label>端口</label>
          <input id="st-port" type="number" value="${esc(String(smtp.port || 465))}" placeholder="465 / 587" /></div>
      </div>
      <div class="grid grid-2">
        <div class="field"><label>账号</label>
          <input id="st-user" value="${esc(smtp.user || "")}" placeholder="noreply@example.com" autocomplete="off" /></div>
        <div class="field"><label>密码 / 授权码</label>
          <input id="st-pass" type="password" placeholder="${smtp.hasPass ? "已保存，留空不修改" : "邮箱授权码"}" autocomplete="new-password" />
          ${secretHint(smtp.hasPass, "不是登录密码，是邮箱服务商生成的 SMTP 授权码")}
        </div>
      </div>
      <div class="row row-wrap" style="gap:18px;margin-bottom:12px">
        <label class="row" style="gap:7px;cursor:pointer">
          <input type="checkbox" id="st-secure" ${smtp.secure !== false ? "checked" : ""} />
          <span class="small">SSL（465）</span>
        </label>
        <label class="row" style="gap:7px;cursor:pointer">
          <input type="checkbox" id="st-starttls" ${smtp.starttls !== false ? "checked" : ""} />
          <span class="small">STARTTLS（587）</span>
        </label>
        ${smtp.hasPass ? `<label class="row" style="gap:7px;cursor:pointer"><input type="checkbox" id="st-clear-pass" /><span class="small">清除已保存的密码</span></label>` : ""}
      </div>
      <div class="grid grid-2">
        <div class="field"><label>发件人名称</label>
          <input id="st-from-name" value="${esc(smtp.fromName || "像素松")}" /></div>
        <div class="field"><label>发件人邮箱</label>
          <input id="st-from-email" value="${esc(smtp.fromEmail || "")}" placeholder="留空则用账号" /></div>
      </div>
      <div class="divider"></div>
      <div class="row row-wrap" style="gap:10px;align-items:flex-end">
        <div class="field" style="flex:1;min-width:220px;margin:0">
          <label>测试发送</label>
          <input id="st-test-to" placeholder="收件邮箱，例如你自己的工作邮箱" />
        </div>
        <button class="btn" id="btn-test-mail" type="button">发送测试邮件</button>
      </div>
      <p class="tiny dim" style="margin-top:8px">先保存再测试：测试用的是已保存的配置。</p>
    </div>

    <div class="card block">
      <div class="card-head">
        <h2>人机验证</h2>
        <span class="card-note">${gt.enabled ? "已开启" : "未开启"}</span>
      </div>
      <p class="small muted" style="margin-bottom:16px">
        接极验行为验证 4.0。未开启时不做人机校验，登录仅靠频率限制兜底。密钥只存服务端，不会下发到浏览器。
      </p>
      <label class="row" style="gap:9px;cursor:pointer;margin-bottom:16px">
        <input type="checkbox" id="gt-enabled" ${gt.enabled ? "checked" : ""} />
        <span class="small">开启人机验证</span>
      </label>
      <div class="grid grid-2">
        <div class="field"><label>Captcha ID</label>
          <input id="gt-id" value="${esc(gt.captchaId || "")}" placeholder="从 console.geetest.com 获取" /></div>
        <div class="field"><label>Captcha Key</label>
          <input id="gt-key" type="password" placeholder="${gt.hasKey ? "已保存，留空不修改" : "仅服务端使用"}" autocomplete="new-password" />
          ${secretHint(gt.hasKey, "极验控制台里的 Key，不要泄露")}
        </div>
      </div>
      ${gt.hasKey ? `<label class="row" style="gap:7px;cursor:pointer"><input type="checkbox" id="gt-clear" /><span class="small">清除已保存的 Key</span></label>` : ""}
      <div class="hint" style="margin-top:12px;line-height:1.9">
        极验控制台里这样填：<br />
        · 新增业务场景时，<b>客户端类型必须选 Web / Wap</b>，否则拿到的 ID 在网页上用不了<br />
        · 「接入页面地址」填 <span class="mono">${esc(siteOrigin)}/#/login</span><br />
        · 有「域名白名单」的话，填 <span class="mono">${esc(siteHost)}</span>（不带协议和端口）<br />
        · 用 <span class="mono">IP:端口</span> 访问通常不被极验接受，建议先绑域名；只想先跑通可暂时关掉本项
      </div>
    </div>

    <div class="card block">
      <div class="card-head">
        <h2>CNKD 一证通行</h2>
        <span class="card-note">${ck.enabled ? "已开启" : "未开启"}</span>
      </div>
      <p class="small muted" style="margin-bottom:16px">
        开启并填好客户端 ID 后，登录页会出现「CNKD 一证通行」按钮。授权地址由服务端发起，Secret 只存服务端、不会下发到浏览器。
      </p>
      <label class="row" style="gap:9px;cursor:pointer;margin-bottom:16px">
        <input type="checkbox" id="ck-enabled" ${ck.enabled ? "checked" : ""} />
        <span class="small">开启 CNKD 登录</span>
      </label>
      <div class="grid grid-2">
        <div class="field"><label>Client ID</label>
          <input id="ck-id" value="${esc(ck.clientId || "")}" placeholder="CNKD 平台分配的应用 ID" /></div>
        <div class="field"><label>Client Secret</label>
          <input id="ck-secret" type="password" placeholder="${ck.hasSecret ? "已保存，留空不修改" : "公开应用可留空"}" autocomplete="new-password" />
          ${secretHint(ck.hasSecret, "保密应用才需要；公开应用走 PKCE，留空即可")}
        </div>
      </div>
      <div class="field"><label>回调地址</label>
        <input id="ck-redirect" value="${esc(ck.redirectUri || "")}" placeholder="留空则自动使用 当前域名/api/cnkd/callback" />
        <div class="hint">需与 CNKD 平台登记值逐字一致。留空时按当前访问域名自动生成，换域名不必改配置。</div>
      </div>
      ${ck.hasSecret ? `<label class="row" style="gap:7px;cursor:pointer"><input type="checkbox" id="ck-clear" /><span class="small">清除已保存的 Secret</span></label>` : ""}
    </div>

    <div class="card block">
      <div class="card-head">
        <h2>捐助渠道</h2>
        <span class="card-note">${dn.enabled ? "已开启" : "未开启"}</span>
      </div>
      <p class="small muted" style="margin-bottom:16px">
        活动本身不收费。开启后，首页底部会出现一个低调的「支持像素松」入口，跳转到你的爱发电主页，
        可注明用途（服务器、域名等）。不填写链接时不会显示。
      </p>
      <label class="row" style="gap:9px;cursor:pointer;margin-bottom:16px">
        <input type="checkbox" id="dn-enabled" ${dn.enabled ? "checked" : ""} />
        <span class="small">在首页显示支持入口</span>
      </label>
      <div class="field"><label>爱发电主页链接</label>
        <input id="dn-url" value="${esc(dn.url || "")}" placeholder="https://afdian.com/a/yourname" />
        <div class="hint">只接受 https://afdian.com 或 afdian.net 下的地址，其他链接不会生效</div>
      </div>
      <div class="grid grid-2">
        <div class="field"><label>卡片标题</label>
          <input id="dn-title" value="${esc(dn.title || "")}" maxlength="16" placeholder="支持像素松" />
          <div class="hint">留空则用默认标题</div>
        </div>
        <div class="field"><label>一句说明</label>
          <input id="dn-note" value="${esc(dn.note || "")}" maxlength="60" placeholder="例：用于服务器与域名续费" />
        </div>
      </div>
    </div>

    <div class="card block">
      <div class="card-head">
        <h2>病毒扫描</h2>
        <span class="card-note">${vt.enabled ? "已开启" : "未开启"}</span>
      </div>
      <p class="small muted" style="margin-bottom:16px">
        按 SHA-256 查询 VirusTotal 已有报告，不上传作品包。未开启时提交页只显示「扫描未启用」，不影响提交。
      </p>
      <label class="row" style="gap:9px;cursor:pointer;margin-bottom:16px">
        <input type="checkbox" id="vt-enabled" ${vt.enabled ? "checked" : ""} />
        <span class="small">开启病毒扫描</span>
      </label>
      <div class="field"><label>VirusTotal API Key</label>
        <input id="vt-key" type="password" placeholder="${vt.hasKey ? "已保存，留空不修改" : "virustotal.com 免费 key"}" autocomplete="new-password" />
        ${secretHint(vt.hasKey, "免费版限速 4 次/分钟，服务端已做缓存")}
      </div>
      ${vt.hasKey ? `<label class="row" style="gap:7px;cursor:pointer"><input type="checkbox" id="vt-clear" /><span class="small">清除已保存的 Key</span></label>` : ""}
    </div>

    <div class="row row-wrap" style="gap:10px">
      <button class="btn btn-primary" id="btn-save-settings">保存设置</button>
      <span class="tiny dim">保存后立即生效，无需重启容器。</span>
    </div>`;
}

/* ------------------------------ 系统 ------------------------------ */

function systemTab(health, profiles) {
  const staff = profiles.filter((p) => p.role !== "participant");
  return `
    <div class="card block">
      <div class="card-head"><h2>服务状态</h2><span class="card-note">部署自检</span></div>
      ${health ? `<div class="tbl-wrap"><table class="tbl">
        <tbody>
          <tr><td class="small muted">版本</td><td class="mono">v${esc(health.version)}</td></tr>
          <tr><td class="small muted">Node</td><td class="mono">${esc(health.node)}</td></tr>
          <tr><td class="small muted">运行时长</td><td class="mono">${Math.floor((health.uptimeSec || 0) / 60)} 分钟</td></tr>
          <tr><td class="small muted">人机验证</td><td>${health.geetest?.enabled
            ? '<span class="tag tag-teal">已启用</span>'
            : '<span class="tag tag-amber">未配置</span><span class="tiny dim" style="margin-left:8px">设置 GEETEST_CAPTCHA_ID / KEY 后重启</span>'}</td></tr>
          <tr><td class="small muted">.env 文件</td><td class="mono tiny">${health.checks?.envFile ? "已加载" : "未使用"}</td></tr>
        </tbody>
      </table></div>` : `<p class="small" style="color:var(--red);margin:0">/api/health 不可达 —— 当前很可能仍在运行静态版本，部署形态未切换。</p>`}
    </div>

    <div class="card block">
      <div class="card-head"><h2>角色管理</h2><span class="card-note">共 ${profiles.length} 个账号</span></div>
      ${profiles.length ? `<div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>昵称</th><th>角色</th><th class="right">调整</th></tr></thead>
        <tbody>${profiles.map((p) => `<tr>
          <td>${esc(p.nickname || p.owner_name || "未命名")}<div class="mono tiny dim">${esc((p.owner_id || "").slice(0, 12))}</div></td>
          <td><span class="tag ${p.role === "admin" ? "tag-teal" : p.role === "judge" ? "tag-blue" : ""}">${esc(ROLE_TEXT[p.role] || p.role)}</span></td>
          <td class="right nowrap">
            <select data-role-for="${esc(p.owner_id)}" style="max-width:120px;display:inline-block">
              <option value="participant" ${p.role === "participant" ? "selected" : ""}>参赛者</option>
              <option value="judge" ${p.role === "judge" ? "selected" : ""}>评委</option>
              <option value="admin" ${p.role === "admin" ? "selected" : ""}>主办方</option>
            </select>
          </td>
        </tr>`).join("")}</tbody>
      </table></div>
      <p class="tiny dim" style="margin-top:10px">修改下拉框即生效。系统会阻止把最后一个主办方降级。</p>`
      : '<p class="small dim" style="margin:0">暂无账号</p>'}
    </div>

    <div class="card block">
      <div class="card-head"><h2>活动配置</h2><span class="card-note">改动立即对前台生效</span></div>
      <div class="grid grid-2">
        <div class="field"><label>主题</label><input type="text" id="c-theme" value="${esc(state.activity?.theme || "")}" /></div>
        <div class="field"><label>地点 / 形式</label><input type="text" id="c-venue" value="${esc(state.activity?.venue || "")}" /></div>
        <div class="field"><label>报名截止</label><input type="datetime-local" id="c-signup" value="${esc(toLocal(state.activity?.signupDeadline))}" /></div>
        <div class="field"><label>开幕 / 开始计时</label><input type="datetime-local" id="c-start" value="${esc(toLocal(state.activity?.eventStart))}" /></div>
        <div class="field"><label>提交截止</label><input type="datetime-local" id="c-submit" value="${esc(toLocal(state.activity?.submitDeadline))}" /></div>
        <div class="field"><label>评审截止</label><input type="datetime-local" id="c-judge" value="${esc(toLocal(state.activity?.judgeDeadline))}" /></div>
        <div class="field"><label>结果公示 / 颁奖</label><input type="datetime-local" id="c-road" value="${esc(toLocal(state.activity?.roadshowAt))}" /></div>
        <div class="field"><label>联系方式</label><input type="text" id="c-contact" value="${esc(state.activity?.contact || "")}" /></div>
      </div>
      <button class="btn btn-primary" id="btn-save-act">保存配置</button>
      <p class="tiny dim" style="margin-top:8px">提交截止改动会立即影响参赛者的提交权限，请确认后再保存。</p>
    </div>

    <div class="card">
      <div class="card-head"><h2>缓存</h2></div>
      <p class="small muted" style="margin-bottom:12px">前台对公告、作品列表做了短时缓存以减少查询。数据异常时可手动清空。</p>
      <button class="btn btn-sm" id="btn-clear-cache">清空前端缓存</button>
    </div>`;
}

/* ------------------------------ 事件 ------------------------------ */

function wireAdmin(el, ctx) {
  el.querySelectorAll("[data-team]").forEach((b) => {
    b.onclick = async () => {
      const st = b.dataset.st;
      let note = "";
      if (st === "rejected") {
        note = prompt("驳回原因（会展示给队长）") || "";
        if (!note) return;
      }
      try {
        await setTeamStatus(Number(b.dataset.team), st, note);
        toast("已更新", "ok");
        adminView(el, "#/admin/teams");
      } catch (e) { toast(errMsg(e), "err"); }
    };
  });

  el.querySelectorAll("[data-check]").forEach((b) => {
    b.onclick = () => {
      const s = ctx.subs.find((x) => x.id === Number(b.dataset.check));
      openCompatModal(s, () => adminView(el, "#/admin/works"));
    };
  });

  el.querySelectorAll("[data-vers]").forEach((b) => {
    b.onclick = async () => {
      const s = ctx.subs.find((x) => x.id === Number(b.dataset.vers));
      const list = await listVersions(s.id).catch(() => []);
      modal(`<h3>版本记录 · ${esc(s.title)}</h3>
        ${list.length ? `<div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>版本</th><th>时间</th><th>SHA-256</th><th>大小</th><th>说明</th></tr></thead>
          <tbody>${list.map((v) => `<tr>
            <td class="mono">v${v.version_no}</td>
            <td class="mono tiny">${esc(fmtFull(v.created_at))}</td>
            <td class="mono tiny dim">${v.sha256 ? esc(v.sha256.slice(0, 12)) + "…" : "—"}</td>
            <td class="tiny">${esc(v.pkg_size || "—")}</td>
            <td class="tiny">${esc(v.note || "—")}</td>
          </tr>`).join("")}</tbody></table></div>` : '<p class="small dim">没有历史快照</p>'}
        <div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn" onclick="this.closest('.modal-host').remove()">关闭</button></div>`);
    };
  });

  const assignBtn = el.querySelector("#btn-assign");
  if (assignBtn) {
    assignBtn.onclick = async (e) => {
      const track = val(el, "#a-track");
      const judgeUid = val(el, "#a-judge");
      if (!judgeUid) return toast("尚无评委账号", "err");
      const picked = ctx.subs.filter((s) => s.track === track && (s.status === "passed" || s.status === "submitted"));
      if (!picked.length) return toast("该赛道没有待评作品", "err");
      const judge = ctx.profiles.find((j) => j.owner_id === judgeUid);
      busy(e.currentTarget, true, "分配中…");
      try {
        await assignReviews(picked, [judge]);
        toast(`已分配 ${picked.length} 件`, "ok");
        adminView(el, "#/admin/review");
      } catch (err) { toast(errMsg(err), "err"); busy(e.currentTarget, false); }
    };
  }

  const pubBtn = el.querySelector("#btn-publish");
  if (pubBtn) {
    pubBtn.onclick = async () => {
      if (!(await confirmBox("公示作品", "所有状态为「通过」的作品将对所有人公开，作品包链接也会公开。确定吗？", "公示"))) return;
      try {
        const n = await publishResults();
        toast(`已公示 ${n} 件作品`, "ok");
        adminView(el, "#/admin/results");
      } catch (e) { toast(errMsg(e), "err"); }
    };
  }

  const annBtn = el.querySelector("#btn-announce");
  if (annBtn) {
    annBtn.onclick = async (e) => {
      const title = val(el, "#an-title");
      if (!title) return toast("请填写标题", "err");
      busy(e.currentTarget, true, "发布中…");
      try {
        await createAnnouncement(title, val(el, "#an-body"), checked(el, "#an-pin"));
        toast("公告已发布", "ok");
        adminView(el, "#/admin/notices");
      } catch (err) { toast(errMsg(err), "err"); busy(e.currentTarget, false); }
    };
  }

  el.querySelectorAll("[data-del]").forEach((b) => {
    b.onclick = async () => {
      if (!(await confirmBox("删除公告", "删除后不可恢复。", "删除"))) return;
      try { await deleteAnnouncement(Number(b.dataset.del)); toast("已删除", "ok"); adminView(el, "#/admin/notices"); }
      catch (e) { toast(errMsg(e), "err"); }
    };
  });

  el.querySelectorAll("[data-replybtn]").forEach((b) => {
    b.onclick = async () => {
      const id = Number(b.dataset.replybtn);
      const input = el.querySelector(`[data-reply="${id}"]`);
      if (!input || !input.value.trim()) return toast("请填写回复", "err");
      try { await replyAppeal(id, "replied", input.value.trim()); toast("已回复", "ok"); adminView(el, "#/admin/appeals"); }
      catch (e) { toast(errMsg(e), "err"); }
    };
  });

  el.querySelectorAll("[data-role-for]").forEach((sel) => {
    sel.onchange = async () => {
      const uid = sel.dataset.roleFor;
      const role = sel.value;
      const label = ROLE_TEXT[role];
      if (!(await confirmBox("调整角色", `将把该账号设为「${esc(label)}」，立即生效。`, "确认"))) {
        sel.value = ctx.profiles.find((p) => p.owner_id === uid)?.role || "participant";
        return;
      }
      try {
        await setUserRole(uid, role);
        toast("角色已更新", "ok");
        adminView(el, "#/admin/system");
      } catch (e) {
        toast(errMsg(e), "err");
        sel.value = ctx.profiles.find((p) => p.owner_id === uid)?.role || "participant";
      }
    };
  });

  const issueBtn = el.querySelector("#btn-issue");
  if (issueBtn) {
    issueBtn.onclick = async (ev) => {
      const subId = Number(val(el, "#cert-sub"));
      const sub = ctx.subs.find((s) => s.id === subId);
      if (!sub) return toast("请选择作品", "err");
      const awardKey = val(el, "#cert-award");
      const custom = val(el, "#cert-award-name");
      const awardName = custom || (AWARDS.find((a) => a.key === awardKey) || {}).name || awardKey;
      const team = ctx.teams.find((t) => t.id === sub.team_id);
      const holders = ctx.members
        .filter((m) => m.team_id === sub.team_id)
        .map((m) => ({ owner_id: m.owner_id, name: m.member_name }));
      if (!holders.length) return toast("该作品所属队伍没有成员记录", "err");

      const already = ctx.certs
        .filter((c) => c.submission_id === sub.id && c.award_key === awardKey)
        .map((c) => c.owner_id);
      const todo = holders.filter((h) => !already.includes(h.owner_id));
      if (!todo.length) return toast("该奖项已发给全部成员，无需重复颁发", "err");

      if (
        !(await confirmBox(
          "颁发证书",
          `将为《${esc(sub.title)}》的 <b>${todo.length}</b> 位成员颁发「${esc(awardName)}」，共 ${todo.length} 张证书。`,
          "颁发"
        ))
      )
        return;

      busy(ev.currentTarget, true, "颁发中…");
      try {
        const n = await issueCertificates({ ...sub, team_name: team?.name || null, team_kind: team?.kind || "team" }, todo, awardKey, awardName);
        toast(`已颁发 ${n} 张证书`, "ok");
        adminView(el, "#/admin/certs");
      } catch (err) {
        toast(errMsg(err), "err");
        busy(ev.currentTarget, false);
      }
    };
  }

  el.querySelectorAll("[data-revoke]").forEach((b) => {
    b.onclick = async () => {
      if (!(await confirmBox("撤销证书", "撤销后该编号立即失效，无法恢复。确定吗？", "撤销"))) return;
      try {
        await revokeCertificate(Number(b.dataset.revoke));
        toast("已撤销", "ok");
        adminView(el, "#/admin/certs");
      } catch (e) {
        toast(errMsg(e), "err");
      }
    };
  });

  const saveDoc = el.querySelector("#btn-save-doc");
  if (saveDoc) {
    saveDoc.onclick = async (e) => {
      const title = val(el, "#doc-title");
      const body = el.querySelector("#doc-body").value;
      if (!title) return toast("标题不能为空", "err");
      if (body.trim().length < 20) return toast("正文太短，请检查是否误删", "err");
      if (!(await confirmBox("保存规则", "前台「规则」页会立即更新为以下内容，参赛者刷新即可看到。", "保存并生效"))) return;
      busy(e.currentTarget, true, "保存中…");
      try {
        await saveDocument("rules", { title, body });
        toast("已保存，前台已生效", "ok");
        adminView(el, "#/admin/content");
      } catch (err) {
        toast(errMsg(err), "err");
        busy(e.currentTarget, false);
      }
    };
  }

  const saveIntro = el.querySelector("#btn-save-intro");
  if (saveIntro) {
    saveIntro.onclick = async (e) => {
      const title = val(el, "#intro-title");
      const body = el.querySelector("#intro-body").value;
      if (!title) return toast("标题不能为空", "err");
      if (!body.trim()) return toast("正文不能为空", "err");
      busy(e.currentTarget, true, "保存中…");
      try {
        const { saveDocument } = await import("./api.js");
        await saveDocument("intro", { title, body });
        toast("已保存，前台已生效", "ok");
        adminView(el, "#/admin/content");
      } catch (err) {
        toast(errMsg(err), "err");
        busy(e.currentTarget, false);
      }
    };
  }

  const saveLogin = el.querySelector("#btn-save-login");
  if (saveLogin) {
    saveLogin.onclick = async (e) => {
      const body = el.querySelector("#login-body").value;
      busy(e.currentTarget, true, "保存中…");
      try {
        const { saveDocument } = await import("./api.js");
        await saveDocument("login", { title: "登录页说明", body });
        toast("已保存，登录页已更新", "ok");
        adminView(el, "#/admin/content");
      } catch (err) {
        toast(errMsg(err), "err");
        busy(e.currentTarget, false);
      }
    };
  }

  const saveAct = el.querySelector("#btn-save-act");
  if (saveAct) {
    saveAct.onclick = async (e) => {
      busy(e.currentTarget, true, "保存中…");
      try {
        const data = {
          theme: val(el, "#c-theme"),
          venue: val(el, "#c-venue"),
          contact: val(el, "#c-contact"),
          signupDeadline: fromLocal(val(el, "#c-signup")),
          eventStart: fromLocal(val(el, "#c-start")),
          submitDeadline: fromLocal(val(el, "#c-submit")),
          judgeDeadline: fromLocal(val(el, "#c-judge")),
          roadshowAt: fromLocal(val(el, "#c-road")),
        };
        await saveActivity(data);
        toast("配置已保存，前台已生效", "ok");
        adminView(el, "#/admin/system");
      } catch (err) { toast(errMsg(err), "err"); busy(e.currentTarget, false); }
    };
  }

  const saveSettings = el.querySelector("#btn-save-settings");
  if (saveSettings) {
    saveSettings.onclick = async () => {
      const num = (id, d) => {
        const v = Number(val(el, id));
        return Number.isFinite(v) && v > 0 ? v : d;
      };
      const patch = {
        smtp: {
          enabled: checked(el, "#st-enabled"),
          host: val(el, "#st-host"),
          port: num("#st-port", 465),
          secure: checked(el, "#st-secure"),
          starttls: checked(el, "#st-starttls"),
          user: val(el, "#st-user"),
          fromName: val(el, "#st-from-name"),
          fromEmail: val(el, "#st-from-email"),
        },
        geetest: { enabled: checked(el, "#gt-enabled"), captchaId: val(el, "#gt-id") },
        virustotal: { enabled: checked(el, "#vt-enabled") },
        cnkd: {
          enabled: checked(el, "#ck-enabled"),
          clientId: val(el, "#ck-id"),
          redirectUri: val(el, "#ck-redirect"),
        },
        donate: {
          enabled: checked(el, "#dn-enabled"),
          url: val(el, "#dn-url"),
          title: val(el, "#dn-title"),
          note: val(el, "#dn-note"),
        },
      };
      if (patch.donate.enabled && !/^https:\/\/(?:www\.)?(afdian\.com|afdian\.net)\//i.test(patch.donate.url)) {
        return toast("请填写爱发电主页链接，形如 https://afdian.com/a/yourname", "err");
      }
      const pass = val(el, "#st-pass");
      if (el.querySelector("#st-clear-pass")?.checked) patch.smtp.pass = "__clear__";
      else if (pass) patch.smtp.pass = pass;
      const gk = val(el, "#gt-key");
      if (el.querySelector("#gt-clear")?.checked) patch.geetest.captchaKey = "__clear__";
      else if (gk) patch.geetest.captchaKey = gk;
      const vk = val(el, "#vt-key");
      if (el.querySelector("#vt-clear")?.checked) patch.virustotal.apiKey = "__clear__";
      else if (vk) patch.virustotal.apiKey = vk;
      const cks = val(el, "#ck-secret");
      if (el.querySelector("#ck-clear")?.checked) patch.cnkd.clientSecret = "__clear__";
      else if (cks) patch.cnkd.clientSecret = cks;

      busy(saveSettings, true, "保存中…");
      try {
        await saveSiteSettings(patch);
        toast("设置已保存", "ok");
        adminView(el, "#/admin/settings");
      } catch (e) {
        toast(errMsg(e), "err");
        busy(saveSettings, false);
      }
    };
  }

  const testMailBtn = el.querySelector("#btn-test-mail");
  if (testMailBtn) {
    testMailBtn.onclick = async () => {
      const to = val(el, "#st-test-to");
      if (!to) return toast("请填写测试收件邮箱", "err");
      busy(testMailBtn, true, "发送中…");
      try {
        await sendTestMail(to);
        toast("测试邮件已发出，请查收", "ok");
      } catch (e) {
        toast(errMsg(e), "err");
      } finally {
        busy(testMailBtn, false);
      }
    };
  }

  const clearBtn = el.querySelector("#btn-clear-cache");
  if (clearBtn) {
    clearBtn.onclick = async () => {
      const { invalidate } = await import("./core.js");
      invalidate();
      toast("缓存已清空", "ok");
    };
  }

  const addPartner = el.querySelector("#btn-add-partner");
  if (addPartner) addPartner.onclick = () => openPartnerForm(el, null);

  el.querySelectorAll("[data-edit-partner]").forEach((b) => {
    b.onclick = () => {
      const p = (ctx.partners || []).find((x) => x.id === Number(b.dataset.editPartner));
      if (p) openPartnerForm(el, p);
    };
  });

  const addJudge = el.querySelector("#btn-add-judge");
  if (addJudge) addJudge.onclick = () => openJudgeForm(el, null);

  el.querySelectorAll("[data-edit-judge]").forEach((b) => {
    b.onclick = () => {
      const j = (ctx.judgeList || []).find((x) => x.id === Number(b.dataset.editJudge));
      if (j) openJudgeForm(el, j);
    };
  });

  el.querySelectorAll("[data-issue-judge]").forEach((b) => {
    b.onclick = async () => {
      const j = (ctx.judgeList || []).find((x) => x.id === Number(b.dataset.issueJudge));
      if (!j) return;
      const trackText = j.tracks ? `负责赛道 ${esc(j.tracks)}` : "评审委员会";
      if (!(await confirmBox("颁发评委证书", `将为「${esc(j.name)}」（${trackText}）颁发一张评委证书。`, "颁发"))) return;
      busy(b, true, "颁发中…");
      try {
        const cert = await issueJudgeCertificate(j);
        toast("已颁发，证书编号 " + cert.cert_code, "ok");
        adminView(el, "#/admin/judges");
      } catch (e) {
        toast(errMsg(e, "颁发失败"), "err");
        busy(b, false);
      }
    };
  });

  el.querySelectorAll("[data-del-judge]").forEach((b) => {
    b.onclick = async () => {
      const j = (ctx.judgeList || []).find((x) => x.id === Number(b.dataset.delJudge));
      if (!(await confirmBox("删除评委", `将从公开名单移除「${esc(j?.name || "")}」。账号的评委权限不受影响。`, "删除"))) return;
      try {
        await deleteJudge(Number(b.dataset.delJudge));
        toast("已删除", "ok");
        adminView(el, "#/admin/judges");
      } catch (e) {
        toast(errMsg(e), "err");
      }
    };
  });

  el.querySelectorAll("[data-del-partner]").forEach((b) => {
    b.onclick = async () => {
      const p = (ctx.partners || []).find((x) => x.id === Number(b.dataset.delPartner));
      if (!(await confirmBox("删除单位", `将移除「${esc(p?.name || "")}」，首页对应位置同时消失。`, "删除"))) return;
      try {
        await deletePartner(Number(b.dataset.delPartner));
        toast("已删除", "ok");
        adminView(el, "#/admin/partners");
      } catch (e) {
        toast(errMsg(e), "err");
      }
    };
  });

  const addSponsor = el.querySelector("#btn-add-sponsor");
  if (addSponsor) addSponsor.onclick = () => openSponsorForm(el, null);

  el.querySelectorAll("[data-edit-sponsor]").forEach((b) => {
    b.onclick = () => {
      const s = (ctx.sponsors || []).find((x) => x.id === Number(b.dataset.editSponsor));
      if (s) openSponsorForm(el, s);
    };
  });

  el.querySelectorAll("[data-del-sponsor]").forEach((b) => {
    b.onclick = async () => {
      const s = (ctx.sponsors || []).find((x) => x.id === Number(b.dataset.delSponsor));
      if (!(await confirmBox("移除赞助者", `将从鸣谢页移除「${esc(s?.name || "")}」，记录会一并删除。`, "移除"))) return;
      try {
        await deleteSponsor(Number(b.dataset.delSponsor));
        toast("已移除", "ok");
        adminView(el, "#/admin/sponsors");
      } catch (e) {
        toast(errMsg(e), "err");
      }
    };
  });
}

function openCompatModal(s, refresh) {
  const c = s.compatibility || {};
  const m = modal(`
    <h3>兼容性测试 · ${esc(s.title)}</h3>
    <p class="small muted" style="margin-bottom:14px">赛道 ${esc(s.track)} · v${s.version_no}${s.pkg_sha256 ? " · SHA " + esc(s.pkg_sha256.slice(0, 10)) + "…" : ""}</p>
    <div class="field"><label class="row" style="gap:8px;cursor:pointer"><input type="checkbox" id="cp-load" ${c.can_load ? "checked" : ""} /> 能在锁定版本加载</label></div>
    <div class="field"><label class="row" style="gap:8px;cursor:pointer"><input type="checkbox" id="cp-deps" ${c.deps_ok ? "checked" : ""} /> 依赖齐全、版本匹配</label></div>
    <div class="field"><label class="row" style="gap:8px;cursor:pointer"><input type="checkbox" id="cp-safe" ${c.safe ? "checked" : ""} /> 未发现恶意代码 / 破坏性脚本</label></div>
    <div class="field"><label class="row" style="gap:8px;cursor:pointer"><input type="checkbox" id="cp-demo" ${c.demo_match ? "checked" : ""} /> 演示视频与实际运行一致</label></div>
    <div class="field">
      <label>结论</label>
      <select id="cp-result">
        <option value="passed" ${c.result === "passed" ? "selected" : ""}>通过</option>
        <option value="fix_required" ${c.result === "fix_required" ? "selected" : ""}>需修复（开启 2 小时窗口）</option>
        <option value="rejected" ${c.result === "rejected" ? "selected" : ""}>不通过</option>
        <option value="disqualified" ${c.result === "disqualified" ? "selected" : ""}>取消资格（恶意内容）</option>
      </select>
    </div>
    <div class="field"><label>备注（会通知队伍）</label>
      <textarea id="cp-note" placeholder="写明失败环节与具体报错">${esc(c.note || "")}</textarea></div>
    <div class="row" style="justify-content:flex-end;gap:8px">
      <button class="btn btn-ghost" data-x="cancel">取消</button>
      <button class="btn btn-primary" data-x="save">保存结论</button>
    </div>
  `);
  m.host.querySelector('[data-x="cancel"]').onclick = () => m.close();
  m.host.querySelector('[data-x="save"]').onclick = async (e) => {
    busy(e.currentTarget, true, "保存中…");
    try {
      await setCompatibility(s, {
        can_load: checked(m.host, "#cp-load"),
        deps_ok: checked(m.host, "#cp-deps"),
        safe: checked(m.host, "#cp-safe"),
        demo_match: checked(m.host, "#cp-demo"),
        result: val(m.host, "#cp-result"),
        note: val(m.host, "#cp-note"),
        tested_at: new Date().toISOString(),
      });
      toast("结论已保存", "ok");
      m.close();
      refresh();
    } catch (err) { toast(errMsg(err), "err"); busy(e.currentTarget, false); }
  };
}
