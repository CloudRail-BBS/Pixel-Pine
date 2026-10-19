# 像素松 · Pixel Pine

《我的世界》×《铁锈战争》限时创作活动「像素松」的参赛平台。覆盖 **报名组队 → 作品提交 → 兼容性审核 → 评委打分 → 结果公示 → 证书颁发** 的完整闭环。

> 本活动为非官方社区创作活动，与 Mojang Studios、Microsoft、Rusted Warfare 及其开发者无隶属、合作或授权关系。

## 功能

**参赛者**
- 邮箱验证码 / 密码 / 微信 / CNKD 一证通行（可插拔，未配置则自动隐藏）
- 在线签署《诚信比赛公约》，签署记录绑定文本哈希
- 建队或凭邀请码加入，3–5 人一队
- 提交作品：赛道、版本与依赖、安装说明；**作品包直接上传**（≤200 MB），浏览器端自动算 SHA-256 并查询 VirusTotal
- 每次提交生成不可变版本快照；兼容性不通过时有 1 次限时修复窗口
- **提交前须通读活动规则并确认**，确认按规则版本记录；规则更新后需重新确认
- 评委团公开页：名单、赛道分工与《评委公约》全文；评委未签署公约不能打分
- 作品展厅：按赛道筛选、关键词搜索、作品详情页与站内下载

**评委**
- 只看到分配给自己的作品，五维打分（第 5 维按赛道切换口径）
- 草稿保存、提交锁定、进度可见

**主办方**
- 概览（待办、阶段判定、设奖门槛、服务状态）
- 报名审核、作品兼容性标记、按赛道派评、结果排名与公示
- 在线编辑规则页正文（Markdown，保存即生效）
- 证书颁发（按作品发给全队成员，可撤销）
- 组织单位管理（主办 / 协办 / 支持，Logo 或文字标，首页分组展示）
- 评委团队管理（头像、职称、负责赛道、公开开关）
- 活动介绍在线编辑，同步用于首页导语与后台概览

## 技术结构

无构建步骤，原生 ES Modules + 一个零依赖 Node 服务。云 SDK 已本地化（v0.1.4-dev，MIT），不依赖 CDN：浏览器的跟踪防护会阻止第三方脚本访问 localStorage，导致登录态无法保存。

```
index.html            入口（哈希路由）
assets/logo.svg       站点标识
assets/vendor/        云 SDK（MIT，本地化，避免 CDN 被跟踪防护拦 storage）
css/app.css           全部样式
js/config.js          公开配置、赛道、评分维度、公约文本
js/core.js            云客户端、会话、路由、Markdown 渲染
js/api.js             数据访问
js/views-*.js         页面（按需动态加载）
server.js             静态服务 + 数据面同源代理 + 极验/CNKD 服务端校验
scripts/preflight.js  部署前自检
scripts/smoke.js      线上冒烟测试
```

服务端做四件事：托管静态文件、数据面同源代理、极验二次校验、CNKD OAuth 换码。**所有密钥只存在于环境变量**。

## 本地运行

需要 Node.js ≥ 18（服务端用到全局 `fetch`）。

```bash
node server.js          # 默认 3000 端口
# 或
npm start
```

访问 http://localhost:3000 。

**不需要任何配置。** 服务会自动判断：在官方域名上直连数据面，在 localhost、IP 或自有域名上自动启用同源代理（见下节）。

## Docker 部署

```bash
docker compose up -d --build
```

起来就能用，**不需要先配任何环境变量**：容器默认启用数据面同源代理，IP 或域名访问都能登录。

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
| `VT_API_KEY` | 否 | VirusTotal API key，用于按 SHA-256 查询病毒扫描结果 |

未配置时对应功能自动降级：极验跳过验证、CNKD 按钮置灰，登录仍可用。`/api/health` 会如实报告状态。

## 关于后端

本仓库**不包含数据库与账号系统**。页面通过 `/.cloud/**` 访问托管云服务（PostgreSQL + Auth + 存储），由行级安全策略（RLS）隔离数据。

### 为什么开箱就能跑

服务端内置**数据面同源代理**：浏览器把请求发到当前域名下的 `/.cloud/**`，Node 收到后原样转发给已发布的数据面。

```
浏览器 → http://你的服务器:3000/.cloud/**  →  Node 转发  →  https://pixelsong.app.workbuddy.host/.cloud/**
```

