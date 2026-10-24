import { state, shell, bindShell, toast, esc, fmtDate, fmtFull, requireLogin, busy, errMsg, db, navigate } from "./core.js";
import { getCertificateByCode, listMyCertificates, listVersions, getMySignature, listPartners } from "./api.js";
import { trackOf } from "./config.js";

const isAward = (c) => c.award_key !== "participant";

/** 赛事周期：2026.11.06 — 11.09 */
function fmtPeriod(a) {
  const s = a && a.eventStart ? new Date(a.eventStart) : null;
  const e = a && a.submitDeadline ? new Date(a.submitDeadline) : null;
  if (!s || isNaN(s) || !e || isNaN(e)) return "";
  const p = (n) => String(n).padStart(2, "0");
  const md = (d) => `${p(d.getMonth() + 1)}.${p(d.getDate())}`;
  return `${s.getFullYear()}.${md(s)} — ${md(e)}`;
}

function certDocument(c, issuer, meta = {}) {
  const isJudge = c.award_key === "judge";
  // 评委证书没有赛道，用一个固定抬头；trackOf("judge") 会是空对象
  const track = isJudge ? { game: "评审委员会", type: "JUDGE", name: "评审委员" } : trackOf(c.track);
  const award = !isJudge && isAward(c);
  const formal = award || isJudge;
  const year = (() => {
    const d = new Date(c.issued_at || c.created_at);
    return isNaN(d) ? "" : String(d.getFullYear());
  })();

  return `
  <div class="cert-shell">
    <div class="cert-toolbar no-print">
      <a class="btn btn-sm" href="#/certificate">← 我的证书</a>
      <div class="row" style="gap:8px">
        <a class="btn btn-sm btn-ghost" href="#/verify?code=${encodeURIComponent(c.cert_code)}">核验这张证书</a>
        <button class="btn btn-sm btn-primary" id="btn-print">打印 / 导出 PDF</button>
      </div>
    </div>

    <div class="cert-page cert-page--formal ${formal ? "is-award" : "is-part"}" id="cert-print">
      <div class="cert-inner">
        <div class="cert-spine" aria-hidden="true">PIXELSONG · 像素松 · ${esc(year)}</div>
        ${
          formal
            ? ""
            : `<div class="cert-spine cert-spine--r" aria-hidden="true">
                 // BUILD ${"72H"} · TRACK-${esc(c.track)} · OUTPUT-DELIVERED · ${esc(c.cert_code)}
               </div>
               <div class="cert-hud" aria-hidden="true"><i></i><i></i><i></i><i></i></div>`
        }
        <div class="cert-corners"><i></i><i></i><i></i><i></i></div>

        <div class="cert-head">
          <div class="cert-brand">
            <img class="cert-logo" src="/assets/logo.svg" alt="" />
            <span class="cert-brand-text">像素松<small>PIXELSONG</small></span>
          </div>
          <div class="cert-head-right">
            <div class="cert-series">${
              isJudge ? "CERTIFICATE OF JUDGING" : award ? "AWARD CERTIFICATE" : "CERTIFICATE OF PARTICIPATION"
            }</div>
            <div class="cert-code">${esc(c.cert_code)}</div>
          </div>
        </div>
        <div class="cert-head-rule" aria-hidden="true"></div>

        <div class="cert-body">
          <div class="cert-eyebrow">${
            isJudge ? "评审委员会 · JUDGE" : `${esc(track.game || "")} · ${esc(track.type || "")}`
          }</div>
          ${
            formal
              ? meta.theme || meta.period
                ? `<div class="cert-meta">
                     ${meta.theme ? `<span>本届主题 · ${esc(meta.theme)}</span>` : ""}
                     ${meta.theme && meta.period ? `<i></i>` : ""}
                     ${meta.period ? `<span>${esc(meta.period)}</span>` : ""}
                   </div>`
                : ""
              : `<div class="cert-meta cert-meta--code"><span>// ${esc(
                  [
                    meta.theme ? `THEME ${meta.theme}` : "",
                    "WINDOW 72H",
                    meta.period ? meta.period.replace(/\s/g, "") : "",
                  ]
                    .filter(Boolean)
                    .join("  ·  ")
                )}</span></div>`
          }
          <h1 class="cert-kind">${isJudge ? "评委证书" : award ? "获奖证书" : "参赛证书"}</h1>
          ${
            formal
              ? `<div class="cert-orn"><i></i><b></b><i></i></div>`
              : `<div class="cert-orn cert-orn--pixel"><i></i><i></i><i></i></div>`
          }

          <p class="cert-lead">兹 证 明</p>
          <div class="cert-name">${esc(c.holder_name)}</div>

          ${
            isJudge
              ? `<p class="cert-text">
                   于「像素松」限时创作活动中，受邀担任评审委员会<b>评委</b>，
                   依据赛事规则对参赛作品进行独立、公正的评审，
                   为本次活动的专业水准与公信力作出重要贡献。
                 </p>
                 <div class="cert-facts">
                   <div><span>[ 职责 ]</span><b>参赛作品评审</b></div>
                   ${c.judge_track ? `<div><span>[ 赛道 ]</span><b>${esc(c.judge_track)}</b></div>` : ""}
                   ${
                     [c.judge_title, c.team_name].filter(Boolean).length
                       ? `<div><span>[ 职务 ]</span><b>${esc([c.judge_title, c.team_name].filter(Boolean).join(" · "))}</b></div>`
                       : ""
                   }
                 </div>`
              : award
              ? `<p class="cert-text">
                   ${
                     c.team_kind === "individual"
                       ? `于「像素松」限时创作活动中，以个人身份提交作品《<b>${esc(c.work_title)}</b>》。`
                       : `于「像素松」限时创作活动中，作为 <b>${esc(c.team_name || "参赛队伍")}</b> 成员，
                          提交作品《<b>${esc(c.work_title)}</b>》。`
                   }<br />
                   <span class="cert-sub">赛道 ${esc(c.track)} · ${esc(track.name)}</span>
                 </p>
                 <p class="cert-text cert-text--tail">经评审委员会评定，荣获</p>
                 <div class="cert-award-line">${esc(c.award_name)}</div>`
              : `<p class="cert-text">
                   于「像素松」限时创作活动中，在 <b>72 小时</b> 开发窗口内完成并提交可运行作品，
                   全程遵守赛事规则与诚信比赛公约。
                 </p>
                 <div class="cert-facts">
                   <div><span>[ 赛道 ]</span><b>${esc(c.track)} · ${esc(track.name)}</b></div>
                   <div><span>[ 作品 ]</span><b>${esc(c.work_title)}</b></div>
                   <div><span>[ ${c.team_kind === "individual" ? "形式" : "团队"} ]</span><b>${
                     c.team_kind === "individual" ? "个人参赛" : esc(c.team_name || "参赛队伍")
                   }</b></div>
                 </div>`
          }
        </div>

        <div class="cert-close"></div>

        <div class="cert-foot">
          <div class="cert-field">
            <span>证书编号</span>
            <b>${esc(c.cert_code)}</b>
          </div>

          <div class="cert-sign">
            <div class="cert-issuer">${esc(issuer.name)}</div>
          </div>

          <div class="cert-field right">
            <span>颁发日期</span>
            <b>${esc(fmtFull(c.issued_at || c.created_at).slice(0, 10))}</b>
          </div>
        </div>

        <p class="cert-note">
          本证书可在像素松平台「证书核验」页输入编号验证真伪${
            issuer.co && issuer.co.length ? `　·　协办单位　${esc(issuer.co.join("　"))}` : ""
          }
        </p>
      </div>
    </div>
  </div>`;
}

