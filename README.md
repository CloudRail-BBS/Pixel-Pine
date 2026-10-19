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

**默认就是本地模式**：账号、数据、文件都写到 `./data`，不连任何外部服务。首次用邮箱 + 密码登录即注册，第一个账号是主办方。

想用云端模式：`PS_MODE=cloud`（官方站用）。

## Docker 部署

```bash
docker compose up -d --build
```

起来就能用，**不需要先配任何环境变量**：默认 local 模式，数据落在命名卷 `pixelsong-data`（挂到 `/app/data`）。

镜像基于 `node:22-alpine`，非 root 用户运行，内置健康检查。默认映射 `3000` 端口，可用 `HOST_PORT` 覆盖。

只构建镜像不启动：

```bash
docker build -t pixelsong .
docker run -d --name pixelsong -p 3000:3000 \
  -v pixelsong-data:/app/data pixelsong
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

`X-Forwarded-Proto` 用于把登录 Cookie 标记为 Secure；HTTPS 下请照写。

## 环境变量

复制 `.env.example` 为 `.env`，按需填写。**`.env` 已被 `.gitignore` 与 `.dockerignore` 排除，不会进仓库或镜像。**

| 变量 | 必填 | 说明 |
|---|---|---|
| `PS_MODE` | 否 | `local`（默认，本机自足）或 `cloud` |
| `PS_DATA_DIR` | 否 | 本地模式数据目录，默认 `/app/data` |
| `PORT` | 否 | 监听端口，默认 3000 |
| `GEETEST_CAPTCHA_ID` | 否 | 极验 Captcha ID |
| `GEETEST_CAPTCHA_KEY` | 否 | 极验 Captcha Key（仅服务端） |
| `CNKD_CLIENT_ID` | 否 | CNKD 一证通行客户端 ID |
| `CNKD_CLIENT_SECRET` | 否 | 仅 `confidential` 应用需要 |
| `CNKD_REDIRECT_URI` | 否 | 必须与 CNKD 登记值逐字一致 |
| `VT_API_KEY` | 否 | VirusTotal API key，用于按 SHA-256 查询病毒扫描结果 |

未配置时对应功能自动降级：极验跳过验证、CNKD 按钮置灰，登录仍可用。`/api/health` 会如实报告状态。

## 两种运行模式

| 模式 | 账号与数据 | 依赖 | 适用 |
|---|---|---|---|
| **local**（默认） | 全部在本机：`data/db.json` + `data/files` | 无 | 自己服务器部署 |
| **cloud** | 托管云服务（WorkBuddy Cloud） | 外部网络 | 官方线上站 |

`PS_MODE=local` 时，邮箱、密码、队伍、作品、评分、证书全部写在容器的一个数据卷里，**不发起任何外部请求**。没有邮件服务，首次用邮箱 + 密码登录即注册，第一个账号自动成为主办方。

### 自己部署（默认 local）

```bash
git clone https://github.com/CloudRail-BBS/Pixel-Pine.git
cd Pixel-Pine
docker compose up -d --build
```

打开 `http://服务器IP:3000`，用任意邮箱 + 密码登录即可开始。数据在命名卷 `pixelsong-data` 里：

```bash
docker volume inspect pixelpine_pixelsong-data     # 看挂载点
docker run --rm -v pixelpine_pixelsong-data:/d -v $PWD:/b alpine tar czf /b/backup.tgz -C /d .
```

备份就是拷这个卷；换机器时还原回去，账号与作品都在。

### 想用云端模式

`PS_MODE=cloud`，并按需配 `PS_UPSTREAM`（同源代理）或 `PS_ENDPOINT`（直连）。这一模式只用于官方站，自建一般不需要。

---

## 本地模式的数据结构

`data/db.json` 是一个 JSON 文件，按表存放：`profiles / users / teams / team_members / submissions / submission_versions / reviews / announcements / activity / appeals / signatures / documents / partners / judges / certificates`。写入采用「先写临时文件再 rename」，避免断电留下半截文件。

`data/files/` 存作品包，路径规则与云端一致：`users/<uid>/...` 只有本人可读，`shared/<uid>/...` 登录后可读。下载地址带 HMAC 签名与过期时间。

服务端逐表校验权限（等价于云端的 RLS）：参赛者只看得到自己的草稿，评委只看得到分配给自己的作品，主办方可以看全部。

### 本地模式的限制

- **没有邮箱验证码**：登录页只保留邮箱 + 密码。
- **没有第三方登录**：CNKD、微信入口在本地模式不显示。
- **单进程**：不要用 `--scale` 起多个副本共享同一个数据卷，JSON 写入没有跨进程锁。
- **备份靠卷**：容器删了数据还在卷里，但卷也删了就没了。

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
