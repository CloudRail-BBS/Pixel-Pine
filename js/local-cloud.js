/**
 * 本地模式的云客户端
 *
 * 与 WorkBuddy Cloud SDK 保持同一套调用形状（database / auth / storage），
 * 这样所有页面代码不用改。实际请求打到同源的 /.cloud/local/*。
 */

const jsonHeaders = { "content-type": "application/json" };
const REQUEST_TIMEOUT = 15000;

async function post(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(body || {}),
      credentials: "same-origin",
      signal: controller.signal,
    });
    let payload = null;
    try {
      payload = await res.json();
    } catch (_) {}
    if (!res.ok) {
      const err = (payload && payload.error) || {};
      return { data: null, error: { code: err.code || String(res.status), message: err.message || "请求失败", status: res.status } };
    }
    return { data: payload ? payload.data : null, error: null };
  } catch (e) {
    const aborted = e && e.name === "AbortError";
    return {
      data: null,
      error: {
        code: aborted ? "timeout" : "network",
        message: aborted ? "请求超时，服务器没有响应" : "网络异常，无法连接服务器",
        status: 0,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

function builder(table) {
  const q = {
    table,
    action: "select",
    columns: "*",
    filters: [],
    order: [],
    limit: null,
    values: null,
    ignoreDuplicates: false,
    single: null,
  };

  const api = {
    select(cols) {
      q.columns = cols || "*";
      return api;
    },
    eq(key, value) {
      q.filters.push({ op: "eq", key, value });
      return api;
    },
    in(key, value) {
      q.filters.push({ op: "in", key, value });
      return api;
    },
    order(key, opts) {
      q.order.push({ key, ascending: !(opts && opts.ascending === false) });
      return api;
    },
    limit(n) {
      q.limit = n;
      return api;
    },
    insert(values) {
      q.action = "insert";
      q.values = values;
      return api;
    },
    update(values) {
      q.action = "update";
      q.values = values;
      return api;
    },
    delete() {
      q.action = "delete";
      return api;
    },
    upsert(values, opts) {
      q.action = "upsert";
      q.values = values;
      q.ignoreDuplicates = Boolean(opts && opts.ignoreDuplicates);
      return api;
    },
    maybeSingle() {
      q.single = "maybe";
      return api;
    },
    single() {
      q.single = "one";
      return api;
    },
    then(resolve, reject) {
      return run(q).then(resolve, reject);
    },
  };
  return api;
}

async function run(q) {
  const out = await post("/.cloud/local/db", {
    table: q.table,
    action: q.action,
    columns: q.columns,
    filters: q.filters,
    order: q.order,
    limit: q.limit,
    values: q.values,
    ignoreDuplicates: q.ignoreDuplicates,
  });
  if (out.error) return out;
  let data = out.data;
  if (q.single === "maybe") data = Array.isArray(data) && data.length ? data[0] : null;
  else if (q.single === "one") data = Array.isArray(data) && data.length ? data[0] : null;
  return { data, error: null };
}

function unavailable(feature) {
  return {
    data: null,
    error: { code: "local_unsupported", message: `本地模式不支持${feature}，请使用邮箱 + 密码登录` },
  };
}

export function createLocalCloud(config) {
  void config;
  return {
    endpoint: location.origin,
    database: {
      from: (table) => builder(table),
      rpc: (name, args) => post("/.cloud/local/rpc", { name, args }),
    },
    auth: {
      async getSession() {
        const res = await fetch("/.cloud/local/auth/session", { credentials: "same-origin" });
        if (!res.ok) return { data: null, error: null };
        const j = await res.json().catch(() => ({}));
        return { data: j.data || null, error: null };
      },
      async signInWithPassword({ email, password }) {
        return post("/.cloud/local/auth/login", { email, password });
      },
      async signOut() {
        return post("/.cloud/local/auth/logout");
      },
      async resetPasswordForOld({ oldPassword, newPassword }) {
        return post("/.cloud/local/auth/password", { oldPassword, newPassword });
      },
      async updateUser({ password }) {
        return post("/.cloud/local/auth/me", { password });
      },
      async sendOtp({ email }) {
        return post("/.cloud/local/auth/otp/send", { email });
      },
      async verifyOtp({ email, verificationId, token }) {
        return post("/.cloud/local/auth/otp/verify", { email, verificationId, code: token });
      },
      async resetPasswordForEmail() {
        return unavailable("邮件重置密码");
      },
      async signInWithOAuth() {
        return unavailable("第三方登录");
      },
      async handleWorkBuddyCallback() {
        return unavailable("第三方登录");
      },
      async handleWechatWebCallback() {
        return unavailable("第三方登录");
      },
    },
    storage: {
      userPath(uid, p) {
        return `users/${uid}/${String(p || "").replace(/^\/+/, "")}`;
      },
      sharedPath(uid, p) {
        return `shared/${uid}/${String(p || "").replace(/^\/+/, "")}`;
      },
      async upload(filePath, file) {
        const res = await fetch(`/.cloud/local/file?path=${encodeURIComponent(filePath)}`, {
          method: "POST",
          headers: { "content-type": file.type || "application/octet-stream" },
          body: file,
          credentials: "same-origin",
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) return { data: null, error: { message: (j && j.error) || "上传失败" } };
        return { data: j.data, error: null };
      },
      async remove(paths) {
        return post("/.cloud/local/file/remove", { paths });
      },
      async copy(from, to) {
        return post("/.cloud/local/file/copy", { from, to });
      },
      async createSignedUrl(filePath, ttl) {
        return post("/.cloud/local/file/sign", { path: filePath, ttl });
      },
    },
  };
}
