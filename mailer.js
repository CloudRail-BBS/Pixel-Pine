"use strict";

/**
 * 零依赖 SMTP 客户端
 *
 * 支持两种常见接入：
 *  - 465 隐式 TLS（secure: true）
 *  - 25 / 587 明文 + STARTTLS（secure: false，默认尝试 STARTTLS）
 *
 * 只实现发信所需的最小命令集：EHLO → [STARTTLS] → AUTH LOGIN → MAIL/RCPT/DATA。
 */

const net = require("net");
const tls = require("tls");

const CRLF = "\r\n";

function b64(s) {
  return Buffer.from(String(s), "utf8").toString("base64");
}

function encodeHeader(s) {
  const text = String(s || "");
  // 纯 ASCII 直接发，中文用 RFC 2047 编码
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${b64(text)}?=`;
}

function buildMessage(cfg, mail) {
  const from = cfg.fromEmail || cfg.user;
  const name = cfg.fromName ? `${encodeHeader(cfg.fromName)} ` : "";
  const body = Buffer.from(String(mail.text || ""), "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  const headers = [
    `From: ${name}<${from}>`,
    `To: <${mail.to}>`,
    `Subject: ${encodeHeader(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@${(from.split("@")[1] || "localhost")}>`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  return headers.join(CRLF) + CRLF + CRLF + body;
}

function sendMail(cfg, mail, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const host = String(cfg.host || "").trim();
    const port = Number(cfg.port) || (cfg.secure ? 465 : 587);
    if (!host) return reject(new Error("未配置 SMTP 服务器"));
    if (!mail.to) return reject(new Error("缺少收件人"));

    let socket = null;
    let finished = false;
    let buffer = "";
    let phase = "greeting";
    let useStartTls = cfg.secure === false && cfg.starttls !== false;
    let authSent = false;

    const done = (err, info) => {
      if (finished) return;
      finished = true;
      try {
        socket && socket.end();
      } catch (_) {}
      err ? reject(err) : resolve(info || { ok: true });
    };

    const attach = (sock) => {
      socket = sock;
      socket.setTimeout(timeoutMs, () => done(new Error("SMTP 连接超时")));
      socket.on("error", (e) => done(e));
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        let idx;
        while ((idx = buffer.indexOf(CRLF)) >= 0) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          onLine(line);
        }
      });
      socket.on("close", () => {
        if (!finished) done(new Error("SMTP 连接被关闭"));
      });
    };

    const write = (s) => socket.write(s + CRLF);

    const startTls = () => {
      const plain = socket;
      plain.removeAllListeners("data");
      plain.removeAllListeners("error");
      plain.removeAllListeners("timeout");
      plain.removeAllListeners("close");
      const secureSocket = tls.connect({ socket: plain, servername: host }, () => {
        attach(secureSocket);
        write(`EHLO ${cfg.helo || "localhost"}`);
        phase = "ehlo";
      });
      secureSocket.on("error", (e) => done(e));
    };

    const onLine = (line) => {
      const code = Number(line.slice(0, 3));
      const rest = line.slice(4);
      const more = line[3] === "-";

      switch (phase) {
        case "greeting":
          if (code !== 220) return done(new Error(`服务器拒绝连接：${line}`));
          write(`EHLO ${cfg.helo || "localhost"}`);
          phase = "ehlo";
          return;
        case "ehlo":
          if (more) return;
          if (code !== 250) return done(new Error(`EHLO 失败：${line}`));
          if (useStartTls) {
            write("STARTTLS");
            phase = "starttls";
            return;
          }
          if (cfg.user) {
            write("AUTH LOGIN");
            phase = "auth-user";
            return;
          }
          write(`MAIL FROM:<${cfg.fromEmail || cfg.user}>`);
          phase = "mail";
          return;
        case "starttls":
          if (code !== 220) return done(new Error(`STARTTLS 失败：${line}`));
          useStartTls = false;
          startTls();
          return;
        case "auth-user":
          if (code !== 334) return done(new Error(`AUTH 失败：${line}`));
          write(b64(cfg.user));
          phase = "auth-pass";
          return;
        case "auth-pass":
          if (code !== 334) return done(new Error(`AUTH 失败：${line}`));
          write(b64(cfg.pass));
          phase = "auth-done";
          return;
        case "auth-done":
          if (code !== 235) return done(new Error(`邮箱或授权码不正确：${line}`));
          authSent = true;
          write(`MAIL FROM:<${cfg.fromEmail || cfg.user}>`);
          phase = "mail";
          return;
        case "mail":
          if (code !== 250) return done(new Error(`MAIL FROM 被拒：${line}`));
          write(`RCPT TO:<${mail.to}>`);
          phase = "rcpt";
          return;
        case "rcpt":
          if (code !== 250 && code !== 251) return done(new Error(`收件人被拒：${line}`));
          write("DATA");
          phase = "data";
          return;
        case "data":
          if (code !== 354) return done(new Error(`DATA 被拒：${line}`));
          write(buildMessage(cfg, mail) + CRLF + ".");
          phase = "end";
          return;
        case "end":
          if (code !== 250) return done(new Error(`投递失败：${line}`));
          write("QUIT");
          phase = "quit";
          return;
        case "quit":
          return done(null, { ok: true, auth: authSent });
        default:
          return;
      }
    };

    if (cfg.secure === false) {
      attach(net.connect({ host, port }));
    } else {
      attach(tls.connect({ host, port, servername: host }));
    }
  });
}

module.exports = { sendMail };
