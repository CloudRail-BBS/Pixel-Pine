import { cloud, db, state, unwrap, sessionUid, isAdmin, cached, invalidate, sha256Hex } from "./core.js";
import { DIMENSIONS, TRACKS, trackOf, INTEGRITY_DOC, JUDGE_DOC } from "./config.js";

const uid = () => sessionUid();
const now = () => Date.now();
const ts = (iso) => (iso ? new Date(iso).getTime() : 0);

export const phase = () => {
  const a = state.activity || {};
  if (!ts(a.eventStart)) return "unknown";
  if (now() < ts(a.eventStart)) return "before";
  if (now() < ts(a.submitDeadline)) return "coding";
  if (now() < ts(a.judgeDeadline)) return "judging";
  return "after";
};

export const canEditSubmission = () => now() < ts(state.activity?.submitDeadline);

/* ---------------- 队伍 ---------------- */

export async function myMembership() {
  return unwrap(
    await db.from("team_members").select("*").eq("owner_id", uid()).maybeSingle()
  );
}

export async function getTeam(id) {
  if (!id) return null;
  return unwrap(await db.from("teams").select("*").eq("id", id).maybeSingle());
}

export async function listMembers(teamId) {
  return unwrap(
    await db.from("team_members").select("*").eq("team_id", teamId).order("is_leader", { ascending: false })
  ) || [];
}

export async function listTeams() {
  return unwrap(await db.from("teams").select("*").order("created_at", { ascending: false })) || [];
}

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export async function createTeam({ name, track }) {
  const existing = await myMembership();
  if (existing) throw new Error("你已经加入了一支队伍，每人只能加入 1 支队伍");
  const code = makeCode();
  const team = unwrap(
    await db.from("teams").insert({
      name, track, invite_code: code,
      owner_name: state.me?.nickname || null,
    }).select()
  )?.[0];
  if (!team) throw new Error("创建队伍失败，请重试");
  unwrap(
    await db.from("team_members").insert({
      team_id: team.id, member_name: state.me?.nickname || null, is_leader: true,
    }).select()
  );
  return team;
}

export async function joinTeam(code) {
  const existing = await myMembership();
  if (existing) throw new Error("你已经加入了一支队伍，每人只能加入 1 支队伍");
  const team = unwrap(
    await db.from("teams").select("*").ilike("invite_code", code.trim()).maybeSingle()
  );
  if (!team) throw new Error("邀请码无效，请向队长确认");
  const members = await listMembers(team.id);
  if (members.length >= 5) throw new Error("该队伍已满员（上限 5 人）");
  unwrap(
    await db.from("team_members").insert({
      team_id: team.id, member_name: state.me?.nickname || null, is_leader: false,
    }).select()
  );
  return team;
}

export async function leaveTeam(teamId) {
  const rows = unwrap(
    await db.from("team_members").delete().eq("team_id", teamId).eq("owner_id", uid()).select()
  );
  if (!rows || !rows.length) throw new Error("退出失败：队伍不存在或你不是成员");
}

export async function removeMember(memberId) {
  const rows = unwrap(
    await db.from("team_members").delete().eq("id", memberId).select()
  );
  if (!rows || !rows.length) throw new Error("移除失败：只有队长或主办方可以移除成员");
}

export async function setTeamStatus(teamId, status, note) {
  unwrap(await db.from("teams").update({ status, review_note: note || null }).eq("id", teamId).select());
}

/* ---------------- 作品 ---------------- */

export async function mySubmissions() {
  const m = await myMembership();
  if (!m) return [];
  return unwrap(
    await db.from("submissions").select("*").eq("team_id", m.team_id).order("is_backup", { ascending: true })
  ) || [];
}

export async function myPrimarySubmission() {
  const list = await mySubmissions();
  return list.find((s) => !s.is_backup) || null;
}

export async function allSubmissions() {
  return cached("subs", 20000, async () => {
    const rows = unwrap(
      await db.from("submissions").select("*").order("track").order("created_at")
    ) || [];
    return rows;
  });
}

export async function saveDraft(payload) {
  const m = await myMembership();
  if (!m) throw new Error("请先加入或创建队伍");
  const existing = await myPrimarySubmission();
  if (existing) {
    const rows = unwrap(
      await db.from("submissions").update({ ...payload, updated_at: new Date().toISOString() })
        .eq("id", existing.id).select()
    );
    if (!rows || !rows.length) throw new Error("保存失败：没有权限修改该作品");
    return rows[0];
  }
  const team = await getTeam(m.team_id);
  const rows = unwrap(
    await db.from("submissions").insert({
      team_id: m.team_id,
      track: team?.track || "A",
      owner_name: state.me?.nickname || null,
      ...payload,
    }).select()
  );
  return rows && rows[0];
}

