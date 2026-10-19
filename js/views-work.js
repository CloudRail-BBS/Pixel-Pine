import {
  cloud, state, shell, bindShell, navigate, toast, esc, fmtDate, fmtFull, timeLeft, ago,
  loadMe, requireLogin, busy, errMsg, modal, confirmBox, db, unwrap, isAdmin, sha256Hex, renderDoc,
} from "./core.js";
import { TRACKS, trackOf, DIMENSIONS, PRESENT_RUBRIC, STATUS_TEXT, TEAM_STATUS, INTEGRITY_DOC, integrityPlainText } from "./config.js";
import {
  MAX_UPLOAD_MB, fmtSize, sha256File, scanHash, uploadWorkFile, publishWorkFile, signedDownload,
} from "./upload.js";
import {
  myMembership, getTeam, listMembers, createTeam, joinTeam, leaveTeam, removeMember,
  setTeamStatus, listTeams, mySubmissions, myPrimarySubmission, saveDraft, submitVersion,
  listVersions, allSubmissions, setCompatibility, publishResults, listJudges, assignReviews,
  myReviews, saveReview, weightedTotal, allReviews, rankSubmissions, trackCounts, awardPlan,
  listAnnouncements, createAnnouncement, deleteAnnouncement, fileAppeal, listMyAppeals,
  listAllAppeals, replyAppeal, saveActivity, canEditSubmission,
  getMySignature, listSignaturesFor, signIntegrity, listMyCertificates,
  rulesFingerprint, getRulesAck, ackRules, getJudgeAck,
} from "./api.js";

const val = (root, sel) => (root.querySelector(sel)?.value || "").trim();
const checked = (root, sel) => !!root.querySelector(sel)?.checked;

/* ============================ 我的 ============================ */

export async function meView(el) {
  if (!requireLogin(el)) return;
  const me = await loadMe(true);
  let membership = null;
  let team = null;
  try {
    membership = await myMembership();
    if (membership) team = await getTeam(membership.team_id);
  } catch (_) {}
  let appeals = [];
  try { appeals = await listMyAppeals(); } catch (_) {}
  const mySig = await getMySignature().catch(() => null);
  const myCerts = await listMyCertificates().catch(() => []);

  const roleText = me?.role === "admin" ? "主办方" : me?.role === "judge" ? "评委" : "参赛者";

  el.innerHTML = shell(`
    <div class="block-head"><h2>我的</h2><span class="card-note">${esc(roleText)}</span></div>
    <div class="grid grid-2">
      <div class="card">
        <div class="card-head"><h2>参赛资料</h2><span class="card-note">其他参赛者可见</span></div>
        <div class="field"><label class="req">昵称</label>
          <input type="text" id="p-nickname" value="${esc(me?.nickname || "")}" placeholder="展示给其他参赛者" /></div>
        <div class="field"><label>公开联络</label>
          <input type="text" id="p-contact" value="${esc(me?.contact || "")}" placeholder="QQ / 微信 / 群昵称" />
          <div class="hint">会展示给其他人，方便组队联络；请勿填写手机号等敏感信息</div></div>
        <div class="field"><label>擅长方向</label>
          <input type="text" id="p-skills" value="${esc(me?.skills || "")}" placeholder="例：Java 模组 / 地图建筑 / 像素美术 / 数值" /></div>
        <div class="field"><label>个人简介</label>
          <textarea id="p-bio" placeholder="一句话介绍自己">${esc(me?.bio || "")}</textarea></div>
        <div class="field">
          <label class="row" style="cursor:pointer;gap:8px">
            <input type="checkbox" id="p-looking" ${me?.looking_for_team ? "checked" : ""} style="width:auto" />
            <span>我正在寻找队伍</span>
          </label>
        </div>
        <button class="btn btn-primary" id="btn-save-profile">保存资料</button>
      </div>

      <div class="col" style="gap:14px">
        <div class="card">
          <div class="card-head"><h2>我的状态</h2></div>
          <div class="row-between" style="margin-bottom:10px"><span class="small muted">队伍</span>
            <span class="strong">${team ? esc(team.name) : "尚未组队"}</span></div>
          <div class="row-between" style="margin-bottom:10px"><span class="small muted">赛道</span>
            <span class="strong">${team ? esc(trackOf(team.track).name) : "—"}</span></div>
          <div class="row-between"><span class="small muted">账号 ID</span>
            <span class="mono tiny dim">${esc(state.session?.user?.id || "")}</span></div>
          <div class="divider"></div>
          <div class="row" style="gap:8px">
            <a class="btn btn-sm grow" href="#/team">${team ? "管理队伍" : "去组队"}</a>
            <a class="btn btn-sm grow" href="#/work">作品提交</a>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h2>我的申诉</h2><span class="card-note">${appeals.length} 条</span></div>
          ${appeals.length ? appeals.map((a) => `
            <div class="notice-item">
              <div class="row-between">
                <span class="small strong">${esc(a.reason).slice(0, 40)}</span>
                <span class="tag ${a.status === "open" ? "tag-amber" : "tag-teal"}">${a.status === "open" ? "处理中" : "已回复"}</span>
              </div>
              <div class="notice-meta">${esc(fmtDate(a.created_at))}</div>
              ${a.reply ? `<p class="small muted" style="margin-top:6px">主办方回复：${esc(a.reply)}</p>` : ""}
            </div>`).join("") : '<p class="small dim" style="margin:0">暂无申诉记录</p>'}
        </div>

        <div class="card">
          <div class="card-head"><h2>我的证书</h2>
            <span class="card-note">${myCerts.length ? myCerts.length + " 张" : "暂无"}</span>
          </div>
          ${myCerts.length
            ? `<p class="small muted" style="margin-bottom:10px">最近一张：${esc(myCerts[0].award_name)} · ${esc(myCerts[0].cert_code)}</p>
               <a class="btn btn-sm" href="#/certificate">查看全部证书</a>`
            : `<p class="small muted" style="margin-bottom:10px">活动结束后由主办方统一颁发，获奖与参赛证书都会出现在这里。</p>
               <a class="btn btn-sm btn-ghost" href="#/verify">核验他人证书</a>`}
        </div>

        <div class="card">
          <div class="card-head"><h2>诚信公约</h2>
            <span class="${mySig ? "tag tag-teal" : "tag tag-amber"}">${mySig ? "已签署" : "未签署"}</span>
          </div>
          ${mySig
            ? `<p class="small muted" style="margin-bottom:10px">签署于 ${esc(fmtDate(mySig.created_at))}，署名「${esc(mySig.agreed_name)}」，版本 ${esc(mySig.doc_version)}。</p>
               <a class="btn btn-sm" href="#/integrity">查看公约</a>`
            : `<p class="small muted" style="margin-bottom:10px">全队成员都需各自签署，队长才能提交作品。</p>
               <a class="btn btn-sm btn-primary" href="#/integrity">去签署</a>`}
        </div>

        <div class="card">
          <div class="card-head"><h2>账号安全</h2><span class="card-note">设置后可用密码登录</span></div>
          <p class="small muted" style="margin-bottom:12px">修改密码需要验证当前密码。如果这是首次设置，请到登录页的「忘记密码，或首次设置密码」走邮件验证。</p>
          <div class="field"><label>当前密码</label>
            <input type="password" id="sec-old" placeholder="输入当前密码" autocomplete="current-password" /></div>
          <div class="field"><label>新密码</label>
            <input type="password" id="sec-new" placeholder="至少 8 位，含字母和数字" autocomplete="new-password" /></div>
          <div class="field"><label>确认新密码</label>
            <input type="password" id="sec-new2" placeholder="再输一次" autocomplete="new-password" /></div>
          <button class="btn btn-block" id="btn-change-pwd">修改密码</button>
        </div>
      </div>
    </div>
  `);
  bindShell();

  const chgBtn = el.querySelector("#btn-change-pwd");
  if (chgBtn) {
    chgBtn.onclick = async () => {
      const oldPassword = val(el, "#sec-old");
      const next = val(el, "#sec-new");
      const next2 = val(el, "#sec-new2");
      if (!oldPassword) return toast("请输入当前密码", "err");
      if (next.length < 8 || !/\d/.test(next) || !/[A-Za-z]/.test(next))
        return toast("新密码至少 8 位，且需同时包含字母和数字", "err");
      if (next !== next2) return toast("两次输入的新密码不一致", "err");
      busy(chgBtn, true, "修改中…");
      try {
        const res = await cloud.auth.resetPasswordForOld({ oldPassword, newPassword: next });
        if (res.error) throw res.error;
        el.querySelector("#sec-old").value = "";
        el.querySelector("#sec-new").value = "";
        el.querySelector("#sec-new2").value = "";
        toast("密码已更新", "ok");
      } catch (e) {
        toast(errMsg(e, "当前密码不正确"), "err");
      } finally {
        busy(chgBtn, false);
      }
    };
  }

  el.querySelector("#btn-save-profile").onclick = async (e) => {
    const btn = e.currentTarget;
    busy(btn, true, "保存中…");
    try {
      const patch = {
        nickname: val(el, "#p-nickname"),
        contact: val(el, "#p-contact"),
        skills: val(el, "#p-skills"),
        bio: val(el, "#p-bio"),
        looking_for_team: checked(el, "#p-looking"),
      };
      if (!patch.nickname) throw new Error("昵称不能为空");
      const rows = unwrap(await db.from("profiles").update(patch).eq("owner_id", state.me.owner_id).select());
      if (!rows || !rows.length) throw new Error("保存失败：无法修改该资料");
      await loadMe(true);
      toast("资料已保存", "ok");
    } catch (err) {
      toast(errMsg(err), "err");
    } finally {
      busy(btn, false);
    }
  };
}

