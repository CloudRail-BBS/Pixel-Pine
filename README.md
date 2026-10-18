# 像素松 · Pixel Pine

《我的世界》×《铁锈战争》限时创作活动「像素松」的参赛平台。覆盖 **报名组队 → 作品提交 → 兼容性审核 → 评委打分 → 结果公示 → 证书颁发** 的完整闭环。

> 本活动为非官方社区创作活动，与 Mojang Studios、Microsoft、Rusted Warfare 及其开发者无隶属、合作或授权关系。

## 功能

**参赛者**
- 邮箱验证码 / 密码 / 微信 / CNKD 一证通行（可插拔，未配置则自动隐藏）
- 在线签署《诚信比赛公约》，签署记录绑定文本哈希
- 建队或凭邀请码加入，3–5 人一队
- 提交作品：赛道、版本与依赖、安装说明、网盘链接 + SHA-256
- 每次提交生成不可变版本快照；兼容性不通过时有 1 次限时修复窗口

**评委**
- 只看到分配给自己的作品，五维打分（第 5 维按赛道切换口径）
- 草稿保存、提交锁定、进度可见

**主办方**
- 概览（待办、阶段判定、设奖门槛、服务状态）
- 报名审核、作品兼容性标记、按赛道派评、结果排名与公示
- 在线编辑规则页正文（Markdown，保存即生效）
- 证书颁发（按作品发给全队成员，可撤销）

## 技术结构

无构建步骤，原生 ES Modules + 一个零依赖 Node 服务。

```
index.html            入口（哈希路由）
css/app.css           全部样式
js/config.js          公开配置、赛道、评分维度、公约文本
js/core.js            云客户端、会话、路由、Markdown 渲染
js/api.js             数据访问
js/views-*.js         页面（按需动态加载）
server.js             静态服务 + 极验/CNKD 服务端校验
scripts/preflight.js  部署前自检
scripts/smoke.js      线上冒烟测试
```

服务端只做三件事：托管静态文件、极验二次校验、CNKD OAuth 换码。**所有密钥只存在于环境变量**。

## 本地运行

需要 Node.js ≥ 18（服务端用到全局 `fetch`）。

```bash
node server.js          # 默认 3000 端口
# 或
npm start
```

访问 http://localhost:3000 。

## Docker 部署

```bash
docker compose up -d --build
```

镜像基于 `node:22-alpine`，非 root 用户运行，内置健康检查。默认映射 `3000` 端口，可用 `HOST_PORT` 覆盖。

只构建镜像不启动：

```bash
docker build -t pixelsong .
docker run -d --name pixelsong -p 3000:3000 --env-file .env pixelsong
```

查看状态：

```bash
docker compose ps
docker compose logs -f
curl http://localhost:3000/api/health
```

### 反向代理

生产环境需要 HTTPS。Nginx 示例：

```nginx
server {
  listen 443 ssl;
  server_name your-domain.com;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

`X-Forwarded-Proto` 必须传，否则 CNKD 回调地址会算成 `http://`。

## 环境变量

复制 `.env.example` 为 `.env`，按需填写。**`.env` 已被 `.gitignore` 与 `.dockerignore` 排除，不会进仓库或镜像。**

| 变量 | 必填 | 说明 |
|---|---|---|
| `PORT` | 否 | 监听端口，默认 3000 |
| `GEETEST_CAPTCHA_ID` | 否 | 极验 Captcha ID |
| `GEETEST_CAPTCHA_KEY` | 否 | 极验 Captcha Key（仅服务端） |
| `CNKD_CLIENT_ID` | 否 | CNKD 一证通行客户端 ID |
| `CNKD_CLIENT_SECRET` | 否 | 仅 `confidential` 应用需要 |
| `CNKD_REDIRECT_URI` | 否 | 必须与 CNKD 登记值逐字一致 |

未配置时对应功能自动降级：极验跳过验证、CNKD 按钮置灰，登录仍可用。`/api/health` 会如实报告状态。

## 关于后端

本仓库**不包含数据库与账号系统**。页面通过 `js/config.js` 中的 `endpoint` 与 `publishableKey` 直连托管云服务（PostgreSQL + Auth），由行级安全策略（RLS）隔离数据。

- `publishableKey` 是**设计上可公开**的标识，本身不含权限，服务端会校验请求来源域名。
- 因此独立部署一套需要：自己的云服务环境、在 `js/config.js` 替换 `endpoint`/`publishableKey`、并重新分配域名。
- 直接克隆本仓库运行，因 Origin 不匹配，登录与数据读写会被拒绝——这是预期行为，不是 bug。

## 校验

```bash
npm run preflight     # 部署前 8 项检查
npm run smoke         # 部署后 11 项线上检查（可传 URL 参数）
```

`smoke` 会比对本地 `package.json` 与线上 `/api/health` 的版本号——不一致说明发布没生效。

## 许可

未声明许可证。活动规则与《诚信比赛公约》文本版权归主办方所有。
