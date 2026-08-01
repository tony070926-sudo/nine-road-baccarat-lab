# 九点牌靴 · Baccarat Lab

一款纯模拟、无真钱的八副牌百家乐概率与路单实验室。它不是按固定权重抽取“庄 / 闲 / 和”，而是建立真实的 416 张牌靴，经 Web Crypto 驱动的无模偏差 Fisher–Yates 洗牌后无放回发牌，再严格执行标准 Punto Banco 补牌矩阵。

> 本项目仅供概率教育与软件演示，不涉及真钱、存款、提现或可兑换奖励。本项目与 Las Vegas Sands、Sands China、Marina Bay Sands、The Venetian 及其关联方无关，未获其赞助或背书。历史路单不具备预测能力。

## 功能

- 原创荷官与赌桌场景：第一视角选筹码、将筹码放入桌面下注区、等待发牌并亲自开牌
- 八副牌（416 张）真实牌靴、烧牌、切牌与自动换靴
- 闲、庄、和、闲对、庄对模拟下注与标准佣金结算
- 下注在“停止下注”前先生成并耐久保存完整结果；玩家只咪庄/闲主注对应一侧，和/对子单注由荷官开牌
- 零下注“飞牌”自动开出完整牌局，并同步保留到路单与完整记录
- 已锁定牌局与逐张翻牌进度在本机恢复；每张牌先执行比较-写入-读回，再推进画面，刷新不会重抽牌局
- 恢复与结算持有 Web Locks 独占牌桌锁；第二标签页保持只读，主页面结束后自动同步
- 牌靴、待开牌局、余额与历史合并为一个带 revision 的 v2 权威快照；任一写入失败都不会让画面或资金状态先行
- 荷官从牌靴按 P1–B1–P2–B2 逐张抽牌、短程推送并松指，纸牌随后滑行减速落位；补牌也必须先落桌再开牌
- 发牌顺序与开牌顺序分离：采用闲家首两张 → 庄家首两张 → 闲增牌 → 庄增牌；观看增牌时收拢该手首两张
- 玩家点击后依次完成伸手、捏牌、抬牌、翻面、压回与收手，荷官自动开牌使用独立动作
- 3D 牌面、纸张纹理与原创透明手部素材，支持键盘和减少动态效果
- 发牌、荷官自动翻牌、玩家左右捏角与键盘快开分别使用独立手部姿态；移动端会缩短动作行程，减少动态效果时直接完成状态切换
- 电影感、标准、快速三档牌桌节奏独立保存；快速档四张首牌在两秒内完成，系统减少动态效果始终优先
- 牌纸、牌靴与筹码事件优先播放可追溯的 CC0 实录，并提供总音量、效果、环境与荷官口令四路独立控制；浏览器不支持时回退到合成音
- 网络断开或同源探测失败后每 10 分钟自动重试；浏览器恢复联网时立即复检，不中断本地牌局
- 玩家开牌时按已公开牌面生成桌边助威气泡，使用“公、无边、两边、三边、四边”等常见挤牌术语且不预告暗牌
- 珠盘路、大路、大眼仔、小路、曱甴路完整大屏
- 每局牌面、五项下注、返还、庄佣金、净输赢、前后余额和规则版本记录
- 最近 500 局浏览器本地持久化，支持 CSV / JSON 导出
- 可编辑匿名昵称的全体玩家分页排行榜；D1 只保留每个匿名身份到达过的最高教学分
- 牌桌内重置按钮一键恢复 10,000 教学分、新牌靴和空记录，且不会降低已上报的历史最高分
- 每个下注区可按实际放置顺序逐枚撤回最后一枚筹码；键盘、读屏与移动端均保留完整核心操作
- 本局规则轨迹只解释已经公开的牌面，不提前泄露暗牌；独立 Web Worker 概率实验室支持 100 / 1,000 / 10,000 局并显示理论值、偏差与 95% 置信区间
- 主牌桌优先的精简界面，路单大屏与完整牌局记录按需展开
- 桌面、平板、移动端响应式布局与减少动态效果支持
- 单元测试与可复现的百万局概率审计

## 默认规则与赔率

本项目采用八副牌标准佣金桌：

| 注项 | 净赢赔率 | 含本金总返还 |
| --- | ---: | ---: |
| 闲 Player | 1:1 | 2.00× |
| 庄 Banker | 0.95:1 | 1.95× |
| 和 Tie | 8:1 | 9.00× |
| 闲对 / 庄对 | 11:1 | 12.00× |

