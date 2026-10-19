let cfg = null;

// 不缓存：后台改完 CNKD 配置后，进登录页应立刻反映最新的启用状态
export async function cnkdConfig() {
  try {
    const r = await fetch("/api/cnkd/config", {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!r.ok) throw new Error("bad status");
    cfg = await r.json();
  } catch (_) {
    cfg = { enabled: false, mode: "public", scope: "", site: "https://cloud.cnkd.fun" };
  }
  return cfg;
}

export function startCnkdLogin(bind = false) {
  location.assign("/api/cnkd/start" + (bind ? "?bind=1" : ""));
}