/** 落款取主办单位；协办单位一并取出，用于页脚署名 */
async function issuerInfo() {
  try {
    const list = await listPartners();
    const host = list.find((p) => p.role === "host") || list[0];
    return {
      name: host?.name || "像素松组委会",
      host: host?.name || "像素松组委会",
      co: list.filter((p) => p.role === "co").map((p) => p.name),
    };
  } catch (_) {
    return { name: "像素松组委会", host: "像素松组委会", co: [] };
  }
}

/* ---------------------------- 我的证书 ---------------------------- */

export async function certListView(el) {
  if (!requireLogin(el)) return;
  const list = await listMyCertificates().catch(() => []);

  el.innerHTML = shell(`
    <div class="block-head"><h2>我的证书</h2><span class="card-note">${list.length} 张</span></div>
    <div class="grid grid-2">
      <div class="card">
        <div class="card-head"><h2>已获得</h2></div>
        ${
          list.length
            ? list
                .map(
                  (c) => `<a class="cert-row" href="#/certificate/${encodeURIComponent(c.cert_code)}">
                    <div style="min-width:0">
                      <div class="strong">${esc(c.award_name)}</div>
                      <div class="tiny dim">${
                        c.award_key === "judge"
                          ? esc(c.judge_track || "评审委员会")
                          : `《${esc(c.work_title)}》`
                      } · ${esc(c.cert_code)}</div>
                    </div>
                    <span class="tag ${isAward(c) || c.award_key === "judge" ? "tag-teal" : ""}">${esc(fmtDate(c.issued_at || c.created_at))}</span>
                  </a>`
                )
                .join("")
            : `<p class="small dim" style="margin:0">还没有证书。活动结束后由主办方统一颁发，获奖与参赛证书都会出现在这里。</p>`
        }
      </div>

      <div class="card">
        <div class="card-head"><h2>核验证书</h2></div>
        <p class="small muted" style="margin-bottom:14px">输入证书编号，可验证真伪与持证人信息。</p>
        <div class="field">
          <input type="text" id="v-code" placeholder="PS-A-XXXXXXXX" style="text-transform:uppercase" />
        </div>
        <button class="btn btn-primary" id="btn-verify">核验</button>
      </div>
    </div>
  `);
  bindShell();

  const go = () => {
    const code = el.querySelector("#v-code").value.trim();
    if (!code) return toast("请输入证书编号", "err");
    navigate("/verify?code=" + encodeURIComponent(code));
  };
  el.querySelector("#btn-verify").onclick = go;  el.querySelector("#v-code").onkeydown = (e) => {
    if (e.key === "Enter") go();
  };
}

