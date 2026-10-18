const GT_SRC = "https://static.geetest.com/v4/gt4.js";

let scriptPromise = null;
let cfgCache = null;

async function loadScript() {
  if (window.initGeetest4) return true;
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = GT_SRC;
    s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error("极验脚本加载失败"));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export async function getConfig() {
  if (cfgCache) return cfgCache;
  try {
    const r = await fetch("/api/geetest/config", { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error("bad status");
    const j = await r.json();
    cfgCache = { enabled: !!j.enabled, captchaId: j.captchaId || null };
  } catch (_) {
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
 * 服务端未配置时直接放行（降级），由邮箱验证码自身的频率限制兜底。
 */
export function verifyCaptcha(timeoutMs = 120000) {
  return new Promise(async (resolve) => {
    const cfg = await getConfig();
    if (!cfg.enabled || !cfg.captchaId) {
      resolve({ ok: true, skipped: true });
      return;
    }
    try {
      await loadScript();
    } catch (e) {
      resolve({ ok: false, reason: "极验脚本未能加载，请检查网络或关闭拦截插件" });
      return;
    }
    if (typeof window.initGeetest4 !== "function") {
      resolve({ ok: false, reason: "极验组件不可用" });
      return;
    }

    let settled = false;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, reason: "验证超时，请重试" }), timeoutMs);

    try {
      window.initGeetest4(
        {
          captchaId: cfg.captchaId,
          product: "popup",
          language: "zho",
          hideBar: ["close"],
        },
        (captcha) => {
          captcha.onSuccess(async () => {
            const v = captcha.getValidate && captcha.getValidate();
            if (!v) return finish({ ok: false, reason: "未取得验证凭证" });
            try {
              const r = await fetch("/api/geetest/validate", {
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
              finish({ ok: false, reason: j.reason === "not_configured" ? "" : "人机验证未通过，请重试" });
            } catch (_) {
              finish({ ok: false, reason: "校验请求失败，请检查网络" });
            }
          });
          captcha.onError(() => finish({ ok: false, reason: "验证出错，请刷新后重试" }));
          captcha.onClose(() => finish({ ok: false, reason: "已取消人机验证" }));
          if (typeof captcha.showCaptcha === "function") captcha.showCaptcha();
          else if (typeof captcha.showBox === "function") captcha.showBox();
          else if (typeof captcha.verify === "function") captcha.verify();
        }
      );
    } catch (e) {
      finish({ ok: false, reason: "极验初始化失败" });
    }
  });
}