浏览器看到的是同源请求，不做预检，也不要求对方返回 CORS 头，所以用 IP、端口或任意域名访问都能登录和读写。

判断顺序：

| 环境变量 | 行为 |
|---|---|
| `PS_UPSTREAM=https://…` | 全部走代理到该地址 |
| `PS_ENDPOINT=https://…` | 直连该地址，不代理（要求对方允许你的来源） |
| 都不配 | 官方域名直连；其他域名自动代理到官方数据面 |

当前走向可以直接查：`curl http://localhost:3000/api/health`，看 `dataPlane` 字段。

### 容器连不上数据面怎么办

浏览器能打开主站、容器却报 `502 upstream_unreachable`，说明**服务器出网**有问题（DNS 污染、TLS 拦截、防火墙），不是应用代码。

打开一个地址就能定位：

```
http://你的服务器:3000/api/diag
```

它返回 DNS 解析结果、连接耗时、HTTP 状态与具体错误码：

| 返回 | 含义 | 处理 |
|---|---|---|
| `"ok": true` | 容器能连上数据面 | 502 是偶发，重试 |
| `"code": "ENOTFOUND"` | DNS 解析失败 | 换 DNS，或用 `PS_UPSTREAM` 填可达 IP + `PS_UPSTREAM_HOST` 填域名 |
| `"code": "CERT_..."` / `UNABLE_TO_VERIFY_LEAF_SIGNATURE` | TLS 被中间设备替换 | 配 `NODE_EXTRA_CA_CERTS` 指向企业根证书；内网可临时 `PS_TLS_INSECURE=1` |
| `"code": "ETIMEDOUT"` / `ECONNREFUSED` | 出网被拦 | 放行该域名 443，或让服务器走代理 |
| `dns` 里是 `198.18.x.x` | 被代理软件 fake-ip 接管 | 容器内没有该代理，改用真实 DNS |

### 默认与主站共用数据

不配 `PS_UPSTREAM` 时，自托管站点连的是**已发布的那套数据库**：你在自建站点注册的账号在主站也能登录，作品、队伍、评分都是同一份。

想让数据完全独立，需要自己建一套云服务应用：

1. 新建应用（数据库 + 存储 + 登录），拿到新的 endpoint 与 publishableKey
2. 在它的 SQL 控制台依次执行 `scripts/schema.sql` 与 `scripts/seed.sql`
3. 配 `PS_UPSTREAM` 指向新应用，`PS_PUBLISHABLE_KEY` 换成新 key

```bash
scripts/schema.sql    # 14 张表 + RLS + 权限函数
scripts/seed.sql      # 活动配置 + 规则正文 + 活动介绍 + 主办单位
```

第一次登录后还需要提一次管理员（角色有列级保护，客户端改不了）：

```sql
UPDATE profiles SET role = 'admin' WHERE owner_id = '<你的 UID>';
```

UID 在「我的」页面能看到。

### 以前为什么会报 `TypeError: Failed to fetch`

数据面的跨源预检返回 **403，且不带任何 `Access-Control-Allow-Origin` 头**。浏览器因此判定预检失败，任何带自定义头（如 `x-wb-webapp-access-key`）的请求都发不出去，前端只能拿到 `Failed to fetch`。

同源代理绕开了这条路径，不需要对方改 CORS，也不需要在浏览器里做任何设置。

### 作品包存储

云存储只有两档权限：`users/<uid>/` 仅本人可读写，`shared/<uid>/` 所有登录用户可读，没有“仅评委可读”，也不提供公开链接（只能签发最长 1 小时的临时地址）。因此：

1. 作品包上传到 `users/<队长>/submissions/...`，**截止前只有本队队长可下载**；
2. 提交截止后，队长在页面上点一次「发布到评审」，文件复制到 `shared/`，评委才能下载；
3. 复制完成后其他登录用户也可下载——这正好对应规则中的「私密提交、截止后公开」。

## 校验

```bash
npm run preflight     # 部署前 8 项检查
npm run smoke         # 部署后 11 项线上检查（可传 URL 参数）
```

`smoke` 会比对本地 `package.json` 与线上 `/api/health` 的版本号——不一致说明发布没生效。

## 许可

未声明许可证。活动规则与《诚信比赛公约》文本版权归主办方所有。