/* ---------------------------- 单张证书 ---------------------------- */

export async function certDetailView(el, path) {
  const code = decodeURIComponent((path || "").split("/")[2] || "");
  let cert = null;
  try {
    cert = await getCertificateByCode(code);
  } catch (_) {}

  if (!cert) {
    el.innerHTML = shell(`
      <div class="empty" style="max-width:520px;margin:60px auto">
        <p style="margin-bottom:6px">没有找到这张证书</p>
        <p class="tiny">编号可能输入有误，或证书已被撤销</p>
        <a class="btn btn-sm" href="#/certificate" style="margin-top:14px">返回我的证书</a>
      </div>`);
    bindShell();
    return;
  }

  const a = state.activity || {};
  const meta = { theme: a.theme || "", period: fmtPeriod(a) };
  el.innerHTML = certDocument(cert, await issuerInfo(), meta);
  const btn = el.querySelector("#btn-print");
  if (btn) btn.onclick = () => window.print();
}

/* ---------------------------- 公开核验 ---------------------------- */

export async function verifyView(el, path) {
  const qs = (path || "").split("?")[1] || "";
  const code = new URLSearchParams(qs).get("code") || "";

  let cert = null;
  let error = "";
  if (code) {
    try {
      cert = await getCertificateByCode(code);
      if (!cert) error = "未找到该编号对应的证书";
    } catch (e) {
      error = errMsg(e, "查询失败，请稍后重试");
    }
  }

  el.innerHTML = shell(`
    <div style="max-width:620px;margin:30px auto">
      <div class="block-head"><h2>证书核验</h2><span class="card-note">公开可查</span></div>
      <div class="card">
        <div class="field">
          <label>证书编号</label>
          <div class="row">
            <input type="text" id="v-code" value="${esc(code)}" placeholder="PS-A-XXXXXXXX" style="text-transform:uppercase" class="grow" />
            <button class="btn btn-primary" id="btn-verify">核验</button>
          </div>
        </div>
      </div>

      ${
        code
          ? cert
            ? `<div class="card" style="margin-top:16px;border-color:rgba(86,211,165,.35)">
                <div class="row" style="gap:10px;margin-bottom:14px">
                  <span class="tag tag-teal">证书有效</span>
                  <span class="mono tiny dim">${esc(cert.cert_code)}</span>
                </div>
                <div class="tbl-wrap"><table class="tbl"><tbody>
                  <tr><td class="small muted" style="width:96px">持证人</td><td class="strong">${esc(cert.holder_name)}</td></tr>
                  ${
                    cert.award_key === "judge"
                      ? `<tr><td class="small muted">身份</td><td>评审委员会 · 评委</td></tr>
                         ${
                           cert.judge_track
                             ? `<tr><td class="small muted">评审赛道</td><td>${esc(cert.judge_track)}</td></tr>`
                             : ""
                         }
                         ${
                           [cert.judge_title, cert.team_name].filter(Boolean).length
                             ? `<tr><td class="small muted">职务</td><td>${esc(
                                 [cert.judge_title, cert.team_name].filter(Boolean).join(" · ")
                               )}</td></tr>`
                             : ""
                         }`
                      : `<tr><td class="small muted">所属队伍</td><td>${esc(cert.team_name || "—")}</td></tr>
                         <tr><td class="small muted">作品</td><td>《${esc(cert.work_title)}》</td></tr>
                         <tr><td class="small muted">赛道</td><td>赛道 ${esc(cert.track)} · ${esc(trackOf(cert.track).name)}</td></tr>
                         <tr><td class="small muted">奖项</td><td>${esc(cert.award_name)}</td></tr>`
                  }
                  <tr><td class="small muted">颁发时间</td><td class="mono tiny">${esc(fmtFull(cert.issued_at || cert.created_at))}</td></tr>
                </tbody></table></div>
                <div class="row" style="margin-top:14px">
                  <a class="btn btn-sm" href="#/certificate/${encodeURIComponent(cert.cert_code)}">查看证书</a>
                </div>
              </div>`
            : `<div class="card" style="margin-top:16px;border-color:rgba(240,149,149,.35)">
                <p class="small" style="margin:0;color:var(--red)">${esc(error || "未找到该编号对应的证书")}</p>
                <p class="tiny dim" style="margin-top:8px">请核对编号是否完整（形如 PS-A-AB12CD34），注意区分字母与数字。</p>
              </div>`
          : ""
      }
    </div>
  `);
  bindShell();

  const go = () => {
    const v = el.querySelector("#v-code").value.trim();
    if (!v) return toast("请输入证书编号", "err");
    navigate("/verify?code=" + encodeURIComponent(v));
  };
  el.querySelector("#btn-verify").onclick = go;
  el.querySelector("#v-code").onkeydown = (e) => {
    if (e.key === "Enter") go();
  };
}