/* ============================ 组队 ============================ */

export async function teamView(el) {
  if (!requireLogin(el)) return;
  let membership = null;
  let team = null;
  let members = [];
  try {
    membership = await myMembership();
    if (membership) {
      team = await getTeam(membership.team_id);
      members = await listMembers(membership.team_id);
    }
  } catch (e) {
    toast(errMsg(e), "err");
  }

  if (!team) {
    el.innerHTML = shell(`
      <div class="block-head"><h2>组队</h2><span class="card-note">每队 3–5 人 · 每人只能加入 1 队</span></div>
      <div class="grid grid-2">
        <div class="card">
          <div class="card-head"><h2>创建队伍</h2></div>
          <div class="field"><label class="req">队伍名称</label>
            <input type="text" id="t-name" placeholder="例：红石铁匠铺" maxlength="24" /></div>
          <div class="field"><label class="req">参赛赛道</label>
            <select id="t-track">
              ${TRACKS.map((t) => `<option value="${t.code}">${esc(t.game)} · ${esc(t.type)}（赛道 ${t.code}）</option>`).join("")}
            </select>
            <div class="hint">赛道创建后不可更改，请与队友确认一致</div></div>
          <button class="btn btn-primary" id="btn-create-team">创建并成为队长</button>
        </div>
        <div class="card">
          <div class="card-head"><h2>加入队伍</h2></div>
          <div class="field"><label class="req">邀请码</label>
            <input type="text" id="t-code" placeholder="6 位邀请码" maxlength="8" style="text-transform:uppercase" />
            <div class="hint">向队长索取；加入后不可自行更换队伍</div></div>
          <button class="btn" id="btn-join-team">加入</button>
          <div class="divider"></div>
          <p class="tiny dim" style="margin:0">队伍满 3 人后即可提交作品，上限 5 人。队长可在下方成员列表中移除成员。</p>
        </div>
      </div>
    `);
    bindShell();

    el.querySelector("#btn-create-team").onclick = async (e) => {
      const btn = e.currentTarget;
      const name = val(el, "#t-name");
      if (name.length < 2) return toast("队伍名称至少 2 个字", "err");
      busy(btn, true, "创建中…");
      try {
        await createTeam({ name, track: val(el, "#t-track") });
        toast("队伍已创建，把邀请码发给队友", "ok");
        teamView(el);
      } catch (err) {
        toast(errMsg(err), "err");
        busy(btn, false);
      }
    };

    el.querySelector("#btn-join-team").onclick = async (e) => {
      const btn = e.currentTarget;
      const code = val(el, "#t-code");
      if (!code) return toast("请输入邀请码", "err");
      busy(btn, true, "加入中…");
      try {
        await joinTeam(code);
        toast("已加入队伍", "ok");
        teamView(el);
      } catch (err) {
        toast(errMsg(err), "err");
        busy(btn, false);
      }
    };
    return;
  }

  const isLeader = membership.is_leader;
  const sizeOk = members.length >= 3;

  el.innerHTML = shell(`
    <div class="block-head"><h2>${esc(team.name)}</h2>
      <span class="tag ${(TEAM_STATUS[team.status] || {}).cls || "tag"}">${esc((TEAM_STATUS[team.status] || {}).label || team.status)}</span>
    </div>
    <div class="grid grid-3 block">
      <div class="stat"><div class="stat-label">赛道</div><div class="stat-value" style="font-size:18px">${esc(trackOf(team.track).name)}</div></div>
      <div class="stat"><div class="stat-label">成员</div><div class="stat-value">${members.length}<small>/ 5</small></div></div>
      <div class="stat"><div class="stat-label">邀请码</div><div class="stat-value mono" style="font-size:20px;color:var(--teal);letter-spacing:2px">${esc(team.invite_code)}</div></div>
    </div>

    ${!sizeOk ? `<div class="card" style="border-color:rgba(239,159,39,.35);margin-bottom:20px">
      <p class="small" style="margin:0;color:var(--amber)">队伍还差 ${3 - members.length} 人达到最低 3 人。满 3 人才能提交作品。</p></div>` : ""}

    ${team.status === "rejected" && team.review_note ? `<div class="card" style="border-color:rgba(240,149,149,.35);margin-bottom:20px">
      <p class="small" style="margin:0;color:var(--red)">报名被驳回：${esc(team.review_note)}</p></div>` : ""}

    <div class="card">
      <div class="card-head"><h2>成员</h2>${isLeader ? '<span class="card-note">你是队长</span>' : '<span class="card-note">队长可移除成员</span>'}</div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>昵称</th><th>身份</th><th>加入时间</th><th class="right">操作</th></tr></thead>
        <tbody>
          ${members.map((m) => `<tr>
            <td>${esc(m.member_name || "未命名")}${m.owner_id === state.session.user.id ? ' <span class="tag tag-teal">我</span>' : ""}</td>
            <td>${m.is_leader ? "队长" : "成员"}</td>
            <td class="mono tiny dim">${esc(fmtDate(m.created_at))}</td>
            <td class="right">${
              isLeader && !m.is_leader && m.owner_id !== state.session.user.id
                ? `<button class="btn btn-sm btn-danger" data-kick="${m.id}">移除</button>`
                : ""
            }</td>
          </tr>`).join("")}
        </tbody>
      </table></div>
      <div class="divider"></div>
      <div class="row row-wrap">
        <button class="btn btn-sm btn-danger" id="btn-leave">退出队伍</button>
        <span class="tiny dim">队长退出前请先转让队长（联系主办方协助），或整队退赛</span>
      </div>
    </div>
  `);
  bindShell();

  el.querySelectorAll("[data-kick]").forEach((b) => {
    b.onclick = async () => {
      if (!(await confirmBox("移除成员", "该成员将从队伍中移除，且不能自动重新加入，确定吗？", "移除"))) return;
      try {
        await removeMember(Number(b.dataset.kick));
        toast("已移除", "ok");
        teamView(el);
      } catch (e) { toast(errMsg(e), "err"); }
    };
  });

  el.querySelector("#btn-leave").onclick = async () => {
    if (!(await confirmBox("退出队伍", "退出后需要重新邀请才能加入，确定吗？", "退出"))) return;
    try {
      await leaveTeam(team.id);
      toast("已退出队伍", "ok");
      teamView(el);
    } catch (e) { toast(errMsg(e), "err"); }
  };
}