export async function submitVersion(payload, note) {
  const m = await myMembership();
  if (!m) throw new Error("请先加入或创建队伍");
  let sub = await myPrimarySubmission();
  const isFix = sub && sub.status === "fix_required";
  if (isFix) {
    if (sub.fix_used) throw new Error("修复机会已使用，不能再提交");
    if (!sub.fix_deadline || now() > ts(sub.fix_deadline)) throw new Error("修复窗口已关闭");
  } else if (!canEditSubmission()) {
    throw new Error("提交已截止，不能再提交新版本");
  }
  sub = await saveDraft(payload);
  const nextVer = (sub.version_no || 1);
  unwrap(
    await db.from("submission_versions").insert({
      submission_id: sub.id,
      team_id: sub.team_id,
      owner_name: sub.owner_name,
      version_no: nextVer,
      snapshot: payload,
      sha256: payload.pkg_sha256 || null,
      pkg_size: payload.pkg_size || null,
      note: note || null,
    }).select()
  );
  const patch = {
    status: "submitted",
    version_no: nextVer + 1,
    pkg_sha256: payload.pkg_sha256 || null,
    pkg_size: payload.pkg_size || null,
    updated_at: new Date().toISOString(),
  };
  if (isFix) patch.fix_used = true;
  unwrap(await db.from("submissions").update(patch).eq("id", sub.id).select());
  invalidate("subs");
  return sub.id;
}

export async function listVersions(submissionId) {
  return unwrap(
    await db.from("submission_versions").select("*").eq("submission_id", submissionId)
      .order("version_no", { ascending: false })
  ) || [];
}

export async function setCompatibility(sub, compat) {
  const status = compat.result;
  unwrap(
    await db.from("submissions").update({
      compatibility: compat,
      status,
      fix_deadline: status === "fix_required" ? new Date(Date.now() + 2 * 3600 * 1000).toISOString() : null,
    }).eq("id", sub.id).select()
  );
  invalidate("subs");
}

export async function publishResults() {
  const rows = unwrap(
    await db.from("submissions").update({ status: "public" }).in("status", ["passed"]).select()
  );
  invalidate("subs");
  return rows ? rows.length : 0;
}

/* ---------------- 评审 ---------------- */

export async function listJudges() {
  return unwrap(await db.from("profiles").select("*").eq("role", "judge")) || [];
}

export async function assignReviews(submissions, judges) {
  const rows = [];
  for (const s of submissions) {
    for (const j of judges) {
      rows.push({
        submission_id: s.id,
        judge_uid: j.owner_id,
        judge_name: j.nickname || j.owner_name || "评委",
        scores: {},
        status: "draft",
      });
    }
  }
  if (!rows.length) return 0;
  unwrap(await db.from("reviews").upsert(rows, { ignoreDuplicates: true }).select());
  return rows.length;
}

export async function myReviews() {
  return unwrap(
    await db.from("reviews").select("*").eq("judge_uid", uid())
  ) || [];
}

export async function saveReview(reviewId, scores, comment, submit) {
  const total = weightedTotal(scores);
  const rows = unwrap(
    await db.from("reviews").update({
      scores, comment, total,
      status: submit ? "submitted" : "draft",
      updated_at: new Date().toISOString(),
    }).eq("id", reviewId).select()
  );
  if (!rows || !rows.length) throw new Error("保存失败：该评分不属于你");
}

export function weightedTotal(scores) {
  if (!scores) return 0;
  let sum = 0;
  let filled = 0;
  for (const d of DIMENSIONS) {
    const v = Number(scores[d.key]);
    if (!isNaN(v) && v > 0) { filled++; sum += v * d.weight; }
  }
  if (!filled) return 0;
  return Math.round((sum / 100) * 10) / 10;
}

export async function allReviews() {
  return unwrap(await db.from("reviews").select("*")) || [];
}

export function rankSubmissions(subs, reviews) {
  const bySub = new Map();
  for (const r of reviews) {
    if (r.status !== "submitted" && r.status !== "locked") continue;
    if (!r.total) continue;
    if (!bySub.has(r.submission_id)) bySub.set(r.submission_id, []);
    bySub.get(r.submission_id).push(Number(r.total));
  }
  return subs.map((s) => {
    const list = (bySub.get(s.id) || []).slice().sort((a, b) => a - b);
    let used = list;
    if (list.length >= 5) used = list.slice(1, -1);
    const avg = used.length ? used.reduce((a, b) => a + b, 0) / used.length : 0;
    const trimmed = list.length >= 5;
    return {
      sub: s,
      judgeCount: list.length,
      avg: Math.round(avg * 10) / 10,
      qualified: avg >= 60,
      trimmed,
    };
  }).sort((a, b) => b.avg - a.avg);
}

