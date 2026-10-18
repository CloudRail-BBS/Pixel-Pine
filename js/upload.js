import { cloud, sessionUid, state } from "./core.js";

export const MAX_UPLOAD_MB = 200;

export function fmtSize(bytes) {
  if (!bytes) return "—";
  const mb = bytes / 1048576;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function safeName(name) {
  const base = String(name || "file")
    .replace(/[^\w.\-\u4e00-\u9fa5]+/g, "_")
    .replace(/_+/g, "_")
    .slice(-90);
  return base || "file";
}

/** 浏览器端计算 SHA-256，替代让用户手抄 certutil 输出 */
export async function sha256File(file) {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function scanHash(hash) {
  const r = await fetch("/api/scan?hash=" + encodeURIComponent(hash));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("扫描请求失败");
  return j;
}

/**
 * 上传到 users/<uid>/submissions/<subId>/...
 * 截止前只有本队队长能读写；评委看不到。
 */
export async function uploadWorkFile(file, submissionId) {
  const uid = sessionUid();
  if (!uid) throw new Error("请先登录");
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    throw new Error(`文件超过 ${MAX_UPLOAD_MB} MB，请精简后重试（可剔除无关资源）`);
  }
  const path = cloud.storage.userPath(
    uid,
    `submissions/${submissionId || "draft"}/${Date.now()}-${safeName(file.name)}`
  );
  const res = await cloud.storage.upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
    metadata: { purpose: "submission" },
  });
  if (res.error) throw res.error;
  return {
    path: (res.data && res.data.path) || path,
    name: file.name,
    size: file.size,
    type: file.type || "application/octet-stream",
  };
}

/**
 * 截止后把作品包复制到 shared/，评委与其他登录用户才可读。
 * 源文件在队长自己的 users/ 下，队长同时具备源读与目标写权限。
 */
export async function publishWorkFile(userPath, submissionId) {
  const uid = sessionUid();
  if (!uid) throw new Error("请先登录");
  const filename = String(userPath).split("/").pop();
  const target = cloud.storage.sharedPath(uid, `submissions/${submissionId}/${filename}`);
  const res = await cloud.storage.copy(userPath, target);
  if (res.error) throw res.error;
  return (res.data && res.data.path) || target;
}

export async function signedDownload(path, ttl = 3600) {
  const res = await cloud.storage.createSignedUrl(path, ttl);
  if (res.error) throw res.error;
  const d = res.data || {};
  return d.signedUrl || d.url || d.signedURL || null;
}

export async function removeWorkFile(path) {
  const res = await cloud.storage.remove([path]);
  if (res.error) throw res.error;
  return true;
}