/* ============================ 作品 ============================ */

/* ---------------------- 提交前：活动规则阅读确认 ---------------------- */

/**
 * 弹出规则全文，必须滚到底并勾选才能继续。
 * 返回 true 表示已确认；点取消、按 Esc、点遮罩都返回 false。
 */
function rulesGate(rules) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const { html } = renderDoc(rules.body || "");

    const m = modal(
      `<h3 style="margin-bottom:4px">提交前请确认已阅读活动规则</h3>
       <p class="tiny dim" style="margin:0 0 14px">
         规则版本 <span class="mono">v${esc(rules.version)}</span> ·
         校验码 <span class="mono">${esc(String(rules.hash).slice(0, 12))}</span>
       </p>
       <div class="rg-body" id="rg-scroll">${html}</div>
       <div class="rg-foot">
         <label class="rg-check">
           <input type="checkbox" id="rg-agree" disabled />
           <span>我已通读并同意遵守上述规则，理解违规将被取消参赛与评奖资格。</span>
         </label>
         <div class="row" style="justify-content:flex-end;gap:9px;margin-top:14px">
           <button class="btn btn-ghost" data-x="cancel">取消</button>
           <button class="btn btn-primary" data-x="ok" disabled>确认并继续提交</button>
         </div>
       </div>`,
      {
        onMount(host) {
          const panel = host.querySelector(".modal");
          if (panel) panel.classList.add("modal-wide");
          const box = host.querySelector("#rg-scroll");
          const cb = host.querySelector("#rg-agree");
          const ok = host.querySelector('[data-x="ok"]');
          const tip = document.createElement("p");
          tip.className = "tiny dim";
          tip.style.cssText = "margin:0 0 10px";
          tip.textContent = "请向下滚动阅读完整规则";
          host.querySelector(".rg-foot").insertBefore(tip, host.querySelector(".rg-check"));

          const nearBottom = () => box.scrollHeight - box.scrollTop - box.clientHeight < 36;
          const unlock = () => {
            if (!cb.disabled) return;
            cb.disabled = false;
            tip.textContent = "已到规则末尾，可以勾选确认";
            tip.style.color = "var(--accent)";
          };
          box.onscroll = () => {
            if (nearBottom()) unlock();
          };
          // 内容不足一屏时直接解锁
          if (nearBottom()) unlock();

          cb.onchange = () => {
            ok.disabled = !cb.checked;
          };
          host.querySelector('[data-x="cancel"]').onclick = () => {
            m.close();
            finish(false);
          };
          ok.onclick = () => {
            m.close();
            finish(true);
          };
        },
      }
    );

    // 点遮罩会直接移除弹窗，这里兜底，避免 Promise 永远悬着
    const obs = new MutationObserver(() => {
      if (!document.body.contains(m.host)) {
        obs.disconnect();
        finish(false);
      }
    });
    obs.observe(document.body, { childList: true });
  });
}

async function recordRulesAck(rules) {
  await ackRules({
    version: rules.version,
    hash: rules.hash,
    name: state.me?.nickname || state.me?.owner_name || "参赛者",
  });
}