和局时庄、闲原注退回。对子仅比较各自首两张牌的 rank；例如 K 与 Q 都计 0 点，但不构成对子。

本模拟桌限额为：庄/闲每项 10–10,000 分；和/闲对/庄对每项 10–1,000 分，
均以 10 分递增。本桌设置为不可同时下注庄与闲；这是明确的模拟桌 house rule，
并非声称所有实体赌场都采用同一限制。

现场流程选定为澳门式“闲家先开”。本模拟器只有一位真实操作者，因此把庄/闲主注视为
对应一侧的最高坐位投注；仅下和或对子时由荷官开牌。不同赌场、贵宾厅及自动派牌桌可以采用
其他合法持牌或开牌方式。

八副牌理论结果基准：

- 庄胜：45.8597423%
- 闲胜：44.6246609%
- 和局：9.5155968%

这些是超大样本组合枚举值。单副牌靴自然会发生连庄、连闲或明显偏离，不应强行校正。

## 本地运行

要求 Node.js 24+。

```bash
npm ci
npm run dev
```

完整验证：

```bash
npm run check
npm run audit:probability
```

模块边界、权威牌桌快照和 Web Lock 安全契约见
[架构说明](docs/architecture.md)。`npm run check` 会同时检查依赖方向和旧写入链是否重新出现。

概率审计默认运行 1,000,000 局，使用固定测试种子；生产洗牌不接受用户种子。

## Cloudflare Pages

本项目把排行榜数据严格分成两个环境；D1 UUID 不是 secret，但发布守卫会逐项核对，禁止
目标漂移：

| 运行环境 | 固定 Git / Pages 分支 | D1 |
| --- | --- | --- |
| 本地与 Pages preview | `preview` | `nine-road-baccarat-leaderboard-preview` (`e0bfb3cc-1dbe-4663-97a4-adaa691b62b0`) |
| Pages production | `main` | `nine-road-baccarat-leaderboard` (`c941400a-5a6c-459a-bdc6-28884b58f8fa`) |

`wrangler.jsonc` 的 top-level、`env.preview` 和 `env.production` 都显式声明 D1；Pages
配置格式不接受 `secrets` 字段，因此 `LEADERBOARD_RATE_LIMIT_SECRET` 由发布前置检查直接
向 Cloudflare 核验。本地默认只使用 preview 配置；不要用裸 `wrangler d1 ... --remote`
绕过项目脚本。

