/**
 * 服务端 SEO：robots.txt、sitemap.xml、爬虫快照与页面 head 注入。
 * 只读本地面板数据；云端模式下降级为静态页面清单。
 */
const local = require("./local");

const SITE = process.env.PS_SITE_NAME || "像素松";
const OG_IMAGE = "/assets/og-cover.png";
const DEFAULT_DESC =
  "《我的世界》×《铁锈战争》「像素松」限时创作活动：72 小时组队创作，四条赛道独立评审，全程线上。报名、组队、提交、评审与结果公示都在这里。";

const BOT_RE =
  /(googlebot|bingbot|baiduspider|yandex|sogou|360spider|haosouspider|bytespider|duckduckbot|facebookexternalhit|twitterbot|slackbot|linkedinbot|telegrambot|discordbot|applebot|petalbot|gptbot|claudebot|perplexitybot)/i;

const TRACKS = [
  { code: "A", name: "MC 模组", game: "《我的世界》", note: "机制创新、兼容性、稳定性、前置依赖" },
  { code: "B", name: "MC 地图", game: "《我的世界》", note: "建筑、关卡、剧情、命令与游玩体验" },
  { code: "C", name: "RW 模组", game: "《铁锈战争》", note: "单位与机制设计、平衡性、联机兼容" },
  { code: "D", name: "RW 地图", game: "《铁锈战争》", note: "布局、触发器与脚本、对抗或合作体验" },
];

const DIMENSIONS = [
  ["可运行性与完成度", 30],
  ["创意与主题契合度", 25],
  ["玩法 / 地图设计质量", 20],
  ["技术实现与稳定性", 15],
  ["表现力与平衡性", 10],
];

const FAQS = [
  ["谁可以参加？", "个人或 3–5 人团队都可以，全程线上，不设路演。每人只能参加 1 个作品，不得跨队协助。"],
  ["需要准备什么？", "正版游戏环境、能独立运行的作品包（≤200 MB）、3–5 分钟演示视频，以及依赖与许可证清单。"],
  ["主题什么时候公布？", "赛前公布方向性主题词供构思，开幕时公布正式题目与特别要求，开发计时从开幕开始。"],
  ["可以提交几件作品？", "每人只能参加 1 个作品；同一作品不得跨赛道重复提交。截止前可重复提交，以最后一次为准。"],
  ["怎么评审？", "五个维度加权打分，评委独立评审；总分低于 60 分不授予等级奖，同分按可运行性、创意、玩法依次排序。"],
  ["结果什么时候公布？", "评审截止后统一公示，公示 24 小时无异议后颁奖；全程线上，不设现场路演。"],
];

function siteSeo() {
  try {
    return local.getSettings().seo || {};
  } catch (_) {
    return {};
  }
}

const PRIVATE_RE = /^\/(admin|me|team|work|judge|login|certificate|receipt|cnkd|verify)(\/|$)/;

const isBot = (ua) => BOT_RE.test(String(ua || ""));

function table(name) {
  try {
    return local.rows(name) || [];
  } catch (_) {
    return [];
  }
}

function activity() {
  const row = table("activity")[0];
  return (row && row.data) || {};
}

function activityUpdated() {
  const row = table("activity")[0];
  return row && row.updated_at;
}

function rulesDoc() {
  return table("documents").find((d) => d.doc_key === "rules") || null;
}

function submissions() {
  return table("submissions");
}

function publicWorks() {
  return submissions().filter((s) => s.status === "public");
}

function teams() {
  return table("teams");
}

function profiles() {
  return table("profiles");
}

function reviews() {
  return table("reviews");
}

function announcements() {
  return table("announcements")
    .slice()
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || new Date(b.created_at) - new Date(a.created_at));
}

function partners() {
  return table("partners").slice().sort((a, b) => (a.sort || 100) - (b.sort || 100));
}

const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const xesc = (s) => esc(s);
const iso = (v) => {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d) ? "" : d.toISOString().slice(0, 10);
};

function teamName(sub) {
  if (sub.owner_name) return sub.owner_name;
  const t = teams().find((x) => x.id === sub.team_id);
  return (t && t.name) || "匿名队伍";
}

function fmtDate(v) {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d)) return "";
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