/* ---------------------------- 提交 / 签署凭证 ---------------------------- */

function receiptDoc({ kind, serial, holder, lines, note, seal }) {
  return `
  <div class="cert-shell">
    <div class="cert-toolbar no-print">
      <a class="btn btn-sm" href="#" id="btn-back">← 返回</a>
      <button class="btn btn-sm btn-primary" id="btn-print">打印 / 导出 PDF</button>
    </div>
    <div class="cert-page" id="cert-print">
      <div class="cert-inner">
        <div class="cert-head">
          <img class="cert-logo" src="/assets/logo.svg" alt="" />
          <div class="cert-org">像 素 松<span>PIXELSONG</span></div>
        </div>

        <div class="cert-kind">${esc(kind)}</div>
        <div class="cert-rule"></div>

        <p class="cert-lead">兹证明</p>
        <div class="cert-name">${esc(holder)}</div>

        <div class="cert-lines">
          ${lines.map(([k, v, mono]) => `<div class="cert-line-item"><span>${esc(k)}</span><b class="${mono ? "mono" : ""}">${esc(v)}</b></div>`).join("")}
        </div>

        <div class="cert-foot">
          <div class="cert-field">
            <span>凭证编号</span>
            <b>${esc(serial)}</b>
          </div>
          <div class="cert-seal"><div class="seal-ring">像<br />素<br />松</div></div>
          <div class="cert-field right">
            <span>${esc(seal || "")}</span>
          </div>
        </div>

        <p class="cert-note">${esc(note || "")}</p>
      </div>
    </div>
  </div>`;
}