export async function workView(el) {
  if (!requireLogin(el)) return;
  const membership = await myMembership();
  if (!membership) {
    el.innerHTML = shell(`<div class="empty"><p>你还没有加入队伍</p><a class="btn btn-primary" href="#/team" style="margin-top:10px">去组队</a></div>`);
    bindShell();
    return;
  }
  const team = await getTeam(membership.team_id);
  const members = await listMembers(membership.team_id);
  const sub = await myPrimarySubmission();
  let versions = [];
  if (sub) {
    try { versions = await listVersions(sub.id); } catch (_) {}
  }

  const st = STATUS_TEXT[sub?.status || "draft"] || STATUS_TEXT.draft;
  const editable = canEditSubmission();
  const fixing = sub && sub.status === "fix_required" && !sub.fix_used && sub.fix_deadline && Date.now() < new Date(sub.fix_deadline).getTime();

  const mySig = await getMySignature().catch(() => null);
  let unsigned = [];
  try {
    const sigs = await listSignaturesFor(members.map((m) => m.owner_id));
    unsigned = members.filter((m) => !sigs.some((s) => s.owner_id === m.owner_id));
  } catch (_) {
    unsigned = members;
  }
  const sigOk = unsigned.length === 0;

  const rules = await rulesFingerprint().catch(() => null);
  const rulesAck = rules ? await getRulesAck(rules.version).catch(() => null) : null;

  const canSubmit = (editable || fixing) && members.length >= 3 && sigOk;

  const d = sub?.detail || {};
  const l = sub?.links || {};

  let currentFile = sub?.file_path
    ? { path: sub.file_path, name: sub.file_name, size: sub.file_size, sha: sub.pkg_sha256 }
    : null;
  let lastScan = sub?.scan || null;

  const scanBadge = (sc) => {
    if (!sc) return "";
    if (sc.enabled === false) return '<span class="tag tag-amber">扫描未启用</span>';
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
    const [cls, label] = map[sc.status] || ["tag", "未知"];
    const stat = sc.stats ? ` · ${sc.stats.malicious}/${sc.stats.total}` : "";
    return `<span class="tag ${cls}">${label}${stat}</span>`;
  };

  const banner = () => {
    if (!sub) return `<div class="card" style="border-color:rgba(133,183,235,.3);margin-bottom:18px"><p class="small" style="margin:0">还没有提交任何版本。先保存草稿，确认无误后点"提交本版本"生成快照。</p></div>`;
    if (sub.status === "fix_required") {
      const t = timeLeft(sub.fix_deadline);
      return `<div class="card" style="border-color:rgba(239,159,39,.4);margin-bottom:18px">
        <p class="small" style="margin:0 0 4px;color:var(--amber)">兼容性未通过，需要在 <strong>${esc(t.text)}</strong> 内提交一次修复包</p>
        <p class="tiny dim" style="margin:0">仅可修复可加载性问题（依赖、版本号、路径、打包结构、配置语法），不得变更功能与内容。修复机会只有一次。</p>
      </div>`;
    }
    return "";
  };

  el.innerHTML = shell(`
    <div class="block-head"><h2>作品提交</h2>
      <div class="row" style="gap:8px">
        <span class="${st.cls}">${esc(st.label)}</span>
        <span class="card-note">${esc(trackOf(team.track).name)}</span>
      </div>
    </div>
    ${banner()}

    ${!sigOk ? `<div class="card" style="border-color:rgba(239,159,39,.4);margin-bottom:18px">
      <div class="row-between" style="margin-bottom:6px;gap:12px">
        <p class="small" style="margin:0;color:var(--amber)">诚信公约还未由全队签署，暂不能提交作品</p>
        <a class="btn btn-sm" href="#/integrity">${mySig ? "查看公约" : "去签署"}</a>
      </div>
      <p class="tiny dim" style="margin:0">待签署：${unsigned.map((m) => esc(m.member_name || "未命名")).join("、")}。每位成员需各自完成签署。</p>
    </div>` : ""}

    ${members.length < 3 ? `<div class="card" style="border-color:rgba(239,159,39,.35);margin-bottom:18px"><p class="small" style="margin:0;color:var(--amber)">队伍至少需要 3 人才能提交作品，当前 ${members.length} 人。</p></div>` : ""}

    <div class="card block">
      <div class="card-head"><h2>基本信息</h2><span class="card-note">赛道由队伍决定</span></div>
      <div class="grid grid-2">
        <div class="field"><label class="req">作品名称</label>
          <input type="text" id="s-title" value="${esc(sub?.title || "")}" maxlength="40" placeholder="不超过 40 字" /></div>
        <div class="field"><label class="req">一句话简介</label>
          <input type="text" id="s-summary" value="${esc(sub?.summary || "")}" maxlength="80" placeholder="40 字内讲清这作品是什么" /></div>
      </div>
      <div class="grid grid-2">
        <div class="field"><label class="req">创意来源</label>
          <textarea id="s-origin" placeholder="想法从哪来，回应了题目中的哪一点">${esc(d.origin || "")}</textarea></div>
        <div class="field"><label class="req">核心玩法</label>
          <textarea id="s-gameplay" placeholder="玩家实际会做什么，一局大概多久">${esc(d.gameplay || "")}</textarea></div>
      </div>
      <div class="grid grid-2">
        <div class="field"><label>技术实现</label>
          <textarea id="s-tech" placeholder="用了什么加载器 / API / 脚本，关键难点怎么解决">${esc(d.tech || "")}</textarea></div>
        <div class="field"><label>亮点与不足</label>
          <textarea id="s-highlight" placeholder="老实写，评委更看重诚实">${esc(d.highlight || "")}</textarea></div>
      </div>
    </div>

    <div class="card block">
      <div class="card-head"><h2>作品包</h2><span class="card-note">≤ ${MAX_UPLOAD_MB} MB · 截止前仅本队可见</span></div>

      ${
        sub?.file_path
          ? `<div class="file-row">
              <div style="min-width:0">
                <div class="strong">${esc(sub.file_name || "作品包")}</div>
                <div class="tiny dim mono" style="word-break:break-all">${esc(sub.pkg_sha256 || "")}</div>
              </div>
              <div class="row" style="gap:8px">
                <span class="tag">${esc(fmtSize(sub.file_size))}</span>
                ${sub.shared_path ? '<span class="tag tag-teal">已发布评审</span>' : ""}
                ${membership.is_leader ? `<button class="btn btn-sm" id="btn-dl-file">下载</button>` : ""}
              </div>
            </div>`
          : ""
      }

      ${
        membership.is_leader
          ? `<div class="field">
              <label class="req">${sub?.file_path ? "重新上传（将替换当前文件）" : "选择作品包"}</label>
              <input type="file" id="s-file" />
              <div class="hint">支持 .jar / .zip / .mcworld / .rwmod 等。上传后自动计算 SHA-256 并查询病毒扫描结果。</div>
            </div>`
          : `<p class="tiny dim" style="margin-bottom:12px">作品包由队长上传与发布。文件存放在上传者自己的存储空间，换人上传会导致之前发布的链接失效。</p>`
      }
      <div id="file-status" class="tiny" style="margin-bottom:12px"></div>

      <div class="grid grid-2">
        <div class="field"><label>演示视频链接</label>
          <input type="url" id="s-video" value="${esc(l.video || "")}" placeholder="3–5 分钟，含安装到游玩（视频体积大，仍用链接）" /></div>
        <div class="field"><label>源码 / 仓库链接</label>
          <input type="url" id="s-repo" value="${esc(l.repo || "")}" placeholder="赛道 A、C 必填" /></div>
      </div>
      <div class="grid grid-2">
        <div class="field"><label class="req">安装说明</label>
          <textarea id="s-install" placeholder="从零开始，别人照着做能装上">${esc(d.install || "")}</textarea></div>
        <div class="field"><label>依赖与许可证</label>
          <textarea id="s-license" placeholder="名称 / 版本 / 来源链接 / 许可证，一行一项">${esc(d.license || "")}</textarea></div>
      </div>
      <div class="field"><label>已知问题</label>
        <textarea id="s-known" placeholder="哪些情况会崩、哪些没做完">${esc(d.known || "")}</textarea></div>

      ${
        sub?.file_path && !sub.shared_path && !editable && membership.is_leader
          ? `<div class="divider"></div>
             <div class="row-between" style="gap:12px">
               <p class="tiny dim" style="margin:0;max-width:420px">提交已截止。点击右侧把作品包发布到评审区，评委才能下载。发布后其他参赛者也可下载。</p>
               <button class="btn btn-primary btn-sm nowrap" id="btn-publish-file">发布到评审</button>
             </div>`
          : ""
      }
    </div>

    ${rules
      ? `<div class="rule-ack ${rulesAck ? "is-ok" : "is-todo"}">
          <span class="rule-ack-dot"></span>
          <div class="rule-ack-text">
            <b>《活动规则》v${esc(rules.version)}</b>
            <span>${
              rulesAck
                ? `已确认阅读 · ${esc(fmtFull(rulesAck.created_at))}`
                : "提交前需要通读并勾选确认，每人只需一次；规则更新后需要重新确认"
            }</span>
          </div>
          ${
            rulesAck
              ? `<span class="tag tag-teal">已确认</span>`
              : `<button class="btn btn-sm" id="btn-read-rules">现在阅读</button>`
          }
        </div>`
      : ""}

    <div class="row row-wrap block" style="gap:10px">
      <button class="btn" id="btn-draft">保存草稿</button>
      <button class="btn btn-primary" id="btn-submit" ${canSubmit ? "" : "disabled"}>
        ${fixing ? "提交修复版本" : "提交本版本"}
      </button>
      ${!editable && !fixing ? '<span class="tiny dim">提交已截止，不能再提交新版本</span>' : ""}
      ${!sigOk ? '<span class="tiny" style="color:var(--amber)">需全队签署《诚信比赛公约》</span>' : ""}
      ${fixing ? `<span class="tiny" style="color:var(--amber)">剩余 ${esc(timeLeft(sub.fix_deadline).text)}</span>` : ""}
    </div>

    ${sub ? `
    <div class="card">
      <div class="card-head"><h2>版本记录</h2><span class="card-note">${versions.length} 个快照 · 不可修改</span></div>
      ${versions.length ? `<div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>版本</th><th>提交时间</th><th>SHA-256</th><th>大小</th><th>说明</th><th class="right">凭证</th></tr></thead>
        <tbody>${versions.map((v) => `<tr>
          <td class="mono">v${v.version_no}</td>
          <td class="mono tiny">${esc(fmtFull(v.created_at))}</td>
          <td class="mono tiny dim">${v.sha256 ? esc(v.sha256.slice(0, 16)) + "…" : "—"}</td>
          <td class="tiny">${esc(v.pkg_size || "—")}</td>
          <td class="tiny muted">${esc(v.note || "—")}</td>
          <td class="right"><a class="btn btn-sm" href="#/receipt/submission/${v.submission_id}">查看</a></td>
        </tr>`).join("")}</tbody>
      </table></div>` : '<p class="small dim" style="margin:0">已保存草稿，但没有提交过快照。</p>'}
    </div>` : ""}
  `);
  bindShell();

  const collect = () => {
    const payload = {
      title: val(el, "#s-title"),
      summary: val(el, "#s-summary"),
      detail: {
        origin: val(el, "#s-origin"),
        gameplay: val(el, "#s-gameplay"),
        tech: val(el, "#s-tech"),
        highlight: val(el, "#s-highlight"),
        install: val(el, "#s-install"),
        known: val(el, "#s-known"),
        license: val(el, "#s-license"),
      },
      links: { video: val(el, "#s-video"), repo: val(el, "#s-repo") },
      file_path: currentFile?.path || null,
      file_name: currentFile?.name || null,
      file_size: currentFile?.size || null,
      pkg_sha256: currentFile?.sha || null,
      pkg_size: currentFile ? fmtSize(currentFile.size) : null,
      scan: lastScan,
    };
    if (!payload.title) throw new Error("请填写作品名称");
    if (!payload.summary) throw new Error("请填写一句话简介");
    return payload;
  };

  const renderFileStatus = () => {
    const box = el.querySelector("#file-status");
    if (!box) return;
    if (!currentFile) {
      box.innerHTML = '<span class="dim">尚未上传作品包</span>';
      return;
    }
    box.innerHTML = `<div class="row row-wrap" style="gap:8px;align-items:center">
      <span class="tag tag-teal">已就绪</span>
      <span class="tiny dim">${esc(fmtSize(currentFile.size))}</span>
      ${scanBadge(lastScan)}
      <span class="mono tiny dim" style="word-break:break-all">${esc(currentFile.sha || "")}</span>
    </div>`;
  };
  renderFileStatus();

  const fileInput = el.querySelector("#s-file");
  if (fileInput) {
    fileInput.onchange = async () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      const box = el.querySelector("#file-status");
      try {
        box.innerHTML = '<span class="dim">正在计算 SHA-256…</span>';
        const sha = await sha256File(f);
        box.innerHTML = '<span class="dim">正在上传，请勿关闭页面…</span>';
        const up = await uploadWorkFile(f, sub?.id || "draft");
        currentFile = { path: up.path, name: up.name, size: up.size, sha };
        box.innerHTML = '<span class="dim">正在查询病毒扫描…</span>';
        try {
          const sc = await scanHash(sha);
          lastScan = { ...sc, at: new Date().toISOString() };
        } catch (_) {
          lastScan = null;
        }
        renderFileStatus();
        if (lastScan && lastScan.status === "malicious") {
          toast("扫描检出恶意内容，请更换文件", "err");
        } else {
          toast("上传完成，记得保存或提交", "ok");
        }
      } catch (e) {
        box.innerHTML = `<span style="color:var(--red)">${esc(errMsg(e))}</span>`;
        fileInput.value = "";
      }
    };
  }

  const dlBtn = el.querySelector("#btn-dl-file");
  if (dlBtn) {
    dlBtn.onclick = async () => {
      busy(dlBtn, true, "生成中…");
      try {
        const url = await signedDownload(sub.file_path);
        if (!url) throw new Error("无法生成下载链接");
        window.open(url, "_blank", "noopener");
      } catch (e) {
        toast(errMsg(e), "err");
      } finally {
        busy(dlBtn, false);
      }
    };
  }

  const pubBtn = el.querySelector("#btn-publish-file");
  if (pubBtn) {
    pubBtn.onclick = async () => {
      if (!(await confirmBox("发布到评审", "作品包将复制到评审区，评委与所有登录用户都可下载。确定吗？", "发布"))) return;
      busy(pubBtn, true, "发布中…");
      try {
        const target = await publishWorkFile(sub.file_path, sub.id);
        const rows = unwrap(await db.from("submissions").update({ shared_path: target }).eq("id", sub.id).select());
        if (!rows || !rows.length) throw new Error("发布失败：没有权限更新该作品");
        toast("已发布到评审", "ok");
        workView(el);
      } catch (e) {
        toast(errMsg(e), "err");
        busy(pubBtn, false);
      }
    };
  }

  el.querySelector("#btn-draft").onclick = async (e) => {
    const btn = e.currentTarget;
    busy(btn, true, "保存中…");
    try {
      await saveDraft(collect());
      toast("草稿已保存", "ok");
    } catch (err) { toast(errMsg(err), "err"); }
    finally { busy(btn, false); }
  };

  el.querySelector("#btn-submit").onclick = async (e) => {
    let payload;
    try { payload = collect(); } catch (err) { return toast(err.message, "err"); }
    if (!payload.file_path) return toast("请先上传作品包", "err");
    if (lastScan && lastScan.enabled && lastScan.status === "malicious") {
      return toast("病毒扫描检出恶意内容，无法提交", "err");
    }

    // 提交前必过的一道：通读规则并确认
    if (rules && !rulesAck) {
      const read = await rulesGate(rules);
      if (!read) return;
      try {
        await recordRulesAck(rules);
      } catch (err) {
        return toast("规则确认未能保存：" + errMsg(err), "err");
      }
    }

    if (!(await confirmBox("提交确认", `提交后将生成不可修改的快照 v${(sub?.version_no) || 1}，截止前可再次提交覆盖。确定提交吗？`, "提交"))) return;
    const btn = e.currentTarget;
    busy(btn, true, "提交中…");
    try {
      await submitVersion(payload, fixing ? "修复包" : "常规提交");
      toast("已提交，等待兼容性检查", "ok");
      workView(el);
    } catch (err) {
      toast(errMsg(err), "err");
      busy(btn, false);
    }
  };

  const readBtn = el.querySelector("#btn-read-rules");
  if (readBtn && rules) {
    readBtn.onclick = async () => {
      const read = await rulesGate(rules);
      if (!read) return;
      busy(readBtn, true, "保存中…");
      try {
        await recordRulesAck(rules);
        toast("已记录规则确认", "ok");
        workView(el);
      } catch (err) {
        toast(errMsg(err), "err");
        busy(readBtn, false);
      }
    };
  }
}

