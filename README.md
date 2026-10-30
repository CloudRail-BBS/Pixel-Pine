# 像素松 · Pixel Pine

《我的世界》×《铁锈战争》限时创作活动「像素松」的参赛平台。覆盖 **报名组队 → 作品提交 → 兼容性审核 → 评委打分 → 结果公示 → 证书颁发** 的完整闭环。

> 本活动为非官方社区创作活动，与 Mojang Studios、Microsoft、Rusted Warfare 及其开发者无隶属、合作或授权关系。

## 功能

**通用**
- **明暗主题切换**：右上角一键切换，首次访问跟随系统偏好，手动选择后记在本地；证书纸面固定浅色，不受主题影响
- 全站响应式，手机端底部导航；卡片、表格、表单均为同一套主题变量
- **鸣谢页**（`#/sponsors`）：按支持金额分档展示赞助者与留言，金额默认不公开

**参赛者**
- 邮箱验证码 / 密码 / GitHub / CNKD 一证通行（可插拔，未配置则自动隐藏）
- 四种方式都可直接注册：验证码注册需昵称 + 密码，GitHub / CNKD 首次授权自动建号
- 「我的 → 登录方式」可查看已绑定方式，并绑定 / 解绑 CNKD 与 GitHub；解绑前会校验至少保留一种登录方式
- 忘记密码：邮箱验证码重置，重置成功后直接登录；验证码按用途隔离，不能串用
- 在线签署《诚信比赛公约》，签署记录绑定文本哈希
- 建队或凭邀请码加入，3–5 人一队；也可以个人参赛，独立提交作品
- 提交作品：赛道、版本与依赖、安装说明；**作品包直接上传**（≤200 MB），浏览器端自动算 SHA-256 并查询 VirusTotal
- 每次提交生成不可变版本快照；兼容性不通过时有 1 次限时修复窗口
- **提交前须通读活动规则并确认**，确认按规则版本记录；规则更新后需重新确认
- 评委团公开页：名单、赛道分工与《评委公约》全文；评委未签署公约不能打分
- 作品展厅：按赛道筛选、关键词搜索、作品详情页与站内下载
- 结果页只展示聚合均分与评委人数，评语和单条打分不下发访客

**评委**
- 只看到分配给自己的作品，五维打分（第 5 维按赛道切换口径）
- 草稿保存、提交锁定、进度可见；提交后只读，需主办方「退回」才能重打
- 主办方可查看每位评委的分项得分与评语

**主办方**
- 概览（待办、阶段判定、设奖门槛、服务状态）
- **审核工作台**：待检 / 需修复 / 已通过 / 未通过四类筛选，搜索、批量通过、快捷键（J/K 移动、Enter 审核、1/2/3 结论）；结论、常用理由模板与历史记录一并留档
- **评委分配矩阵**：作品 × 评委网格，点格分配，覆盖数提示，一键补齐到 3 位；按赛道整批派评；分差 ≥15 分自动预警
- 结果排名与公示
- 在线编辑规则页正文（Markdown，保存即生效）
- 证书颁发（按作品发给全队成员，可撤销）
- 组织单位管理（主办 / 协办 / 支持，Logo 或文字标，首页分组展示）
- 赞助者管理（称呼、金额、留言、头像；金额可隐藏，自动按档位排列）
- 爱发电开放平台同步：填 `user_id` 与 API Token 后，在「赞助者」页一键拉取赞助记录；
  Token 只留在服务端，也可用 `AFDIAN_USER_ID` / `AFDIAN_TOKEN` 环境变量提供
- 评委团队管理（头像、职称、负责赛道、公开开关）
- GitHub / CNKD 登录配置（OAuth 应用、回调地址，密钥只存服务端）
- **对象存储**：作品包可写入 S3 兼容存储（MinIO / R2 / AWS S3 / 阿里云 OSS），后台可视化配置、测试连接、迁移本地文件；未启用时继续落本地磁盘
- **SEO 后台**：收录诊断（爬虫抓取、sitemap、验证码）、站长平台验证码、IndexNow 与百度主动推送，全部在「SEO」页完成，无需重启
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

**默认就是本地模式**：账号、数据、文件都写到 `./data`，不连任何外部服务。注册需要邮箱验证码；全新部署的**第一个账号免验证码**，直接成为主办方——不然「配 SMTP 需要管理员、注册需要 SMTP」会死锁。

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
| `PS_PUBLIC_ORIGIN` | 否 | 对外访问地址，如 `https://www.pixelpine.org`；反代没传 `X-Forwarded-Host` 时必填，sitemap 与 OAuth 回调都靠它 |
| `PS_SEO_GOOGLE` | 否 | Google 验证码；也可在后台「SEO」页填，环境变量优先 |
| `PS_SEO_BAIDU` | 否 | 百度验证码；也可在后台「SEO」页填，环境变量优先 |
| `PS_SEO_BING` | 否 | Bing 验证码；也可在后台「SEO」页填，环境变量优先 |

