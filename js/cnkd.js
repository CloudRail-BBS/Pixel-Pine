let cfg = null;

export async function cnkdConfig() {
  if (cfg) return cfg;
  try {
    const r = await fetch("/api/cnkd/config", { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error("bad status");
    cfg = await r.json();
  } catch (_) {
    cfg = { enabled: false, mode: "public", scope: "", site: "https://cloud.cnkd.fun" };
  }
  return cfg;
}

export function startCnkdLogin() {
  location.assign("/api/cnkd/start");
}

export async function fetchCnkdTicket(ticket) {
  const r = await fetch("/api/cnkd/session?ticket=" + encodeURIComponent(ticket));
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) {
    const map = {
      ticket_invalid: "登录凭证无效或已被使用，请重新发起",
      ticket_expired: "登录凭证已过期，请重新发起",
    };
    throw new Error(map[j.reason] || "无法读取 CNKD 身份");
  }
  return j.profile;
}
