/**
 * 运行配置
 *
 * 由服务端在 index.html 里注入 window.__PS_CONFIG__：
 *  - 代理模式（容器部署，PS_UPSTREAM 已配置）：不传 endpoint，SDK 自动使用
 *    当前页面的 location.origin，配合服务端 /.cloud/** 反代实现同源访问
 *  - 直连模式（平台部署）：endpoint 指向发布的云服务域名
 *
 * 静态托管（没有 Node 服务端）时没有注入，退回线上域名，行为与之前一致。
 */
const BOOT = (typeof window !== "undefined" && window.__PS_CONFIG__) || null;

const RUNTIME = {
  oauthRelayBaseUrl:
    (BOOT && BOOT.oauthRelayBaseUrl) || "https://www.workbuddy.cn/v2/as/genie-baas/oauth",
  publishableKey:
    (BOOT && BOOT.publishableKey) ||
    "wbpk_ASDGMaTrV7dAuvQijziP8z_1cmrp1ZytZS54tR74qrBdBG6NGJrS6c0",
};
if (BOOT && BOOT.endpoint) RUNTIME.endpoint = BOOT.endpoint;
// 没有注入时交给 SDK 回落到 location.origin，不再指向任何外部域名

export const PUBLIC_CONFIG = RUNTIME;

export const TRACKS = [
  { code: "A", game: "我的世界", type: "模组", name: "MC 模组", side: "mc" },
  { code: "B", game: "我的世界", type: "地图", name: "MC 地图", side: "mc" },
  { code: "C", game: "铁锈战争", type: "模组", name: "RW 模组", side: "rw" },
  { code: "D", game: "铁锈战争", type: "地图", name: "RW 地图", side: "rw" },
];

export const trackOf = (code) => TRACKS.find((t) => t.code === code) || { code, name: code || "未选", game: "", type: "" };

export const DIMENSIONS = [
  { key: "runnable", name: "可运行性与完成度", weight: 30, hint: "能否加载、有无致命 bug、演示视频是否走完全流程" },
  { key: "creative", name: "创意与主题契合度", weight: 25, hint: "是否真正回应题目，而非套壳的通用作品" },
  { key: "design", name: "玩法 / 地图设计质量", weight: 20, hint: "趣味性、节奏、重复可玩性、目标明确度" },
  { key: "tech", name: "技术实现与稳定性", weight: 15, hint: "代码与脚本质量、性能、联机与版本兼容" },
  { key: "present", name: "表现力与平衡性", weight: 10, hint: "按赛道口径评分，见下方说明" },
];

export const PRESENT_RUBRIC = {
  A: "美术与音效表现、界面可用性、数值是否自洽、与原体系的融合度",
  B: "叙事与氛围、场景美术、引导设计、难度曲线",
  C: "单位与阵营平衡、克制关系、经济曲线、对局节奏",
  D: "视觉可读性、地形与资源分布公平性、对称性与节奏控制",
};

export const STATUS_TEXT = {
  draft: { label: "草稿", cls: "tag" },
  submitted: { label: "已提交 · 待检", cls: "tag tag-blue" },
  fix_required: { label: "需修复", cls: "tag tag-amber" },
  passed: { label: "通过 · 待评审", cls: "tag tag-teal" },
  rejected: { label: "未通过", cls: "tag tag-red" },
  public: { label: "已公示", cls: "tag tag-teal" },
  disqualified: { label: "取消资格", cls: "tag tag-red" },
};

export const TEAM_STATUS = {
  pending: { label: "待审核", cls: "tag tag-amber" },
  approved: { label: "已通过", cls: "tag tag-teal" },
  rejected: { label: "已驳回", cls: "tag tag-red" },
};

export const DEFAULT_ACTIVITY = {
  theme: "像素重生",
  signupDeadline: "2026-11-01T23:59:00+08:00",
  eventStart: "2026-11-06T10:00:00+08:00",
  submitDeadline: "2026-11-09T10:00:00+08:00",
  judgeDeadline: "2026-11-12T23:59:00+08:00",
  roadshowAt: "2026-11-14T14:00:00+08:00",
  venue: "全程线上",
  contact: "主办方群 000000",
};