**邮件、人机验证、病毒扫描、CNKD 登录都不在这里配**：登录主办方后台 →「设置」，填完保存立即生效，密钥只存服务端。未配置时对应功能自动降级：极验跳过验证、CNKD 按钮不显示、病毒扫描显示未启用，登录与提交仍可用。`/api/health` 会如实报告状态。

## 两种运行模式

| 模式 | 账号与数据 | 依赖 | 适用 |
|---|---|---|---|
| **local**（默认） | 全部在本机：`data/db.json` + `data/files` | 无 | 自己服务器部署 |
| **cloud** | 托管云服务（WorkBuddy Cloud） | 外部网络 | 官方线上站 |

`PS_MODE=local` 时，邮箱、密码、队伍、作品、评分、证书全部写在容器的一个数据卷里，**默认不依赖任何外部服务**。空库时第一个注册的账号免验证码、自动成为主办方；之后注册都需要邮箱验证码。

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

`PS_MODE=cloud`，并按需配 `PS_UPSTREAM`（同源代理）或 `PS_ENDPOINT`（直连）。这两个变量只在 cloud 模式下有意义，本地模式完全忽略；自建一般不需要。

---

## 本地模式的数据结构

`data/db.json` 是一个 JSON 文件，按表存放：`profiles / users / teams / team_members / submissions / submission_versions / reviews / announcements / activity / appeals / signatures / documents / partners / judges / certificates`。写入采用「先写临时文件再 rename」，避免断电留下半截文件。

`data/files/` 存作品包，路径规则与云端一致：`users/<uid>/...` 只有本人可读，`shared/<uid>/...` 登录后可读。下载地址带 HMAC 签名与过期时间。

服务端逐表校验权限（等价于云端的 RLS）：参赛者只看得到自己的草稿，评委只看得到分配给自己的作品，主办方可以看全部。

### 后台可改的配置

登录后进 **`#/admin/settings`**，三块配置都在这里，**保存立即生效，不用重启容器**：

| 配置 | 作用 | 不配时 |
|---|---|---|
| 邮件服务（SMTP） | 开启后登录页出现「验证码登录」，注册与登录都走邮件 | 只保留邮箱 + 密码 |
| 人机验证（极验） | 登录、发信前做行为验证 | 跳过，仅靠频率限制 |
| 病毒扫描（VirusTotal） | 按 SHA-256 查询作品包报告 | 提交页显示「扫描未启用」 |

密钥只存在服务端，读取接口只返回「已保存」标记，不会回显；留空表示不修改，勾选「清除」才会删除。

SMTP 常见服务商参数：

| 邮箱 | 服务器 | 端口 | 加密 |
|---|---|---|---|
| QQ 邮箱 | `smtp.qq.com` | 465 | SSL |
| 163 邮箱 | `smtp.163.com` | 465 | SSL |
| 企业微信邮箱 | `smtp.exmail.qq.com` | 465 | SSL |
| Gmail | `smtp.gmail.com` | 587 | STARTTLS |

密码栏填的是**授权码**，不是邮箱登录密码。保存后点「发送测试邮件」验证，收不到就看提示里的 SMTP 错误。

### 本地模式的限制

- **第三方登录不可用**：CNKD、微信入口只在云端模式显示。
- **验证码依赖 SMTP**：没配邮件服务时，登录页只保留邮箱 + 密码。
- **单进程**：不要用 `--scale` 起多个副本共享同一个数据卷，JSON 写入没有跨进程锁。
- **备份靠卷**：容器删了数据还在卷里，但卷也删了就没了。

### 作品包存储

云存储只有两档权限：`users/<uid>/` 仅本人可读写，`shared/<uid>/` 所有登录用户可读，没有“仅评委可读”，也不提供公开链接（只能签发最长 1 小时的临时地址）。因此：

1. 作品包上传到 `users/<队长>/submissions/...`，**截止前只有本队队长可下载**；
2. 提交截止后，队长在页面上点一次「发布到评审」，文件复制到 `shared/`，评委才能下载；
3. 复制完成后其他登录用户也可下载——这正好对应规则中的「私密提交、截止后公开」。

## 对象存储（可选）

默认作品包落在本机 `data/files`，开箱即用。文件多、要接 CDN 或不想让数据卷膨胀时，可在「后台 → 设置 → 对象存储」切换，**不需要改环境变量或重启**。