export async function reviewStats(subs, reviews) {
  const done = reviews.filter((r) => r.status === "submitted").length;
  return { total: reviews.length, done };
}

/* ---------------- 公告 / 申诉 / 配置 ---------------- */

export async function listAnnouncements() {
  return cached("ann", 60000, async () => {
    const rows = unwrap(
      await db.from("announcements").select("*").order("pinned", { ascending: false }).order("created_at", { ascending: false })
    ) || [];
    return rows;
  });
}

export async function createAnnouncement(title, body, pinned) {
  unwrap(await db.from("announcements").insert({ title, body, pinned: !!pinned }).select());
  invalidate("ann");
}

export async function deleteAnnouncement(id) {
  unwrap(await db.from("announcements").delete().eq("id", id).select());
  invalidate("ann");
}

export async function setUserRole(uid, role) {
  return unwrap(await db.rpc("admin_set_role", { target_uid: uid, new_role: role }));
}

export async function fileAppeal(submissionId, reason) {
  unwrap(
    await db.from("appeals").insert({ submission_id: submissionId, reason, owner_name: state.me?.nickname || null }).select()
  );
}

export async function listMyAppeals() {
  return unwrap(await db.from("appeals").select("*").eq("owner_id", uid()).order("created_at", { ascending: false })) || [];
}

export async function listAllAppeals() {
  return unwrap(await db.from("appeals").select("*").order("created_at", { ascending: false })) || [];
}

export async function replyAppeal(id, status, reply) {
  unwrap(await db.from("appeals").update({ status, reply }).eq("id", id).select());
}

export async function saveActivity(data) {
  unwrap(await db.from("activity").update({ data, updated_at: new Date().toISOString() }).eq("id", 1).select());
  state.activity = { ...(state.activity || {}), ...data };
  invalidate("act");
}

/* ---------------- 统计 ---------------- */

export function trackCounts(teams, submissions) {
  return TRACKS.map((t) => {
    const ts_ = teams.filter((x) => x.track === t.code);
    const ss = submissions.filter((x) => x.track === t.code && !x.is_backup);
    return { ...t, teams: ts_.length, subs: ss.length, approved: ts_.filter((x) => x.status === "approved").length };
  });
}

export function awardPlan(count) {
  if (count >= 6) return { mode: "independent", label: "独立设奖", detail: "满 6 支队伍，一、二、三等奖各 1 项" };
  if (count >= 4) return { mode: "merge", label: "合并评审", detail: "4–5 支队伍，与同组另一赛道合并评审" };
  if (count >= 1) return { mode: "single", label: "仅评单项", detail: "不足 4 支队伍，不设等级奖，仅参与单项奖与展示" };
  return { mode: "empty", label: "暂无队伍", detail: "该赛道尚无报名队伍" };
}

/* ---------------- 诚信公约签署 ---------------- */

export async function getMySignature(doc = INTEGRITY_DOC) {
  if (!uid()) return null;
  return unwrap(
    await db.from("signatures").select("*")
      .eq("owner_id", uid())
      .eq("doc_key", doc.key)
      .eq("doc_version", doc.version)
      .maybeSingle()
  );
}

export async function listSignaturesFor(uids, doc = INTEGRITY_DOC) {
  if (!uids || !uids.length) return [];
  return unwrap(
    await db.from("signatures").select("owner_id, agreed_name, doc_version, created_at")
      .in("owner_id", uids)
      .eq("doc_key", doc.key)
      .eq("doc_version", doc.version)
  ) || [];
}

export async function signIntegrity({ hash, agreedName }) {
  const rows = unwrap(
    await db.from("signatures").insert({
      doc_key: INTEGRITY_DOC.key,
      doc_version: INTEGRITY_DOC.version,
      doc_hash: hash,
      agreed_name: agreedName,
      owner_name: state.me?.nickname || null,
      user_agent: (navigator.userAgent || "").slice(0, 300),
    }).select()
  );
  if (!rows || !rows.length) throw new Error("签署失败，请重试");
  return rows[0];
}

/* ---------------- 可编辑文档 ---------------- */

export async function getDocument(key) {
  return unwrap(await db.from("documents").select("*").eq("doc_key", key).maybeSingle());
}