function absolute(origin, p) {
  return origin + (p === "/" ? "/" : p);
}

/* ------------------------------ 元信息 ------------------------------ */

function pageMeta(pathname, origin) {
  const p = pathname === "/index.html" ? "/" : pathname;
  const a = activity();
  const home = {
    title: `${SITE} · 我的世界 × 铁锈战争 限时创作`,
    desc: DEFAULT_DESC,
    canonical: origin + "/",
    type: "website",
    ld: {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Event",
          name: `${SITE} · 我的世界 × 铁锈战争 限时创作`,
          description: DEFAULT_DESC,
          eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
          eventStatus: "https://schema.org/EventScheduled",
          startDate: a.eventStart,
          endDate: a.submitDeadline,
          location: { "@type": "VirtualLocation", url: origin + "/" },
          organizer: { "@type": "Organization", name: `${SITE}组委会`, url: origin + "/" },
          image: [origin + OG_IMAGE],
          url: origin + "/",
          inLanguage: "zh-CN",
        },
        {
          "@type": "Organization",
          name: `${SITE}组委会`,
          url: origin + "/",
          logo: origin + "/assets/logo.svg",
        },
        {
          "@type": "WebSite",
          name: SITE,
          url: origin + "/",
          inLanguage: "zh-CN",
        },
        {
          "@type": "FAQPage",
          mainEntity: FAQS.map(([q, ans]) => ({
            "@type": "Question",
            name: q,
            acceptedAnswer: { "@type": "Answer", text: ans },
          })),
        },
      ],
    },
  };
  if (p === "/" || p === "/home") return home;

  if (p === "/rules") {
    const doc = rulesDoc();
    return {
      title: `${(doc && doc.title) || "活动规则"} · ${SITE}`,
      desc: "像素松活动规则：赛制与时间、四条赛道、提交材料、原创性边界、兼容性测试、评审与奖项、知识产权与违规处理。",
      canonical: origin + "/rules",
      type: "article",
      ld: {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: (doc && doc.title) || "活动规则",
        description: "像素松活动规则与参赛约束。",
        url: origin + "/rules",
        dateModified: doc && doc.updated_at,
        publisher: { "@type": "Organization", name: `${SITE}组委会` },
      },
    };
  }

  if (p === "/works") {
    return {
      title: `参赛作品 · ${SITE}`,
      desc: "浏览像素松已公示的参赛作品，按赛道筛选，查看作品介绍与队伍信息。",
      canonical: origin + "/works",
      type: "website",
      ld: {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "参赛作品",
        url: origin + "/works",
        mainEntity: {
          "@type": "ItemList",
          itemListElement: publicWorks()
            .slice(0, 50)
            .map((w, i) => ({
              "@type": "ListItem",
              position: i + 1,
              url: origin + `/works/${w.id}`,
              name: w.title,
            })),
        },
      },
    };
  }

  if (/^\/works\/\d+$/.test(p)) {
    const id = Number(p.split("/")[2]);
    const w = publicWorks().find((s) => Number(s.id) === id);
    if (!w) return { title: `作品不存在 · ${SITE}`, desc: "这件作品尚未公示，或已被撤回。", canonical: origin + p, noindex: true };
    return {
      title: `${w.title} · ${SITE}`,
      desc: w.summary || `${w.title} · 像素松参赛作品`,
      canonical: origin + p,
      type: "article",
      ld: {
        "@context": "https://schema.org",
        "@type": "CreativeWork",
        name: w.title,
        description: w.summary || "",
        url: origin + p,
        genre: (TRACKS.find((t) => t.code === w.track) || {}).name || w.track,
        author: { "@type": "Organization", name: teamName(w) },
        datePublished: w.created_at,
      },
    };
  }

  if (p === "/results") {
    return {
      title: `作品与结果 · ${SITE}`,
      desc: "像素松各赛道作品排名与评委均分，按赛道独立排序。",
      canonical: origin + "/results",
      type: "website",
      ld: {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "作品与结果",
        url: origin + "/results",
      },
    };
  }

  if (p === "/judges") {
    return {
      title: `评委团 · ${SITE}`,
      desc: "像素松评委团成员与评审分工。",
      canonical: origin + "/judges",
      type: "website",
      ld: {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "评委团",
        url: origin + "/judges",
      },
    };
  }

  if (p === "/notices") {
    return {
      title: `公告 · ${SITE}`,
      desc: "像素松赛程变更、评审安排与重要通知。",
      canonical: origin + "/notices",
      type: "website",
      ld: { "@context": "https://schema.org", "@type": "CollectionPage", name: "公告", url: origin + "/notices" },
    };
  }

  if (p === "/sponsors") {
    return {
      title: `鸣谢 · ${SITE}`,
      desc: "像素松的组织单位与赞助者名单。",
      canonical: origin + "/sponsors",
      type: "website",
      ld: { "@context": "https://schema.org", "@type": "CollectionPage", name: "鸣谢", url: origin + "/sponsors" },
    };
  }

  if (PRIVATE_RE.test(p)) {
    return {
      title: `${SITE} · 账号与后台`,
      desc: DEFAULT_DESC,
      canonical: origin + p,
      noindex: true,
      ld: null,
    };
  }

  return { title: `${SITE} · 页面不存在`, desc: "页面不存在。", canonical: origin + p, noindex: true, ld: null };
}

