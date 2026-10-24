/**
 * 页面级 SEO：标题、描述、canonical、Open Graph 与 JSON-LD。
 * 只操作 head，不依赖业务模块，避免和 core.js 形成循环引用。
 */

const SITE = "像素松";
const DEFAULT_DESC =
  "《我的世界》×《铁锈战争》「像素松」限时创作活动：72 小时组队创作，四条赛道独立评审，全程线上。报名、组队、提交、评审与结果公示都在这里。";
const OG_IMAGE = "/assets/og-cover.png";

const PRIVATE = [
  /^\/me\b/,
  /^\/team\b/,
  /^\/work\b/,
  /^\/judge\b/,
  /^\/admin\b/,
  /^\/login\b/,
  /^\/certificate\b/,
  /^\/receipt\b/,
  /^\/cnkd\b/,
];

const isPrivate = (path) => PRIVATE.some((re) => re.test(path));

function absolute(path) {
  const origin = typeof location !== "undefined" ? location.origin : "";
  if (!path || path === "/home") return origin + "/";
  return origin + path;
}

function upsertMeta(key, content, attr = "name") {
  if (typeof document === "undefined") return;
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertLink(rel, href) {
  if (typeof document === "undefined") return;
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

function setJsonLd(data) {
  if (typeof document === "undefined") return;
  const id = "ps-json-ld";
  let node = document.getElementById(id);
  if (!data) {
    if (node) node.remove();
    return;
  }
  if (!node) {
    node = document.createElement("script");
    node.type = "application/ld+json";
    node.id = id;
    document.head.appendChild(node);
  }
  const payload = Array.isArray(data) ? { "@context": "https://schema.org", "@graph": data } : data;
  node.textContent = JSON.stringify(payload);
}

/**
 * @param {object} opt
 * @param {string|null} opt.title 页面标题，null 表示用站点主标题
 * @param {string} [opt.desc]
 * @param {string} [opt.path] 干净路径（不含 hash），用于 canonical
 * @param {string} [opt.type] og:type
 * @param {boolean} [opt.noindex]
 * @param {object|object[]} [opt.jsonLd]
 */
export function setSeo(opt = {}) {
  const path = opt.path || "/";
  const title = opt.title ? `${opt.title} · ${SITE}` : `${SITE} · 我的世界 × 铁锈战争 限时创作`;
  const desc = opt.desc || DEFAULT_DESC;
  const url = absolute(path);
  const image = absolute(OG_IMAGE);

  if (typeof document !== "undefined") document.title = title;

  upsertMeta("description", desc);
  upsertMeta("robots", opt.noindex ? "noindex, nofollow" : "index, follow");
  upsertLink("canonical", url);

  upsertMeta("og:title", title, "property");
  upsertMeta("og:description", desc, "property");
  upsertMeta("og:type", opt.type || "website", "property");
  upsertMeta("og:url", url, "property");
  upsertMeta("og:site_name", SITE, "property");
  upsertMeta("og:image", image, "property");
  upsertMeta("og:locale", "zh_CN", "property");

  upsertMeta("twitter:card", "summary_large_image");
  upsertMeta("twitter:title", title);
  upsertMeta("twitter:description", desc);
  upsertMeta("twitter:image", image);

  setJsonLd(opt.jsonLd || null);
}

function eventLd(activity) {
  const a = activity || {};
  const ld = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: `${SITE} · ${a.theme || "限时创作"}`,
    description: DEFAULT_DESC,
    eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
    eventStatus: "https://schema.org/EventScheduled",
    location: { "@type": "VirtualLocation", url: absolute("/") },
    organizer: { "@type": "Organization", name: "像素松组委会", url: absolute("/") },
    image: [absolute(OG_IMAGE)],
    url: absolute("/"),
    inLanguage: "zh-CN",
  };
  if (a.eventStart) ld.startDate = a.eventStart;
  if (a.submitDeadline) ld.endDate = a.submitDeadline;
  return ld;
}

/** 路由切换时的兜底 meta；具体页面可以在加载完数据后再调用 setSeo 覆盖 */
export function defaultSeo(route, activity) {
  const base = String(route || "/home").split("?")[0];
  if (base === "/" || base === "/home") {
    setSeo({ path: "/", desc: DEFAULT_DESC, jsonLd: eventLd(activity) });
    return;
  }
  if (base === "/rules") {
    setSeo({
      title: "活动规则",
      desc: "像素松的赛制、赛道、提交材料、原创性边界、评审与奖项、知识产权与违规处理。",
      path: "/rules",
    });
    return;
  }
  if (base === "/works") {
    setSeo({
      title: "参赛作品",
      desc: "浏览像素松已公示的参赛作品，按赛道筛选，查看作品介绍与队伍信息。",
      path: "/works",
    });
    return;
  }
  if (base.startsWith("/works/")) {
    setSeo({ title: "作品详情", desc: "像素松参赛作品详情与队伍信息。", path: base });
    return;
  }
  if (base === "/results") {
    setSeo({
      title: "作品与结果",
      desc: "像素松各赛道作品排名与评委均分，按赛道独立排序。",
      path: "/results",
    });
    return;
  }
  if (base === "/judges") {
    setSeo({ title: "评委团", desc: "像素松评委团成员与评审分工。", path: "/judges" });
    return;
  }
  if (base === "/notices") {
    setSeo({ title: "公告", desc: "像素松赛程变更、评审安排与重要通知。", path: "/notices" });
    return;
  }
  if (base === "/sponsors") {
    setSeo({ title: "鸣谢", desc: "像素松的组织单位与赞助者名单。", path: "/sponsors" });
    return;
  }
  if (isPrivate(base)) {
    setSeo({ title: "账号", desc: DEFAULT_DESC, path: base, noindex: true });
    return;
  }
  setSeo({ path: base, noindex: true });
}