export async function listDocuments() {
  return unwrap(await db.from("documents").select("*").order("doc_key")) || [];
}

export async function saveDocument(key, { title, body }) {
  const patch = {
    title,
    body,
    updated_at: new Date().toISOString(),
    owner_id: sessionUid(),
  };
  const rows = unwrap(await db.from("documents").update(patch).eq("doc_key", key).select());
  if (rows && rows.length) return rows[0];

  // 该文档还没建过（例如老部署升级后新增的「登录页说明」）→ 首次保存时补建
  const created = unwrap(
    await db.from("documents").insert({ doc_key: key, version: 1, ...patch }).select()
  );
  if (!created || !created.length) throw new Error("保存失败：没有权限修改该文档");
  return created[0];
}

/* ---------------- 证书 ---------------- */

export async function listMyCertificates() {
  if (!uid()) return [];
  return unwrap(
    await db.from("certificates").select("*").eq("owner_id", uid()).order("issued_at", { ascending: false })
  ) || [];
}

export async function getCertificateByCode(code) {
  const c = String(code || "").trim().toUpperCase();
  if (!c) return null;
  return unwrap(await db.from("certificates").select("*").eq("cert_code", c).maybeSingle());
}

export async function listCertificates() {
  return unwrap(await db.from("certificates").select("*").order("issued_at", { ascending: false })) || [];
}

function makeCertCode(track) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let body = "";
  for (let i = 0; i < 8; i++) body += chars[Math.floor(Math.random() * chars.length)];
  return `PS-${track || "X"}-${body}`;
}

export async function issueCertificates(sub, holders, awardKey, awardName) {
  const rows = [];
  for (const h of holders) {
    rows.push({
      cert_code: makeCertCode(sub.track),
      submission_id: sub.id,
      team_id: sub.team_id,
      team_name: sub.team_name || null,
      owner_id: h.owner_id,
      holder_name: h.name || "未命名",
      work_title: sub.title,
      track: sub.track,
      award_key: awardKey,
      award_name: awardName,
      issued_by: state.me?.nickname || null,
    });
  }
  if (!rows.length) return 0;
  const out = unwrap(await db.from("certificates").insert(rows).select());
  return out ? out.length : 0;
}

export async function revokeCertificate(id) {
  const rows = unwrap(await db.from("certificates").delete().eq("id", id).select());
  if (!rows || !rows.length) throw new Error("撤销失败：没有权限");
}

/* ---------------- 组织单位 ---------------- */

export async function listPartners() {
  return cached("partners", 60000, async () => {
    const rows =
      unwrap(await db.from("partners").select("*").order("sort").order("created_at")) || [];
    return rows;
  });
}

export async function savePartner(p) {
  const payload = {
    name: String(p.name || "").trim(),
    role: p.role || "co",
    logo_url: String(p.logoUrl || "").trim() || null,
    site_url: String(p.siteUrl || "").trim() || null,
    note: String(p.note || "").trim() || null,
    sort: Number(p.sort) || 100,
  };
  if (!payload.name) throw new Error("请填写单位名称");
  if (p.id) {
    const rows = unwrap(await db.from("partners").update(payload).eq("id", p.id).select());
    if (!rows || !rows.length) throw new Error("保存失败：没有权限修改该单位");
  } else {
    payload.owner_id = sessionUid();
    unwrap(await db.from("partners").insert(payload).select());
  }
  invalidate("partners");
}

export async function deletePartner(id) {
  const rows = unwrap(await db.from("partners").delete().eq("id", id).select());
  if (!rows || !rows.length) throw new Error("删除失败：没有权限");
  invalidate("partners");
}

/* ---------------- 公开展示的作品 ---------------- */

/** 只取已公示作品；登录者自己的草稿/未公示作品不会混进展厅 */
export async function publicWorks() {
  return cached("public_works", 20000, async () => {
    const rows =
      unwrap(
        await db
          .from("submissions")
          .select("*")
          .eq("status", "public")
          .order("created_at", { ascending: false })
      ) || [];
    return rows;
  });
}

export async function publicWork(id) {
  if (!id) return null;
  return unwrap(
    await db.from("submissions").select("*").eq("id", id).eq("status", "public").maybeSingle()
  );
}

/* ---------------- 活动规则阅读确认 ---------------- */

/** 当前规则版本 + 文本哈希；规则正文在后台可改，版本号随之递增 */
export async function rulesFingerprint() {
  const doc = await getDocument("rules").catch(() => null);
  if (!doc) return null;
  const body = String(doc.body || "");
  return {
    title: doc.title || "活动规则",
    body,
    version: String(doc.version ?? 1),
    hash: await sha256Hex(body),
    updatedAt: doc.updated_at,
  };
}