| 字段 | 说明 |
|---|---|
| Endpoint | S3 服务地址，不带结尾斜杠 |
| Region | AWS 区域；R2 填 `auto`；OSS 填 `oss-cn-hangzhou` 这类 |
| Bucket / 前缀 | 实际 key 为 `前缀/站内路径`，默认 `pixelsong` |
| Access Key / Secret Key | 建议用只授权该 bucket 的子账号 |
| 公开访问前缀 | 可选，仅用于未来的 CDN；不改变权限 |
| Path-style | MinIO 一般要勾选；R2 / AWS / OSS 不勾 |

常用组合：

```text
MinIO     http://127.0.0.1:9000         region=us-east-1      pathStyle=✓
R2        https://<account>.r2.cloudflarestorage.com   region=auto   pathStyle=✗
AWS S3    https://s3.us-east-1.amazonaws.com           region=us-east-1  pathStyle=✗
阿里云 OSS https://oss-cn-hangzhou.aliyuncs.com         region=oss-cn-hangzhou  pathStyle=✗
```

配置顺序：填表 → **测试连接**（写入并回读一个临时对象）→ **保存设置** → 需要时点 **迁移本地文件**（已存在的会跳过）。

- 作品包下载默认走站内代理并校验权限；需要直链时由 S3 生成预签名地址，默认 10 分钟
- 对象存储不可用时上传会明确报错，不会静默丢文件；关闭开关后回退本地磁盘
- 切换存储后旧文件仍可下载：读取时先查对象存储，404 再回退本地
- 单文件上限仍是 200 MB，超过请在提交说明里给外链

## 搜索引擎与 SEO

站点已经按可收录的方式处理，不需要额外的 SSR 服务：

- **干净 URL**：`/rules`、`/works/12`、`/results`，不再依赖 `#/`；旧的 `#/rules` 链接会在启动时自动换成 `/rules`
- **后台「SEO」页**：收录诊断（真实 Googlebot / Baiduspider UA 抓取、sitemap 条数、验证码状态）、三家站长平台验证码、IndexNow Key、百度推送 Token，保存即生效
- **主动推送**：一键把 sitemap 里的全部 URL 推给 IndexNow（Bing / Yandex / Naver）与百度；IndexNow Key 会自动暴露为 `/<key>.txt`
- **`/robots.txt`**：放行公开页，屏蔽 `/admin`、`/me`、`/team`、`/judge`、`/login`、`/certificate` 等私有路径，并带 `Host` 与 `Sitemap`
- **`/sitemap.xml`**：动态生成，包含首页、规则、作品列表、每件已公示作品、结果、评委、公告、鸣谢，带 `lastmod`
- **爬虫快照**：Googlebot / Baiduspider / Bingbot 等访问公开路径时，服务端直接返回带正文的静态 HTML（标题、关键信息、赛道、赛程、规则全文、作品列表与详情、排名），不依赖 JS 渲染
- **页面 head**：每个路径有独立的 title / description / canonical / Open Graph / Twitter Card，私有页带 `noindex` 与 `X-Robots-Tag`
- **结构化数据**：首页 Event + Organization + WebSite + FAQPage、作品详情 CreativeWork、列表页 CollectionPage / ItemList
- **分享封面**：`assets/og-cover.png`（1200×630）

上线后：

1. 进「后台 → SEO」，先看**收录诊断**：站点地址、Sitemap、两种爬虫抓取、验证码四项应全绿
2. 在 Google Search Console / 百度搜索资源平台 / Bing 站长工具添加站点，把验证码粘回后台并保存
3. 提交 `https://你的域名/sitemap.xml`，再点「推送全部页面」
4. 用 `curl -A "Googlebot" https://你的域名/rules | head` 复核快照

**首页一直不收录时**，按这个顺序排查：域名是否 HTTPS 可访问 → 诊断里爬虫是否 200 且有 h1 → canonical 是否等于实际域名 → 站长平台是否验证通过 → 是否已提交 sitemap。新域名没有外链时，Google 通常要 1–4 周；百度对未备案或境外主机更慢，这不是前端能绕过的。

`robots` 只是约定，不是访问控制；`/admin` 仍然要靠账号鉴权。

## 校验

```bash
npm run preflight     # 部署前自检：文件、配置、页面可解析
npm run smoke         # 部署后线上检查（20+ 项，可传 URL 参数）
```

`smoke` 会比对本地 `package.json` 与线上 `/api/health` 的版本号——不一致说明发布没生效。

## 许可

未声明许可证。活动规则与《诚信比赛公约》文本版权归主办方所有。
