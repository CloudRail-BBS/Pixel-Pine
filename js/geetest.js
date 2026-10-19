const GT_SRC = "https://static.geetest.com/v4/gt4.js";

// 每一段都必须有上限，否则网络半开时会永远停在「验证中…」
const CFG_TIMEOUT = 5000; // 读后端配置
const SCRIPT_TIMEOUT = 8000; // 拉极验脚本
const INIT_TIMEOUT = 8000; // 组件就绪（不弹窗基本就是配置或网络问题）
const POPUP_TIMEOUT = 6000; // 回调之后弹窗必须真的出现
const SOLVE_TIMEOUT = 60000; // 留给用户完成拼图
const VALIDATE_TIMEOUT = 10000; // 服务端二次校验

let scriptPromise = null;
let cfgCache = null;

/** 极验的节点都带 geetest 前缀，弹窗也可能用 iframe 渲染 */
function geetestPopupCandidates() {
  return [...document.querySelectorAll('[class*="geetest"], [id*="geetest"], iframe[src*="geetest"]')].filter(
    (n) => {
      const r = n.getBoundingClientRect();
      return r.width > 40 && r.height > 40;
    }
  );
}

function geetestPopupVisible() {
  return geetestPopupCandidates().length > 0;
}

function timeoutFetch(url, ms, opts) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...(opts || {}), signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function loadScript() {
  if (window.initGeetest4) return true;
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = GT_SRC;
    s.async = true;
    const timer = setTimeout(() => {
      scriptPromise = null;
      reject(new Error("极验脚本加载超时，请检查网络或关闭拦截插件"));
    }, SCRIPT_TIMEOUT);
    s.onload = () => {
      clearTimeout(timer);
      resolve(true);
    };
    s.onerror = () => {
      clearTimeout(timer);
      scriptPromise = null;
      reject(new Error("极验脚本加载失败，请检查网络或关闭拦截插件"));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export async function getConfig() {
  if (cfgCache) return cfgCache;
  try {
    const r = await timeoutFetch("/api/geetest/config", CFG_TIMEOUT, {
      headers: { accept: "application/json" },
    });
    if (!r.ok) throw new Error("bad status");
    const j = await r.json();
    cfgCache = { enabled: !!j.enabled, captchaId: j.captchaId || null };
  } catch (_) {
    // 读不到配置就按未启用处理：真正的把关在服务端 /api/geetest/validate
    cfgCache = { enabled: false, captchaId: null };
  }
  return cfgCache;
}

export async function geetestEnabled() {
  const c = await getConfig();
  return !!(c.enabled && c.captchaId);
}

/**
 * 走一次极验，并把凭证交给服务端二次校验。
 *
 * 任何一步失败或超时都返回 { ok:false, reason }，不会挂起；
 * 服务端未配置时直接放行（降级），由验证码自身的频率限制兜底。
 *
 * @param {{enabled:boolean, captchaId?:string}} [prefetched]
 *        登录页已经从 /api/auth/config 拿到的配置。传了就省掉一次请求，
 *        未启用时零延迟放行。
 */
export async function verifyCaptcha(prefetched) {
  let enabled = null;
  let captchaId = null;
  if (prefetched && typeof prefetched === "object" && typeof prefetched.enabled === "boolean") {
    enabled = prefetched.enabled;
    captchaId = prefetched.captchaId || null;
  } else {
    const cfg = await getConfig();
    enabled = cfg.enabled;
    captchaId = cfg.captchaId;
  }

  if (!enabled) return { ok: true, skipped: true };
  if (!captchaId) {
    const cfg = await getConfig();
    if (!cfg.enabled || !cfg.captchaId) {
      return { ok: false, reason: "人机验证配置不完整，请联系主办方检查 Captcha ID" };
    }
    captchaId = cfg.captchaId;
  }

  const t0 = performance.now();
  try {
    await loadScript();
  } catch (e) {
    console.info("[geetest] 脚本加载失败", e && e.message);
    return { ok: false, reason: e.message || "极验脚本未能加载" };
  }
  if (typeof window.initGeetest4 !== "function") {
    console.info("[geetest] 脚本已加载但 initGeetest4 不可用");
    return { ok: false, reason: "极验组件不可用，请刷新页面后重试" };
  }
  console.info(`[geetest] 准备初始化 captchaId=${String(captchaId).slice(0, 8)}… 脚本耗时=${Math.round(performance.now() - t0)}ms`);

  return new Promise((resolve) => {
    let settled = false;
    let inited = false;
    let solveTimer = null;
    let popupTimer = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(initTimer);
      clearTimeout(solveTimer);
      if (popupTimer) clearInterval(popupTimer);
      console.info("[geetest] 结果", result.ok ? "通过" : "未通过", result.reason || "", `耗时=${Math.round(performance.now() - t0)}ms`);
      resolve(result);
    };

    // 组件迟迟不回调，说明 Captcha ID / 域名白名单 / 网络有问题，直接给出可读提示
    const initTimer = setTimeout(() => {
      if (!inited) {
        console.info("[geetest] 初始化超时：initGeetest4 回调未触发");
        finish({
          ok: false,
          reason: "人机验证组件未就绪，请确认极验 Captcha ID 与域名白名单配置正确",
        });
      }
    }, INIT_TIMEOUT);

    try {
      window.initGeetest4(
        {
          captchaId,
          product: "popup",
          language: "zho",
        },
        (captcha) => {
          inited = true;
          clearTimeout(initTimer);
          console.info(
            `[geetest] 组件回调 ${Math.round(performance.now() - t0)}ms`,
            "方法:",
            Object.keys(captcha || {}).filter((k) => typeof captcha[k] === "function").join(",")
          );
          solveTimer = setTimeout(() => finish({ ok: false, reason: "人机验证超时，请重试" }), SOLVE_TIMEOUT);

          captcha.onSuccess(async () => {
            const v = captcha.getValidate && captcha.getValidate();
            if (!v) return finish({ ok: false, reason: "未取得验证凭证，请重试" });
            try {
              const r = await timeoutFetch("/api/geetest/validate", VALIDATE_TIMEOUT, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  lot_number: v.lot_number,
                  captcha_output: v.captcha_output,
                  pass_token: v.pass_token,
                  gen_time: v.gen_time,
                }),
              });
              const j = await r.json();
              if (j && j.ok) return finish({ ok: true });
              finish({
                ok: false,
                reason: j.reason === "not_configured" ? "" : "人机验证未通过，请重试",
              });
            } catch (_) {
              finish({ ok: false, reason: "校验请求失败，请检查网络" });
            }
          });

          captcha.onError(() => finish({ ok: false, reason: "验证出错，请刷新后重试" }));
          captcha.onClose(() => finish({ ok: false, reason: "已取消人机验证" }));

          const hasShow =
            typeof captcha.showCaptcha === "function" ||
            typeof captcha.showBox === "function" ||
            typeof captcha.verify === "function";
          if (!hasShow) {
            return finish({
              ok: false,
              reason: "极验组件版本不兼容（没有显示方法），请刷新或更换网络环境重试",
            });
          }
          try {
            if (typeof captcha.showCaptcha === "function") captcha.showCaptcha();
            else if (typeof captcha.showBox === "function") captcha.showBox();
            else captcha.verify();
          } catch (_) {
            return finish({ ok: false, reason: "无法打开人机验证弹窗，请刷新后重试" });
          }

          // 配置不对时 showCaptcha 不报错、弹窗却根本不渲染，这里短轮询确认一次
          const popupStart = Date.now();
          popupTimer = setInterval(() => {
            if (settled) {
              clearInterval(popupTimer);
              return;
            }
            if (geetestPopupVisible()) {
              clearInterval(popupTimer);
              popupTimer = null;
              return;
            }
            if (Date.now() - popupStart > POPUP_TIMEOUT) {
              clearInterval(popupTimer);
              popupTimer = null;
              const all = document.querySelectorAll('[class*="geetest"], [id*="geetest"], iframe[src*="geetest"]');
              console.info(
                "[geetest] 未检测到可见弹窗，相关节点 " + all.length + " 个:",
                [...all].slice(0, 8).map((n) => {
                  const r = n.getBoundingClientRect();
                  return `${n.tagName}.${String(n.className || n.id).slice(0, 36)} ${Math.round(r.width)}x${Math.round(r.height)}`;
                })
              );
              finish({
                ok: false,
                reason: "人机验证没有弹出，请检查极验 Captcha ID 与域名白名单",
              });
            }
          }, 400);
        }
      );
    } catch (_) {
      finish({ ok: false, reason: "极验初始化失败，请刷新后重试" });
    }
  });
}