### 本地 Pages / D1

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run build
npm run db:migrate:local
npm run serve:e2e
```

`.dev.vars` / `.env` 及其环境变体均被 Git 忽略，只有不含真实密钥的 example 文件允许提交。
请把 example 占位值换成独立的 32 字符以上本地随机值。

### Preview 与 production 发布

全体玩家排行榜通过 Pages Function `/api/leaderboard` 和 D1 binding
`LEADERBOARD_DB` 共享数据。第一次发布前分别交互式写入两个**不同**的 32 字符以上随机
密钥；命令不会把值写进仓库：

```bash
npx wrangler pages secret put LEADERBOARD_RATE_LIMIT_SECRET --env preview --project-name nine-road-baccarat-lab
npx wrangler pages secret put LEADERBOARD_RATE_LIMIT_SECRET --env production --project-name nine-road-baccarat-lab
```

发布固定遵循 `secret → preflight → migration → no-pending verify → deploy → smoke`。
fresh 数据库会按序应用 `0001`–`0004`；已有数据库使用同一命令，但 Wrangler 只应用
`d1_migrations` 尚未记录的 upgrade。任何远程 migration 前，preflight 都会失败优先核对：
明确目标、当前分支、配置中的 D1 名称/UUID、远程 D1 实体，以及对应 Pages 环境是否存在
加密 secret 键名。前置检查还会通过 Cloudflare Pages API 核对当前远端
`production_branch=main`，并检查最新 production 部署仍来自 `main`；它优先使用
独立的 `CLOUDFLARE_PAGES_READ_TOKEN`（建议使用仅含 Pages Read 的最小权限 token；
Wrangler 不会把它用于 D1、secret 或 deploy 命令），其次兼容完整发布链使用的
`CLOUDFLARE_API_TOKEN`，否则只做
best-effort 复用当前 Wrangler default profile 的明文 OAuth 登录且绝不输出 token；使用
encrypted keyring、非 default profile 或凭据过期时会 fail-closed，要求显式 API token。
Production 还会硬性要求 `main` 的 tracked 与 untracked worktree 全部干净，
且没有跳过开关；发布前提交预期变更并确认 `git status --short` 无输出。Preview 固定使用
非 `main` 的 `preview` 分支，允许脏 worktree 进行验证。

Preview：

```bash
git switch preview
npm run release:preflight:preview
npm run db:migrate:preview
npm run db:verify:preview
npm run deploy:preview
npm run smoke:leaderboard -- https://<明确的-preview-deployment-url> --confirm-write
```

Production：

```bash
git switch main
npm run release:preflight:production
npm run db:migrate:production
npm run db:verify:production
npm run deploy:production
npm run smoke:leaderboard -- https://<明确的-production-url> --confirm-write
```

没有目标含糊的 `deploy` 或 `db:migrate:remote` 脚本。两个 `deploy:*` 都会重新执行
architecture / Functions 类型与打包 / build，随后再次 preflight、对**本环境**执行 migration、
确认没有 pending migration，最后用固定 `--branch preview` 或 `--branch main` 发布。
Wrangler 的机器可读部署结果必须再次匹配目标 environment、`production_branch=main`、项目名、
部署 ID 与明确版本 URL，否则脚本失败且不会把部署宣告为成功。smoke 没有默认 URL，且必须
显式确认写入；它会创建一个一次性匿名身份并依次验证 GET 200、
POST 200（含安全整数 `rank >= 1`）与并发冷却 429。`npm run check:release` 的静态环境隔离契约已通过
`check:functions` 接入 `npm run check` 和现有 CI。

缺少或过短的服务端密钥时，上报会失败关闭，但本机牌桌仍可使用。

排行榜是**自报、未验证的模拟榜**：匿名令牌只能证明后续请求仍来自同一浏览器身份，
不能证明客户端上报的金额一定由真实牌局演进产生。API 会限制请求大小、分页、昵称、
异常金额和同一身份的提交频率。写入边界为：单身份变更间隔 2 秒、单网络每分钟
最多 30 次上报请求、每小时最多 5 个新身份、最高金额 10 亿教学分、全榜最多
100,000 个身份。Function 仅将 Cloudflare 接入网络地址与服务端密钥做 HMAC 后用于配额，
不保存原始地址；超过 24 小时的配额记录会在后续有效写入时清理。共享网络可能共享配额，
攻击者也可能通过更换网络绕过，因此这仍不是防作弊证明；排行榜不得用于奖金、兑换、
公平竞赛或任何有经济利益的排名。要做可信排名，必须把随机发牌、牌局状态和余额结算
迁到服务端权威执行并验证，而不是让客户端自行签名成绩。

牌与筹码录音的原始文件、转码和许可收据见
[`public/assets/audio/ATTRIBUTION.md`](public/assets/audio/ATTRIBUTION.md)。体验设置、概率实验结果与音频分轨使用独立本机键，不会写入或改动 v2 权威牌桌快照。

本地保存用于教学连续性和意外损坏检测，不是赌场级权威账本。牌靴与历史位于浏览器端，
具备设备控制权的用户仍可检查或修改本机数据；如需不可篡改、不可预知的多人真钱系统，
必须改用服务端权威牌靴、签名追加账本与合规基础设施。

读取本机记录时会校验完整 416 张物理牌、烧牌/游标、补牌结果、结算与余额链。为避免两个
标签页重复推进同一局，缺少或拒绝 Web Locks 的浏览器会拒绝开始/恢复牌局，而不会退化为
无互斥保护的“可用”状态。

## 公开依据

- [新加坡 GRA：Marina Bay Sands Baccarat Version 8](https://www.gra.gov.sg/docs/default-source/game-rules/mbs/baccarat-games/mbs-baccarat-game-rules---ver-8.pdf)
- [澳门博彩监察协调局：百家樂法定规章](https://www.dicj.gov.mo/web/cn/rules/Bacara.html)
- [Wizard of Odds：八副牌组合枚举](https://wizardofodds.com/games/baccarat/basics/)
- [Wizard of Odds：Baccarat Score Boards](https://wizardofodds.com/games/baccarat/history/)
- [环球博彩：百家樂挤牌习俗与桌边术语](https://wgm8.com/szh-blast-from-the-past-squeeze-play/)

MBS 公开规则允许 4–10 副牌，澳门规则也允许其他副数；八副牌是本模拟器选定的标准配置，并非声称所有金沙现场牌桌都固定使用完全相同的副数或限额。

## 技术栈

React 19、TypeScript、Vite、Vitest、Cloudflare Pages。

许可证：MIT