/* ============================ 评审 ============================ */

export async function judgeView(el) {
  if (!requireLogin(el)) return;
  if (!(state.me?.role === "judge" || state.me?.role === "admin")) {
    el.innerHTML = shell(`<div class="empty"><p>你当前不是评委</p><p class="tiny" style="margin-top:6px">如需评审权限，请联系主办方在后台分配</p></div>`);
    bindShell();
    return;
  }
  const codeAck = await getJudgeAck().catch(() => null);
  if (!codeAck) {
    el.innerHTML = shell(`
      <div class="empty" style="max-width:560px;margin:56px auto;text-align:left">
        <div class="block-head" style="margin-bottom:12px"><h2>先签署评委公约</h2></div>
        <p class="small muted" style="margin-bottom:8px">评审入口在签署《评委公约》后开放。这是为了让每一分都有人负责。</p>
        <p class="tiny dim" style="margin-bottom:18px">公约包含回避义务、保密义务与独立打分要求，共 10 条，大约 2 分钟读完。</p>
        <div class="row row-wrap" style="gap:9px">
          <a class="btn btn-primary" href="#/judges">阅读并签署</a>
          <a class="btn btn-ghost" href="#/me">返回我的</a>
        </div>
      </div>`);
    bindShell();
    return;
  }

  const reviews = await myReviews();
  let subs = [];
  try { subs = await allSubmissions(); } catch (_) {}
  const byId = new Map(subs.map((s) => [s.id, s]));
  const pending = reviews.filter((r) => r.status !== "submitted");
  const done = reviews.filter((r) => r.status === "submitted");

  el.innerHTML = shell(`
    <div class="block-head"><h2>评审</h2><span class="card-note">${done.length} / ${reviews.length} 已完成</span></div>
    ${reviews.length ? `<div class="bar" style="margin-bottom:22px"><i style="width:${(done.length / reviews.length) * 100}%"></i></div>` : ""}
    ${!reviews.length ? `<div class="empty"><p>还没有分配给你的作品</p><p class="tiny" style="margin-top:6px">主办方派评后，这里会出现待打分作品</p></div>` : ""}
    <div class="grid grid-2">
      ${reviews.map((r) => {
        const s = byId.get(r.submission_id);
        if (!s) return "";
        return `<div class="card">
          <div class="row-between" style="margin-bottom:8px">
            <span class="tag ${s.track === "A" || s.track === "B" ? "tag-blue" : "tag-amber"}">赛道 ${esc(s.track)}</span>
            <span class="${r.status === "submitted" ? "tag tag-teal" : "tag tag-amber"}">${r.status === "submitted" ? "已提交 " + r.total + " 分" : "待评分"}</span>
          </div>
          <div class="strong" style="font-size:15px;margin-bottom:4px">${esc(s.title)}</div>
          <p class="small muted" style="margin-bottom:12px">${esc(s.summary || "")}</p>
          <button class="btn btn-sm ${r.status === "submitted" ? "" : "btn-primary"}" data-review="${r.id}">
            ${r.status === "submitted" ? "查看 / 修改" : "开始评分"}
          </button>
        </div>`;
      }).join("")}
    </div>
  `);
  bindShell();

  el.querySelectorAll("[data-review]").forEach((b) => {
    b.onclick = () => openScoreModal(Number(b.dataset.review), reviews, byId, () => judgeView(el));
  });
}

