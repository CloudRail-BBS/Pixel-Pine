import {
  state, shell, bindShell, navigate, toast, esc, fmtDate, fmtFull, timeLeft, ago,
  requireLogin, busy, errMsg, modal, confirmBox, db, unwrap, isAdmin,
} from "./core.js";
import { TRACKS, trackOf, STATUS_TEXT, TEAM_STATUS, DIMENSIONS, AWARDS } from "./config.js";
import {
  listTeams, allSubmissions, allReviews, listJudges, listAnnouncements, createAnnouncement,
  deleteAnnouncement, setTeamStatus, setCompatibility, assignReviews, publishResults,
  rankSubmissions, trackCounts, awardPlan, saveActivity, listAllAppeals, replyAppeal,
  setUserRole, listVersions, listDocuments, saveDocument,
  listCertificates, issueCertificates, revokeCertificate,
} from "./api.js";

const val = (root, sel) => (root.querySelector(sel)?.value || "").trim();
const checked = (root, sel) => !!root.querySelector(sel).checked;

const TABS = [
  { key: "overview", label: "概览" },
  { key: "teams", label: "队伍" },
  { key: "works", label: "作品" },
  { key: "review", label: "评审" },
  { key: "results", label: "结果" },
  { key: "certs", label: "证书" },
  { key: "notices", label: "公告" },
  { key: "content", label: "内容" },
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

  const [teams, subs, reviews, notices, appeals, profiles, members, sigs, docs, certs, health] = await Promise.all([
    listTeams().catch(() => []),
    allSubmissions().catch(() => []),
    allReviews().catch(() => []),
    listAnnouncements().catch(() => []),
    listAllAppeals().catch(() => []),
    db.from("profiles").select("*").order("created_at").then(unwrap).catch(() => []),
    db.from("team_members").select("team_id, owner_id, member_name").then(unwrap).catch(() => []),
    db.from("signatures").select("owner_id, agreed_name, created_at, doc_version").then(unwrap).catch(() => []),
    listDocuments().catch(() => []),
    listCertificates().catch(() => []),
    fetch("/api/health").then((r) => r.json()).catch(() => null),
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
      case "results": return resultsTab(subs, reviews);
      case "certs": return certsTab(subs, teams, members, certs);
      case "notices": return noticesTab(notices);
      case "content": return contentTab(docs);
      case "appeals": return appealsTab(appeals);
      case "system": return systemTab(health, profiles);
      default: return overviewTab({ teams, subs, reviews, counts, reviewed, pendingAppeals, pendingTeams, pendingWorks, health, members, profiles, sigs });
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

  wireAdmin(el, { teams, subs, reviews, notices, appeals, profiles, members, certs, tab });
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

  return `
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
      <div class="card-head"><h2>诚信公约签署</h2>
        <span class="card-note">${(d.sigs || []).length} / ${(d.profiles || []).length} 个账号</span>
      </div>
      <div class="bar" style="margin-bottom:10px">
        <i style="width:${(d.profiles || []).length ? Math.round(((d.sigs || []).length / d.profiles.length) * 100) : 0}%"></i>
      </div>
      <p class="tiny dim" style="margin:0">全队成员各自签署后，队长才能提交作品。未签署的账号在提交页会被拦下并提示具体成员。</p>
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
            <td class="strong">${esc(t.name)}<div class="mono tiny dim">${esc(t.invite_code)}</div></td>
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
        <thead><tr><th>作品</th><th>赛道</th><th>版本</th><th>SHA-256</th><th>状态</th><th class="right">操作</th></tr></thead>
        <tbody>${subs.map((s) => `<tr>
          <td class="strong">${esc(s.title)}<div class="tiny dim">${esc(s.owner_name || "")}</div></td>
          <td><span class="tag">${esc(s.track)}</span></td>
          <td class="mono tiny">v${s.version_no}</td>
          <td class="mono tiny dim">${s.pkg_sha256 ? esc(s.pkg_sha256.slice(0, 10)) + "…" : "—"}</td>
          <td><span class="${(STATUS_TEXT[s.status] || {}).cls || "tag"}">${esc((STATUS_TEXT[s.status] || {}).label || s.status)}</span></td>
          <td class="right nowrap">
            <button class="btn btn-sm" data-vers="${s.id}">版本</button>
            <button class="btn btn-sm" data-check="${s.id}">兼容性</button>
          </td>
        </tr>`).join("")}</tbody>
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
  return `
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
        const n = await issueCertificates({ ...sub, team_name: team?.name || null }, todo, awardKey, awardName);
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

  const clearBtn = el.querySelector("#btn-clear-cache");
  if (clearBtn) {
    clearBtn.onclick = async () => {
      const { invalidate } = await import("./core.js");
      invalidate();
      toast("缓存已清空", "ok");
    };
  }
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
