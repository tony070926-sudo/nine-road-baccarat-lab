# 九点牌靴代码架构

本项目采用“页面编排 → 展示组件 → 游戏领域与持久化”的单向依赖。动画只能消费已经持久化的牌局结果，不能参与抽牌、补牌或结算决策。

## 目录职责

| 目录 | 职责 | 可以依赖 |
| --- | --- | --- |
| `src/app` | 会话启动、页面级类型、展示派生和固定配置 | `game`、`audio`、`types` |
| `src/components` | 可复用 React 视图与局部交互 | `game`、`audio`、`types`、其他组件 |
| `src/game` | 牌靴、规则、结果完整性、持久化和确定性状态转换 | `types` 与其他 `game` 模块 |
| `src/audio` | 音频资源和空间播放 | `audio` 内部模块 |
| `tests/e2e` | 浏览器级完整牌局、恢复、平台和动效契约 | 对外可观察行为 |

`scripts/check-architecture.mjs` 会阻止领域层反向导入 UI、组件反向导入应用层、旧 v1 写入链重新出现，以及 `App.tsx` 再次无边界增长。

## 牌局数据流

1. `roundPreparation` 从当前牌靴一次性生成完整、不可变的待处理牌局。
2. `tableEngine` 对纯 `TableCoreState` 执行准备、逐张翻牌、结算、换靴和重置转换。
3. `TableCoordinator` 读取权威快照、提交带版本的变更，并把跨标签事件仅视为“重新读取”的提示。
4. `App` 必须先取得 Web Lock，再读取权威版本、调用纯状态转换并提交。
5. React 状态和动画只在提交成功且读回验证通过后推进。

## 耐久化安全契约

- 唯一权威写入键是 `nine-road-baccarat:table:v2`。
- `nine-road-baccarat:v1` 和 `nine-road-baccarat:pending:v1` 只允许迁移读取，不允许继续写入。
- 每次耐久变更必须持有同一个 Web Lock，并携带期望的 `revision` 与 `commitId`。
- `BroadcastChannel` 和 `storage` 事件不是状态，只是要求重新读取并校验权威快照的通知。
- 牌局结果必须先生成、校验和持久化；发牌与翻牌动画不得重抽或改变结果。
- 翻牌进度一次只增加一张；结算在同一提交中清除 pending，并更新牌靴、余额与历史。
- 存储损坏、不可用或写回结果不确定时必须失败关闭，不能以内存状态继续牌局。
- 独占锁跨越整局发牌、玩家开牌和结算；页面退出后由浏览器释放，其他标签页从权威 pending 恢复。

## 版本轴

- `PersistedGameState.version = 1`：游戏状态结构。
- `PersistedPendingRound.version = 1`：待处理牌局结构。
- `schemaVersion = 2`：权威外层快照结构。
- Web Lock 名称和广播频道的版本只标识协调协议，不等同于数据 schema。

升级任一版本时，必须分别评估读取兼容、迁移、跨标签协调和 E2E fixture。

## 渐进式拆分原则

- `App.tsx` 只保留页面组合、React 生命周期和暂未抽离的牌局编排。
- 初始会话读取位于 `src/app/tableSession.ts`，展示派生位于 `src/app/tableUi.ts`。
- 通用弹窗、牌手区域和规则内容位于独立组件中，组件不能导入 `App.tsx` 或 `src/app`。
- Web Lock、版本提交和动画计时仍高度耦合，后续应分别抽成 durable-session 与 motion-controller hook；在恢复和多标签 E2E 覆盖下逐步进行，禁止一次性重写。
- 样式当前依赖既有级联顺序。先删除已无 DOM 的规则，再按 foundation、cards、table、betting、roads、overlays、responsive 的顺序拆分，避免只移动债务。