function openScoreModal(reviewId, reviews, byId, refresh) {
  const r = reviews.find((x) => x.id === reviewId);
  const s = byId.get(r.submission_id);
  const d = s?.detail || {};
  const l = s?.links || {};
  const sc = r.scores || {};
  const rubric = PRESENT_RUBRIC[s.track] || "";

  const m = modal(`
    <div class="row-between" style="margin-bottom:4px">
      <h3 style="margin:0">${esc(s.title)}</h3>
      <span class="tag ${s.track === "A" || s.track === "B" ? "tag-blue" : "tag-amber"}">赛道 ${esc(s.track)}</span>
    </div>
    <p class="small muted" style="margin-bottom:14px">${esc(s.summary || "")}</p>
    <div class="card tight" style="margin-bottom:16px;background:var(--bg)">
      <p class="tiny" style="margin:0 0 6px"><span class="dim">创意：</span>${esc(d.origin || "—")}</p>
      <p class="tiny" style="margin:0 0 6px"><span class="dim">玩法：</span>${esc(d.gameplay || "—")}</p>
      <p class="tiny" style="margin:0 0 6px"><span class="dim">技术：</span>${esc(d.tech || "—")}</p>
      <p class="tiny" style="margin:0 0 6px"><span class="dim">安装：</span>${esc(d.install || "—")}</p>
      <p class="tiny" style="margin:0"><span class="dim">已知问题：</span>${esc(d.known || "—")}</p>
      <div class="row row-wrap" style="gap:6px;margin-top:10px">
        ${s.shared_path
          ? `<button class="tag tag-teal" id="judge-dl" type="button">下载作品包</button>`
          : `<span class="tag tag-amber">作品包未发布</span>`}
        ${l.video ? `<a class="tag tag-blue" href="${esc(l.video)}" target="_blank" rel="noopener">演示视频</a>` : ""}
        ${l.repo ? `<a class="tag" href="${esc(l.repo)}" target="_blank" rel="noopener">源码</a>` : ""}
        ${s.pkg_sha256 ? `<span class="tag mono">${esc(s.pkg_sha256.slice(0, 10))}…</span>` : ""}
        ${s.scan ? `<span class="tag ${s.scan.status === "malicious" ? "tag-red" : s.scan.status === "clean" ? "tag-teal" : ""}">扫描 ${esc(s.scan.stats ? s.scan.stats.malicious + "/" + s.scan.stats.total : s.scan.status)}</span>` : ""}
      </div>
    </div>

    ${DIMENSIONS.map((dim) => `
      <div class="field">
        <label class="row-between" style="display:flex">
          <span>${esc(dim.name)} <span class="dim">· ${dim.weight}%</span></span>
        </label>
        <input type="number" min="0" max="100" step="1" data-dim="${dim.key}" value="${sc[dim.key] ?? ""}" placeholder="0–100" />
        <div class="hint">${esc(dim.key === "present" && rubric ? rubric : dim.hint)}</div>
      </div>`).join("")}

    <div class="field">
      <label>评语</label>
      <textarea id="rv-comment" placeholder="写清依据，尤其是有分歧的维度">${esc(r.comment || "")}</textarea>
    </div>
    <div class="row-between" style="margin-top:6px">
      <span class="small muted">加权总分</span>
      <span class="mono strong" id="rv-total" style="font-size:18px">${r.total || 0}</span>
    </div>
    <div class="row" style="justify-content:flex-end;gap:8px;margin-top:16px">
      <button class="btn btn-ghost" data-x="cancel">取消</button>
      <button class="btn" data-x="draft">存草稿</button>
      <button class="btn btn-primary" data-x="submit">提交评分</button>
    </div>
  `);

  const readScores = () => {
    const out = {};
    m.host.querySelectorAll("[data-dim]").forEach((i) => {
      const v = Number(i.value);
      if (i.value !== "" && !isNaN(v)) out[i.dataset.dim] = Math.max(0, Math.min(100, v));
    });
    return out;
  };
  const recalc = () => {
    m.host.querySelector("#rv-total").textContent = weightedTotal(readScores());
  };
  m.host.querySelectorAll("[data-dim]").forEach((i) => (i.oninput = recalc));
  recalc();

  const jdl = m.host.querySelector("#judge-dl");
  if (jdl) {
    jdl.onclick = async () => {
      jdl.disabled = true;
      jdl.textContent = "生成中…";
      try {
        const url = await signedDownload(s.shared_path);
        if (!url) throw new Error("无法生成下载链接");
        window.open(url, "_blank", "noopener");
      } catch (e) {
        toast(errMsg(e), "err");
      } finally {
        jdl.disabled = false;
        jdl.textContent = "下载作品包";
      }
    };
  }

  m.host.querySelector('[data-x="cancel"]').onclick = () => m.close();
  m.host.querySelector('[data-x="draft"]').onclick = async (e) => {
    busy(e.currentTarget, true, "保存中…");
    try {
      await saveReview(r.id, readScores(), val(m.host, "#rv-comment"), false);
      toast("草稿已保存", "ok");
      m.close();
      refresh();
    } catch (err) { toast(errMsg(err), "err"); busy(e.currentTarget, false); }
  };
  m.host.querySelector('[data-x="submit"]').onclick = async (e) => {
    const scores = readScores();
    if (Object.keys(scores).length < DIMENSIONS.length) return toast("请为全部 6 个维度打分", "err");
    if (!(await confirmBox("提交评分", "提交后评分锁定，如需修改请联系主办方。确定吗？", "提交"))) return;
    busy(e.currentTarget, true, "提交中…");
    try {
      await saveReview(r.id, scores, val(m.host, "#rv-comment"), true);
      toast("评分已提交", "ok");
      m.close();
      refresh();
    } catch (err) { toast(errMsg(err), "err"); busy(e.currentTarget, false); }
  };
}

