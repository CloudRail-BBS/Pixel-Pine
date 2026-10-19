import { cloud, state, loadSession, loadMe, loadActivity, route, render, navigate, esc, initTheme } from "./core.js";
import {
  homeView, rulesView, loginView, resultsView, noticesView, cnkdView, worksView, workDetailView,
  judgesView, sponsorsView,
} from "./views-public.js";

const lazyView = (loader, name) => async (el, path) => {
  const mod = await loader();
  return mod[name](el, path);
};

const work = () => import("./views-work.js");
const admin = () => import("./views-admin.js");
const cert = () => import("./views-cert.js");

async function restoreAuth() {
  const url = new URL(location.href);
  if (!url.searchParams.has("code") && !url.searchParams.has("error")) {
    await loadSession();
    return;
  }
  const provider = url.searchParams.get("provider");
  if (provider !== "wechat" && provider !== "workbuddy") {
    await loadSession();
    return;
  }
  const handler =
    provider === "workbuddy" ? cloud.auth.handleWorkBuddyCallback : cloud.auth.handleWechatWebCallback;
  if (typeof handler !== "function") {
    console.warn("[auth] SDK 缺少回调处理能力");
    await loadSession();
    return;
  }
  try {
    const { data, error } = await handler.call(cloud.auth);
    if (error) {
      console.warn("[auth] 回调失败", error.message);
    } else if (data) {
      for (const k of ["code", "state", "provider"]) url.searchParams.delete(k);
      history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
  } catch (e) {
    console.warn("[auth] 回调异常", e?.message);
  }
  await loadSession();
}

function registerRoutes() {
  route("/home", homeView);
  route("/rules", rulesView);
  route("/login", async (el) => {
    if (state.session) return navigate("/me", true);
    return loginView(el);
  });
  route("/results", resultsView);
  route("/works", worksView);
  route("/works/*", workDetailView);
  route("/judges", judgesView);
  route("/sponsors", sponsorsView);
  route("/notices", noticesView);
  route("/cnkd", cnkdView);
  route("/me", lazyView(work, "meView"));
  route("/team", lazyView(work, "teamView"));
  route("/work", lazyView(work, "workView"));
  route("/integrity", lazyView(work, "integrityView"));
  route("/certificate", lazyView(cert, "certListView"));
  route("/certificate/*", lazyView(cert, "certDetailView"));
  route("/verify", lazyView(cert, "verifyView"));
  route("/receipt/*", lazyView(cert, "receiptView"));
  route("/judge", lazyView(work, "judgeView"));
  route("/admin", lazyView(admin, "adminView"));
  route("/admin/*", lazyView(admin, "adminView"));
  route("*", homeView);
}

function bootErrorText(e) {
  if (typeof e === "string") return e;
  if (e && typeof e.message === "string" && e.message.trim()) return e.message;
  if (e && e.error && typeof e.error.description === "string") return e.error.description;
  try {
    const s = JSON.stringify(e);
    if (s && s !== "{}") return s;
  } catch (_) {}
  return "数据服务没有响应，请刷新重试；若持续出现，检查服务器能否访问数据面。";
}

async function boot() {
  const app = document.getElementById("app");
  try {
    if (!window.WorkBuddyCloud && !(window.__PS_CONFIG__ && window.__PS_CONFIG__.local)) {
      throw new Error("SDK 未加载，请刷新页面或检查静态资源是否完整");
    }
    // 会话、活动配置失败不应该把整站打成白屏，降级继续渲染
    initTheme();
    await restoreAuth().catch((e) => console.warn("[boot] session", e));
    await loadActivity().catch((e) => console.warn("[boot] activity", e));
    if (state.session) await loadMe(true).catch((e) => console.warn("[boot] me", e));
    registerRoutes();
    if (!location.hash) location.replace("#/home");
    window.addEventListener("hashchange", render);
    app.classList.remove("boot");
    await render();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div style="max-width:560px;margin:16vh auto;padding:24px;text-align:center">
      <h2 style="margin-bottom:10px">无法载入</h2>
      <p class="muted small" style="word-break:break-word">${esc(bootErrorText(e))}</p>
      <button class="btn" onclick="location.reload()" style="margin-top:14px">重新加载</button>
    </div>`;
  }
}

boot();