function verificationTags() {
  const c = siteSeo();
  const items = [
    ["google-site-verification", process.env.PS_SEO_GOOGLE || c.googleCode],
    ["baidu-site-verification", process.env.PS_SEO_BAIDU || c.baiduCode],
    ["msvalidate.01", process.env.PS_SEO_BING || c.bingCode],
  ].filter(([, v]) => v);
  return items.map(([k, v]) => `<meta name="${k}" content="${esc(v)}">`).join("\n");
}

function headTags(meta, origin) {
  const robots = meta.noindex ? "noindex, nofollow" : "index, follow";
  const tags = [
    `<link rel="canonical" href="${esc(meta.canonical)}">`,
    `<meta name="robots" content="${robots}">`,
    `<meta property="og:type" content="${esc(meta.type || "website")}">`,
    `<meta property="og:site_name" content="${esc(SITE)}">`,
    `<meta property="og:title" content="${esc(meta.title)}">`,
    `<meta property="og:description" content="${esc(meta.desc)}">`,
    `<meta property="og:url" content="${esc(meta.canonical)}">`,
    `<meta property="og:image" content="${esc(origin + OG_IMAGE)}">`,
    `<meta property="og:locale" content="zh_CN">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(meta.title)}">`,
    `<meta name="twitter:description" content="${esc(meta.desc)}">`,
    `<meta name="twitter:image" content="${esc(origin + OG_IMAGE)}">`,
    `<meta name="applicable-device" content="pc,mobile">`,
  ];
  const verify = verificationTags();
  if (verify) tags.push(verify);
  if (meta.ld) {
    tags.push(
      `<script type="application/ld+json">${JSON.stringify(meta.ld).replace(/</g, "\\u003c")}</script>`
    );
  }
  return tags.join("\n");
}