export async function receiptView(el, path) {
  const seg = (path || "").split("/");
  const kind = seg[2] || "";

  if (kind === "integrity") {
    const sig = await getMySignature().catch(() => null);
    if (!sig) {
      el.innerHTML = shell(`<div class="empty" style="max-width:520px;margin:60px auto">
        <p style="margin-bottom:6px">还没有签署记录</p>
        <a class="btn btn-sm" href="#/integrity" style="margin-top:12px">去签署公约</a>
      </div>`);
      bindShell();
      return;
    }
    el.innerHTML = receiptDoc({
      kind: "公 约 签 署 凭 证",
      serial: `PS-SIG-${String(sig.id).padStart(5, "0")}`,
      holder: sig.agreed_name,
      lines: [
        ["签署事项", "《诚信比赛公约》"],
        ["公约版本", sig.doc_version, true],
        ["签署时间", fmtFull(sig.created_at)],
        ["文本哈希", (sig.doc_hash || "").slice(0, 32) + "…", true],
      ],
      seal: fmtFull(sig.created_at).slice(0, 10),
      note: "文本哈希对应签署瞬间的公约全文，可重新计算结果比对，用于确认所签版本未被篡改。",
    });
    bindReceipt(el);
    return;
  }

  if (kind === "submission") {
    const id = Number(seg[3]);
    const sub = await db.from("submissions").select("*").eq("id", id).maybeSingle().then((r) => r.data).catch(() => null);
    if (!sub) {
      el.innerHTML = shell(`<div class="empty" style="max-width:520px;margin:60px auto">
        <p style="margin-bottom:6px">没有找到该作品的提交记录</p>
        <a class="btn btn-sm" href="#/work" style="margin-top:12px">返回作品页</a>
      </div>`);
      bindShell();
      return;
    }
    const vers = await listVersions(sub.id).catch(() => []);
    const v = vers[0];
    el.innerHTML = receiptDoc({
      kind: "作 品 提 交 凭 证",
      serial: `PS-SUB-${String(sub.id).padStart(4, "0")}-V${sub.version_no - 1 || 1}`,
      holder: sub.owner_name || "参赛队伍",
      lines: [
        ["作品名称", sub.title],
        ["赛道", `赛道 ${sub.track} · ${trackOf(sub.track).name}`],
        ["提交版本", `v${v ? v.version_no : sub.version_no}`, true],
        ["作品包 SHA-256", (sub.pkg_sha256 || "—").slice(0, 32) + "…", true],
        ["包体大小", sub.pkg_size || "—"],
        ["提交时间", v ? fmtFull(v.created_at) : fmtFull(sub.updated_at)],
      ],
      seal: fmtFull(v ? v.created_at : sub.updated_at).slice(0, 10),
      note: "凭证内容取自提交时生成的不可变版本快照。作品包哈希可用于核对文件是否被替换。",
    });
    bindReceipt(el);
    return;
  }

  el.innerHTML = shell(`<div class="empty">未知凭证类型</div>`);
  bindShell();
}

function bindReceipt(el) {
  const back = el.querySelector("#btn-back");
  if (back) back.onclick = (e) => { e.preventDefault(); history.back(); };
  const p = el.querySelector("#btn-print");
  if (p) p.onclick = () => window.print();
}