export async function getRulesAck(version) {
  if (!uid()) return null;
  return unwrap(
    await db
      .from("signatures")
      .select("*")
      .eq("owner_id", uid())
      .eq("doc_key", "rules")
      .eq("doc_version", String(version))
      .maybeSingle()
  );
}

export async function ackRules({ version, hash, name }) {
  try {
    const rows = unwrap(
      await db
        .from("signatures")
        .insert({
          doc_key: "rules",
          doc_version: String(version),
          doc_hash: hash,
          agreed_name: name,
          owner_name: state.me?.nickname || null,
          user_agent: (navigator.userAgent || "").slice(0, 300),
        })
        .select()
    );
    return (rows && rows[0]) || null;
  } catch (e) {
    // 已确认过（唯一约束）视为成功，避免重复点击报错
    if (e?.code === "23505" || e?.error?.code === "23505") return null;
    throw e;
  }
}

/* ---------------- 评委团队 ---------------- */

export async function listJudgesPublic() {
  return cached("judges_public", 60000, async () => {
    const rows =
      unwrap(
        await db.from("judges").select("*").eq("published", true).order("sort").order("created_at")
      ) || [];
    return rows;
  });
}

export async function listJudgesAll() {
  return (
    unwrap(await db.from("judges").select("*").order("sort").order("created_at")) || []
  );
}

export async function saveJudge(j) {
  const payload = {
    name: String(j.name || "").trim(),
    title: String(j.title || "").trim() || null,
    org: String(j.org || "").trim() || null,
    avatar_url: String(j.avatarUrl || "").trim() || null,
    bio: String(j.bio || "").trim() || null,
    tracks: String(j.tracks || "").trim() || null,
    sort: Number(j.sort) || 100,
    published: j.published !== false,
  };
  if (!payload.name) throw new Error("请填写评委姓名");
  if (j.id) {
    const rows = unwrap(await db.from("judges").update(payload).eq("id", j.id).select());
    if (!rows || !rows.length) throw new Error("保存失败：没有权限修改该记录");
  } else {
    payload.owner_id = sessionUid();
    unwrap(await db.from("judges").insert(payload).select());
  }
  invalidate("judges_public");
}

export async function deleteJudge(id) {
  const rows = unwrap(await db.from("judges").delete().eq("id", id).select());
  if (!rows || !rows.length) throw new Error("删除失败：没有权限");
  invalidate("judges_public");
}

/* ---------------- 评委公约签署 ---------------- */

export async function getJudgeAck(doc = JUDGE_DOC) {
  if (!uid()) return null;
  return unwrap(
    await db
      .from("signatures")
      .select("*")
      .eq("owner_id", uid())
      .eq("doc_key", doc.key)
      .eq("doc_version", doc.version)
      .maybeSingle()
  );
}

export async function signJudgeCode({ hash, name }, doc = JUDGE_DOC) {
  try {
    const rows = unwrap(
      await db
        .from("signatures")
        .insert({
          doc_key: doc.key,
          doc_version: doc.version,
          doc_hash: hash,
          agreed_name: name,
          owner_name: state.me?.nickname || null,
          user_agent: (navigator.userAgent || "").slice(0, 300),
        })
        .select()
    );
    return (rows && rows[0]) || null;
  } catch (e) {
    if (e?.code === "23505" || e?.error?.code === "23505") return null;
    throw e;
  }
}

/* ---------------- 活动介绍 ---------------- */

/** 取纯文本首段：去掉标题标记与强调符号，用于首页 hero 副标题 */
export function plainFirst(body) {
  const block = String(body || "")
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .find(Boolean);
  if (!block) return "";
  return block
    .replace(/^#+\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\n/g, " ")
    .trim();
}

export async function getIntro() {
  const doc = await getDocument("intro").catch(() => null);
  if (!doc) return null;
  return { ...doc, first: plainFirst(doc.body) };
}

/* ---------------- 站点设置（仅本地模式） ---------------- */

async function settingsCall(path, body) {
  const r = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw (j && j.error) || new Error("设置请求失败");
  return j.data;
}

export async function getSiteSettings() {
  return settingsCall("/.cloud/local/settings");
}

export async function saveSiteSettings(patch) {
  return settingsCall("/.cloud/local/settings", patch);
}

export async function sendTestMail(to) {
  return settingsCall("/.cloud/local/settings/test-mail", { to });
}

export async function authConfig() {
  const r = await fetch("/api/auth/config", { headers: { accept: "application/json" } });
  return r.json();
}