/* ============================ 诚信公约 ============================ */

export async function integrityView(el) {
  if (!requireLogin(el)) return;

  const doc = INTEGRITY_DOC;
  const text = integrityPlainText(doc);
  const hash = await sha256Hex(text);
  const sig = await getMySignature(doc).catch(() => null);

  let teamRows = [];
  let unsigned = [];
  try {
    const m = await myMembership();
    if (m) {
      teamRows = await listMembers(m.team_id);
      const sigs = await listSignaturesFor(teamRows.map((x) => x.owner_id), doc);
      unsigned = teamRows.filter((x) => !sigs.some((s) => s.owner_id === x.owner_id));
    }
  } catch (_) {}

  const body = doc.items
    .map(
      (t, i) => `<li style="margin-bottom:10px"><span class="mono tiny dim" style="margin-right:8px">${String(i + 1).padStart(2, "0")}</span>${esc(t)}</li>`
    )
    .join("");

  el.innerHTML = shell(`
    <div class="split">
      <aside class="side-nav">
        <a href="#/integrity">公约全文</a>
        <a href="#/work">作品提交</a>
        <a href="#/rules">活动规则</a>
      </aside>
      <article>
        <div class="block-head">
          <h2>${esc(doc.title)}</h2>
          <span class="card-note">${esc(doc.version)} · ${esc(hash.slice(0, 12))}</span>
        </div>

        ${
          sig
            ? `<div class="card" style="border-color:rgba(86,211,165,.35);margin-bottom:20px">
                <div class="row" style="gap:10px;margin-bottom:10px">
                  <span class="tag tag-teal">已签署</span>
                  <span class="small muted">${esc(fmtFull(sig.created_at))}</span>
                </div>
                <div class="tbl-wrap"><table class="tbl"><tbody>
                  <tr><td class="small muted" style="width:92px">签署人</td><td class="strong">${esc(sig.agreed_name)}</td></tr>
                  <tr><td class="small muted">公约版本</td><td class="mono tiny">${esc(sig.doc_version)}</td></tr>
                  <tr><td class="small muted">文本哈希</td><td class="mono tiny dim" style="word-break:break-all">${esc(sig.doc_hash)}</td></tr>
                </tbody></table></div>
                <p class="tiny dim" style="margin-top:10px">哈希对应你签署时的文本。若公约修订导致版本号变化，需要重新签署。</p>
                <div class="row" style="margin-top:12px">
                  <a class="btn btn-sm" href="#/receipt/integrity">打印签署凭证</a>
                </div>
              </div>`
            : `<div class="card" style="border-color:rgba(239,159,39,.35);margin-bottom:20px">
                <p class="small" style="margin:0;color:var(--amber)">你还没有签署本公约。全队成员各自签署后，队长才能提交作品。</p>
              </div>`
        }

        <div class="card">
          <p class="small muted" style="margin-bottom:18px">${esc(doc.preamble)}</p>
          <ol style="list-style:none;padding:0;margin:0 0 20px">
            ${body}
          </ol>
          <div class="divider"></div>
          <p class="tiny dim" style="margin-bottom:18px">${esc(doc.footer)}</p>

          ${
            sig
              ? `<a class="btn" href="#/work">返回作品提交</a>`
              : `<div class="field">
                  <label class="row" style="gap:9px;cursor:pointer;align-items:flex-start">
                    <input type="checkbox" id="sig-agree" style="margin-top:3px" />
                    <span class="small">我已逐条阅读并同意上述全部条款，愿意承担相应责任。</span>
                  </label>
                </div>
                <div class="field">
                  <label class="req">签名（输入你的姓名或昵称）</label>
                  <input type="text" id="sig-name" placeholder="作为本次签署的署名" maxlength="24" />
                </div>
                <button class="btn btn-primary" id="btn-sign" disabled>签署公约</button>
                <p class="tiny dim" style="margin-top:10px">签署记录包含署名、时间、公约版本与文本哈希，主办方可在后台查阅。</p>`
          }
        </div>

        ${
          teamRows.length
            ? `<div class="card" style="margin-top:18px">
                <div class="card-head"><h2>队伍签署情况</h2><span class="card-note">${teamRows.length - unsigned.length} / ${teamRows.length}</span></div>
                <div class="row row-wrap" style="gap:8px">
                  ${teamRows
                    .map((m) => {
                      const done = !unsigned.some((u) => u.owner_id === m.owner_id);
                      return `<span class="tag ${done ? "tag-teal" : "tag-amber"}">${esc(m.member_name || "未命名")} · ${done ? "已签" : "未签"}</span>`;
                    })
                    .join("")}
                </div>
              </div>`
            : ""
        }
      </article>
    </div>
  `);
  bindShell();

  const btn = el.querySelector("#btn-sign");
  if (!btn) return;

  const agree = el.querySelector("#sig-agree");
  const nameEl = el.querySelector("#sig-name");
  const sync = () => {
    btn.disabled = !(agree.checked && nameEl.value.trim().length >= 2);
  };
  agree.onchange = sync;
  nameEl.oninput = sync;

  btn.onclick = async () => {
    const agreedName = nameEl.value.trim();
    if (!agree.checked) return toast("请先勾选同意条款", "err");
    if (agreedName.length < 2) return toast("请输入至少 2 个字的署名", "err");
    busy(btn, true, "签署中…");
    try {
      await signIntegrity({ hash, agreedName });
      toast("已签署，感谢配合", "ok");
      integrityView(el);
    } catch (e) {
      const msg = e?.code === "23505" ? "你已经签署过本版本公约" : errMsg(e);
      toast(msg, "err");
      busy(btn, false);
    }
  };
}