/** 给正常入口页注入 per-path 的 title/description/canonical/OG */
function injectSeo(html, pathname, origin) {
  const meta = pageMeta(pathname, origin);
  let out = html;
  out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(meta.title)}</title>`);
  out = out.replace(
    /<meta\s+name="description"[^>]*>/i,
    `<meta name="description" content="${esc(meta.desc)}">`
  );
  const tags = headTags(meta, origin);
  if (out.includes("<!--PS_SEO-->")) out = out.replace("<!--PS_SEO-->", tags);
  else out = out.replace("</head>", `${tags}\n</head>`);
  return out;
}

/* ------------------------------ 正文快照 ------------------------------ */

function mdToHtml(md) {
  const lines = String(md || "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let list = null;
  let para = [];
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join(" "))}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      out.push(`<ul>${list.map((x) => `<li>${inline(x)}</li>`).join("")}</ul>`);
      list = null;
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      flushList();
      continue;
    }
    if (/^###\s+/.test(line)) {
      flushPara();
      flushList();
      out.push(`<h3>${inline(line.replace(/^###\s+/, ""))}</h3>`);
    } else if (/^##\s+/.test(line)) {
      flushPara();
      flushList();
      out.push(`<h2>${inline(line.replace(/^##\s+/, ""))}</h2>`);
    } else if (/^[-*]\s+/.test(line)) {
      flushPara();
      if (!list) list = [];
      list.push(line.replace(/^[-*]\s+/, ""));
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return out.join("\n");
}

function inline(text) {
  return esc(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function factsHtml() {
  const a = activity();
  const facts = [
    ["比赛主题", a.theme || "—"],
    ["赛道", TRACKS.map((t) => `${t.code} ${t.name}`).join(" / ")],
    ["队伍", "3–5 人，也可个人参赛"],
    ["开发窗口", "72 小时，连续计时不补时"],
    ["提交截止", fmtDate(a.submitDeadline)],
    ["形式", a.venue || "全程线上"],
  ];
  return `<dl>${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
}

function worksListHtml(limit) {
  const list = publicWorks().slice(0, limit || 100);
  if (!list.length) return "<p>暂时还没有已公示的作品。</p>";
  return `<ul>${list
    .map(
      (w) =>
        `<li><a href="/works/${w.id}">${esc(w.title)}</a> · ${esc(
          (TRACKS.find((t) => t.code === w.track) || {}).name || w.track
        )} · ${esc(teamName(w))}<br>${esc(w.summary || "")}</li>`
    )
    .join("")}</ul>`;
}

function ranks() {
  const pub = publicWorks();
  const pubIds = new Set(pub.map((s) => Number(s.id)));
  const bySub = new Map();
  for (const r of reviews()) {
    if (r.status !== "submitted" && r.status !== "locked") continue;
    const id = Number(r.submission_id);
    if (!pubIds.has(id)) continue;
    const total = Number(r.total);
    if (!Number.isFinite(total) || total <= 0) continue;
    if (!bySub.has(id)) bySub.set(id, []);
    bySub.get(id).push(total);
  }
  return pub
    .map((w) => {
      const list = (bySub.get(Number(w.id)) || []).slice().sort((a, b) => a - b);
      const used = list.length >= 5 ? list.slice(1, -1) : list;
      const avg = used.length ? used.reduce((a, b) => a + b, 0) / used.length : 0;
      return { sub: w, count: list.length, avg: Math.round(avg * 10) / 10 };
    })
    .sort((a, b) => b.avg - a.avg);
}

function resultsHtml() {
  const all = ranks();
  if (!all.length) return "<p>暂时还没有已公示的作品。</p>";
  return TRACKS.map((t) => {
    const rows = all.filter((r) => r.sub.track === t.code);
    if (!rows.length) return "";
    return `<h2>赛道 ${t.code} · ${esc(t.name)}</h2><ol>${rows
      .map(
        (r) =>
          `<li><a href="/works/${r.sub.id}">${esc(r.sub.title)}</a> — ${
            r.count ? `${r.avg} 分（${r.count} 位评委）` : "暂无评分"
          }</li>`
      )
      .join("")}</ol>`;
  }).join("");
}

function contentFor(pathname) {
  const p = pathname === "/index.html" ? "/" : pathname;
  const a = activity();

  if (p === "/" || p === "/home") {
    return `
      <h1>像素松 · 我的世界 × 铁锈战争 限时创作</h1>
      <p>像素松是一场围绕《我的世界》与《铁锈战争》的限时创作活动：72 小时，一队 3–5 人，做出一个能装进游戏、别人下载后能跑起来的模组或地图。全程线上，不设路演，按赛道独立评审。</p>
      <p>比赛分四条赛道：MC 模组、MC 地图、RW 模组、RW 地图。报名、组队、作品提交、兼容性审核、评委打分与结果公示都在本平台完成。${a.theme ? `本期主题：${esc(a.theme)}。` : ""}</p>
      ${factsHtml()}
      <h2>四条赛道</h2>
      <ul>${TRACKS.map((t) => `<li>赛道 ${t.code} · ${esc(t.name)}（${esc(t.game)}）：${esc(t.note)}</li>`).join("")}</ul>
      <h2>赛程</h2>
      <ul>
        <li>报名与组队：截止 ${esc(fmtDate(a.signupDeadline))}</li>
        <li>开幕 · 发布正式题目：${esc(fmtDate(a.eventStart))}</li>
        <li>提交截止：${esc(fmtDate(a.submitDeadline))}</li>
        <li>评审与公示：${esc(fmtDate(a.judgeDeadline))}</li>
        <li>公示与颁奖：${esc(fmtDate(a.roadshowAt))}</li>
      </ul>
      <h2>怎么评</h2>
      <ul>${DIMENSIONS.map(([n, w]) => `<li>${esc(n)}：${w}%</li>`).join("")}</ul>
      <h2>常见问题</h2>
      ${FAQS.map(([q, ans]) => `<h3>${esc(q)}</h3><p>${esc(ans)}</p>`).join("")}
      <h2>已公示作品</h2>
      ${worksListHtml(20)}
    `;
  }
  if (p === "/rules") {
    const doc = rulesDoc();
    if (!doc) return "<h1>活动规则</h1><p>规则暂时无法加载。</p>";
    return `<h1>${esc(doc.title)}</h1>${factsHtml()}${mdToHtml(doc.body)}`;
  }
  if (p === "/works") {
    return `<h1>参赛作品</h1><p>共 ${publicWorks().length} 件已公示作品。</p>${worksListHtml(100)}`;
  }
  if (/^\/works\/\d+$/.test(p)) {
    const id = Number(p.split("/")[2]);
    const w = publicWorks().find((s) => Number(s.id) === id);
    if (!w) return null;
    const d = w.detail || {};
    const t = TRACKS.find((x) => x.code === w.track) || {};
    const rows = [
      ["赛道", `${w.track} · ${t.name || ""}`],
      ["队伍", teamName(w)],
      ["创意来源", d.origin],
      ["核心玩法", d.gameplay],
      ["技术实现", d.tech],
      ["亮点", d.highlight],
      ["安装说明", d.install],
      ["依赖与许可证", d.license],
      ["已知问题", d.known],
    ].filter(([, v]) => v && String(v).trim());
    return `<h1>${esc(w.title)}</h1>
      <p>${esc(w.summary || "")}</p>
      <dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
      <p><a href="/works">← 返回作品列表</a></p>`;
  }
  if (p === "/results") {
    return `<h1>作品与结果</h1><p>共 ${publicWorks().length} 件已公示作品，按赛道独立排序。</p>${resultsHtml()}`;
  }
  if (p === "/notices") {
    const list = announcements();
    return `<h1>公告</h1>${
      list.length
        ? `<ul>${list
            .map(
              (n) =>
                `<li><strong>${esc(n.title)}</strong> · ${esc(fmtDate(n.created_at))}<br>${esc(
                  String(n.body || "").replace(/\n+/g, " ")
                )}</li>`
            )
            .join("")}</ul>`
        : "<p>暂无公告。</p>"
    }`;
  }
  if (p === "/judges") {
    const list = profiles().filter((x) => x.role === "judge" || x.role === "admin");
    return `<h1>评委团</h1>${
      list.length
        ? `<ul>${list
            .map((j) => `<li>${esc(j.nickname || j.owner_name || "未命名")}${j.title ? " · " + esc(j.title) : ""}</li>`)
            .join("")}</ul>`
        : "<p>评委名单待公布。</p>"
    }`;
  }
  if (p === "/sponsors") {
    const list = partners();
    return `<h1>鸣谢</h1>${
      list.length
        ? `<ul>${list
            .map((x) => `<li>${esc(x.name)}${x.role ? " · " + esc(x.role) : ""}${x.url ? ` · ${esc(x.url)}` : ""}</li>`)
            .join("")}</ul>`
        : "<p>名单待公布。</p>"
    }`;
  }
  return null;
}

/** 给爬虫的静态快照；返回 null 表示不是公开页面 */
function renderBotPage(pathname, origin) {
  const p = pathname === "/index.html" ? "/" : pathname;
  const meta = pageMeta(p, origin);
  const content = contentFor(p);
  if (content == null) {
    return {
      status: 404,
      html: `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>页面不存在 · ${esc(
        SITE
      )}</title><meta name="robots" content="noindex, nofollow"><link rel="canonical" href="${esc(
        origin + p
      )}"></head><body><h1>404 · 页面不存在</h1><p><a href="/">返回首页</a></p></body></html>`,
    };
  }
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.title)}</title>
<meta name="description" content="${esc(meta.desc)}">
${headTags(meta, origin)}
<style>
  body{font:15px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#1b211d;background:#fbfcf9}
  a{color:#0b7d57}
  h1{font-size:30px;line-height:1.25;margin:0 0 12px}
  h2{font-size:20px;margin:30px 0 10px;border-bottom:1px solid #e4e8e2;padding-bottom:6px}
  h3{font-size:16px;margin:20px 0 8px}
  dl{display:grid;grid-template-columns:88px 1fr;gap:6px 12px;margin:18px 0}
  dt{color:#5d6a62}
  dd{margin:0}
  ul,ol{padding-left:22px}
  li{margin:6px 0}
  code{background:#eef1ec;padding:1px 4px;border-radius:3px}
  nav{margin-bottom:26px;font-size:13px}
</style>
</head>
<body>
<nav><a href="/">${esc(SITE)}</a> · <a href="/rules">规则</a> · <a href="/works">参赛作品</a> · <a href="/results">结果</a> · <a href="/judges">评委团</a> · <a href="/notices">公告</a> · <a href="/sponsors">鸣谢</a></nav>
<main>${content}</main>
<footer style="margin-top:40px;padding-top:16px;border-top:1px solid #e4e8e2;color:#7a857e;font-size:12px">
  ${esc(SITE)} · ${esc(venueLabel())} <a href="/">返回首页</a>
</footer>
</body>
</html>`;
  return { status: 200, html };
}

function venueLabel() {
  const a = activity();
  return a.venue || "全程线上";
}

/* ------------------------------ robots / sitemap ------------------------------ */

function robotsTxt(origin) {
  let host = "";
  try {
    host = new URL(origin).host;
  } catch (_) {}
  return [
    "User-agent: *",
    "Allow: /",
    ...(host ? [`Host: ${host}`] : []),
    "Disallow: /admin",
    "Disallow: /me",
    "Disallow: /team",
    "Disallow: /login",
    "Disallow: /certificate",
    "Disallow: /receipt",
    "Disallow: /verify",
    "Disallow: /api/",
    "Disallow: /.cloud/",
    "",
    "# /work 与 /judge 不在这里屏蔽，避免前缀误伤 /works 与 /judges；",
    "# 它们自身靠 X-Robots-Tag: noindex 处理",
    "Allow: /works",
    "Allow: /judges",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

/** 所有可公开收录的 URL，sitemap 与主动推送共用 */
function publicUrls(origin) {
  const a = activity();
  const doc = rulesDoc();
  const works = publicWorks();
  const revs = reviews().filter((r) => r.status === "submitted" || r.status === "locked");
  const latestReview = revs.reduce((m, r) => Math.max(m, new Date(r.updated_at || 0).getTime() || 0), 0);
  return [
    { loc: "/", lastmod: iso(activityUpdated() || a.submitDeadline), priority: "1.0", changefreq: "daily" },
    { loc: "/rules", lastmod: iso(doc && doc.updated_at), priority: "0.8", changefreq: "weekly" },
    { loc: "/works", lastmod: iso(works.reduce((m, w) => Math.max(m, new Date(w.created_at || 0).getTime() || 0), 0)), priority: "0.9", changefreq: "daily" },
    { loc: "/results", lastmod: iso(latestReview || undefined), priority: "0.9", changefreq: "daily" },
    ...works.map((w) => ({
      loc: `/works/${w.id}`,
      lastmod: iso(w.updated_at || w.created_at),
      priority: "0.7",
      changefreq: "weekly",
    })),
    { loc: "/judges", lastmod: iso(activityUpdated()), priority: "0.5", changefreq: "monthly" },
    { loc: "/notices", lastmod: iso((announcements()[0] || {}).created_at), priority: "0.6", changefreq: "weekly" },
    { loc: "/sponsors", lastmod: iso(activityUpdated()), priority: "0.4", changefreq: "monthly" },
  ].filter((u) => u.loc);
}

function sitemapXml(origin) {
  const urls = publicUrls(origin);
  const body = urls
    .map(
      (u) =>
        `  <url><loc>${xesc(absolute(origin, u.loc))}</loc>${
          u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""
        }<changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

module.exports = {
  isBot,
  robotsTxt,
  sitemapXml,
  publicUrls,
  injectSeo,
  renderBotPage,
  pageMeta,
  siteSeo,
};
