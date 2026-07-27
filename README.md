# 九点牌靴 · Baccarat Lab

一款纯模拟、无真钱的八副牌百家乐概率与路单实验室。它不是按固定权重抽取“庄 / 闲 / 和”，而是建立真实的 416 张牌靴，经 Web Crypto 驱动的无模偏差 Fisher–Yates 洗牌后无放回发牌，再严格执行标准 Punto Banco 补牌矩阵。

> 本项目仅供概率教育与软件演示，不涉及真钱、存款、提现或可兑换奖励。本项目与 Las Vegas Sands、Sands China、Marina Bay Sands、The Venetian 及其关联方无关，未获其赞助或背书。历史路单不具备预测能力。

## 功能

- 八副牌（416 张）真实牌靴、烧牌、切牌与自动换靴
- 闲、庄、和、闲对、庄对模拟下注与标准佣金结算
- 下注先锁定结果，由玩家按真实发牌顺序逐张点击牌背翻牌，最后一张翻完才结算
- 零下注“飞牌”沿用同一手动翻牌流程，并同步保留到路单与完整记录
- 已锁定牌局与翻牌进度在本机恢复，刷新页面不会重抽牌局或取消下注
- 3D 牌面翻转、纸张纹理与原创透明手部动作，支持键盘和减少动态效果
- 珠盘路、大路、大眼仔、小路、曱甴路完整大屏
- 每局牌面、点数、下注、净输赢、余额和规则版本记录
- 最近 500 局浏览器本地持久化，支持 CSV / JSON 导出
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

概率审计默认运行 1,000,000 局，使用固定测试种子；生产洗牌不接受用户种子。

## Cloudflare Pages

```bash
npm run build
npx wrangler pages deploy dist --project-name nine-road-baccarat-lab --branch main
```

`wrangler.jsonc` 中的 `pages_build_output_dir` 为 `./dist`。生产站点不需要数据库或密钥；记录仅保存在当前浏览器中。

## 公开依据

- [新加坡 GRA：Marina Bay Sands Baccarat Version 8](https://www.gra.gov.sg/docs/default-source/game-rules/mbs/baccarat-games/mbs-baccarat-game-rules---ver-8.pdf)
- [澳门博彩监察协调局：百家樂法定规章](https://www.dicj.gov.mo/web/cn/rules/Bacara.html)
- [Wizard of Odds：八副牌组合枚举](https://wizardofodds.com/games/baccarat/basics/)
- [Wizard of Odds：Baccarat Score Boards](https://wizardofodds.com/games/baccarat/history/)

MBS 公开规则允许 4–10 副牌，澳门规则也允许其他副数；八副牌是本模拟器选定的标准配置，并非声称所有金沙现场牌桌都固定使用完全相同的副数或限额。

## 技术栈

React 19、TypeScript、Vite、Vitest、Cloudflare Pages。

许可证：MIT