export const INTEGRITY_DOC = {
  key: "integrity",
  version: "v1.0",
  title: "诚信比赛公约",
  preamble:
    "本公约适用于「像素松」全部参赛队伍与成员。签署即表示你以个人名义对下列事项作出承诺，并同意主办方按活动规则处理违约行为。",
  items: [
    "我提交的作品核心内容，全部在本次活动开发计时内原创完成，不以往届作品或他人作品改名充数。",
    "我不以任何形式委托他人代做、购买成品或雇佣开发，也不代替他人参赛。",
    "我不抄袭他人代码、地图、建筑、美术或文案；引用开源项目与公共素材时，如实注明来源与许可证。",
    "我不打包盗版游戏文件、未授权的付费资源或官方资产。",
    "我不在作品中植入恶意代码、外挂逻辑，或任何破坏他人存档、设备与联机公平性的内容。",
    "我接受主办方对原创性的核查，并能在被要求时提供仓库提交历史、文件时间戳或中期快照等证据；拒绝提供视为放弃申辩。",
    "我如实填写依赖、版本、安装说明与已知问题，不隐瞒会导致评委无法运行的事实。",
    "收到修复要求时，我只修复可加载性问题，不在修复包中夹带功能或内容变更。",
    "我尊重评委、导师、工作人员与其他参赛者，不进行骚扰、歧视、人身攻击或干扰活动秩序的行为。",
    "我理解并接受：违反上述任一条款，主办方可视情节给予警告、扣分、取消评奖资格或取消参赛资格。",
  ],
  footer:
    "本公约与《像素松活动规则》共同构成参赛约束。公约文本如修订，将提升版本号并要求重新签署。",
};

export function integrityPlainText(doc = INTEGRITY_DOC) {
  return [
    doc.title,
    doc.version,
    doc.preamble,
    ...doc.items.map((t, i) => `${i + 1}. ${t}`),
    doc.footer,
  ].join("\n");
}

export const AWARDS = [
  { key: "first", name: "一等奖", rank: 1 },
  { key: "second", name: "二等奖", rank: 2 },
  { key: "third", name: "三等奖", rank: 3 },
  { key: "special", name: "单项奖", rank: 4 },
  { key: "participant", name: "参赛证书", rank: 9 },
];

export const awardOf = (key) => AWARDS.find((a) => a.key === key) || { key, name: key, rank: 9 };

export const PARTNER_ROLES = [
  { key: "host", name: "主办单位", note: "活动发起与规则解释" },
  { key: "co", name: "协办单位", note: "联合组织与资源支持" },
  { key: "support", name: "支持单位", note: "场地、奖品或宣传支持" },
];

export const partnerRoleOf = (key) =>
  PARTNER_ROLES.find((r) => r.key === key) || { key, name: key || "其他", note: "" };

export const JUDGE_DOC = {
  key: "judge",
  version: "v1.0",
  title: "评委公约",
  preamble:
    "本公约适用于「像素松」全部评委。签署即表示你以个人名义对下列事项作出承诺，并同意主办方按评审规则处理违约行为。",
  items: [
    "我只依据作品本身与提交材料评分，不受队伍身份、学校、地区、人情关系影响。",
    "我与参评作品存在师承、合作关系或其他利益关联时，主动向主办方申请回避。",
    "我不向任何人透露评审过程中的打分、评语与讨论内容。",
    "我不在结果公示前以任何形式暗示或承诺奖项归属。",
    "我按赛道口径评分，理解同一维度在四条赛道上含义不同，不套用统一直觉。",
    "我独立打分，不与他人协商分数，也不因他人评分修改自己的判断。",
    "我的评语对作品不对人，指出问题的同时给出可执行的理由。",
    "我不参与本届比赛，不为任何队伍提供针对性指导、代做或修改作品。",
    "我如实报告无法在截止前完成评审的情况，不草率提交走过场。",
    "我理解违反上述任一条款，主办方可取消我的评委资格并重新核定相关奖项。",
  ],
  footer:
    "本公约与《像素松活动规则》共同构成评审约束。公约文本如修订，将提升版本号并要求重新签署。",
};

export function judgePlainText(doc = JUDGE_DOC) {
  return [
    doc.title,
    doc.version,
    doc.preamble,
    ...doc.items.map((t, i) => `${i + 1}. ${t}`),
    doc.footer,
  ].join("\n");
}
