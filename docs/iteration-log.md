# 迭代日志（dsh 会话断点文档）

> 约定：每个会话/回合把进度落到这里，重启后按文件接上，不依赖会话上下文。

## 2026-10-01 · 本轮：评测榜限流收尾 + 新增 2 个面板（共 19 个）

### 已完成（本地，未推送 → 已推送见下）

1. **评测榜限流修复**（根因已实测校准，见 `trend-sources.md` §2）：
   - 限流是"突发容量 + 慢回填"令牌桶：桶满时 46 页 8 并发全 200（11.9s）；
     桶半空时连 3 并发都会在尾部撞 429；耗尽后 **~70s 才回填**。
   - `EVAL_FETCH`：3 并发 + 批间 700ms + 普通失败短退避（800ms 起）+
     **429 长退避（25s×次数，封顶 60s）** + Retry-After 优先。
   - 缓存三层：sessionStorage 10 分钟（零缺页才进）→ localStorage 快照
     （7 天直用窗口：数据源 2025-03 已归档，快照即全量）→ 失败回退快照
     （不限龄、如实标"抓取于 {time}"）。"刷新数据"置 force 标记强制重拉。
   - `live-check.mjs` 与页面共用 `EVAL_FETCH`。
2. **新增面板 orCatalog（OpenRouter 模型库）**：浏览器直连
   `openrouter.ai/api/v1/models`（CORS `*`，0.76MB，464 模型），
   价格换算 $/M tokens、按上线时间降序；失败回退 localStorage 快照。
   （侦察清单建议构建期快照，本站改直连：目录近实时，快照会过期，理由见 §7。）
3. **新增面板 ghTrending（GitHub Trending，AI 过滤）**：github.com/trending
   无 CORS → **构建期快照**。`scripts/fetch-gh-trending.mjs` + 每日 cron
   `.github/workflows/gh-trending-snapshot.yml`（00:30 UTC+8），失败不提交、
   旧快照保留。解析器 `parseGhTrending` 与 AI 过滤 `isAiRepo`（词边界）住在
   trend.js，页面与 CI 同一份；快照含 `fetchedAt`，页面标"构建期快照 · 抓取于 …"。
   首版快照已生成并入库（17 条，fetchedAt 2026-10-01T01:02:30Z）。
4. **首页/导航/标签**：手写 index.html 补 2 卡（中英）；nav.js BOARD_TITLES/
   BOARD_ICONS、boards.js BOARD_IDS/BOARD_TAGS 已登记（19 面板）。
5. **测试**：trend.test.js 新增 15 条（退避/429 分级/快照策略钉子/parseGhTrending
   真实 fixture/isAiRepo 词边界/flattenGhTrending/flattenOrCatalog 真实条目）。
   本地 `npm test` 全绿（i18n 9 / ui 7 / trend 92 / site 36），`npm run build` 通过。

### 侦察清单与实际情况的对账（重要）

用户确认的 5 个候选（`~/.hermes/workspace/ai-trend-scout/候选-2026-09-30.md`）：

| 候选 | 实际处理 |
|---|---|
| ① OpenRouter 模型库 | ✅ 本轮新增（orCatalog，浏览器直连） |
| ② HF 趋势模型 | 已存在（`trending` 面板，同端点同口径，浏览器直连） |
| ③ HF 趋势 Spaces | 已存在（`spaces` 面板） |
| ④ HF 趋势数据集 | 已存在（`datasets` 面板） |
| ⑤ GitHub Trending | ✅ 本轮新增（ghTrending，构建期快照） |

②③④无需重复接入；清单建议的"边缘函数"与站点"纯静态无服务端"前提冲突，
且这三个端点 CORS 实测可直连（本来就在线上跑）。

### 完成情况（2026-10-01 09:55）

1. [x] 本地无头实测：ghTrending（14 条 AI、快照声明）、orCatalog（464 模型）、
       eval 快照直用路径（预置 localStorage 验证"快照 · 抓取于 …"免网络直出）。
       eval 取数层另用 Node 真实计时器按最终策略复测：46×200 零重试 25s；
       第二轮撞 4×429 全被长退避救回（4576/4576 零缺页）。
2. [x] 推送上线：b1955fe（主体）→ Actions 部署 → 线上实测全部通过：
       ghTrending / orCatalog / trending / spaces / datasets 五页 200 且有数据，
       eval.html 与 en/ 两页 200，线上 trend.js 已含新代码。
3. [x] 微信交付已发。
4. [ ] 首个 cron（次日 00:30 UTC+8）后确认快照自动刷新成功。
5. [ ] **待推**：651f8c5（每日 cron 工作流）—— 需要带 workflow 权限的凭据
       （本轮 PAT 无该 scope，被 GitHub 拒收）。用户给权限后 `git push` 即可。

### 队列第二轮（2026-10-01 12:10 完成）

- [x] 侦察 + 微信方案 + 用户确认（两个面板都加，新闻全部快照模式）。
- [x] **aiNews 面板**（AI 新闻热点，8 源每日快照）：scripts/fetch-ai-news.mjs
      （逐源回退、失败保旧块）+ parseRss/parseAtom/normalizeHn/DevTo/Lobsters
      （真实 fixture 测试 ainews.test.js 13 条）。当天实测修正三处：
      HN 查询改时间序+10 分（7 天+50 分会整周空窗）、The Verge 是 Atom 且
      链接在 link href、XML 实体未还原（&amp; 会显示成字面量）。
- [x] **momoyu 面板**（摸摸鱼热榜，13 榜聚合快照）：fetch-momoyu-hot.mjs，
      块内 fetchedAt 用站方 create_time；AI 过滤在页面端（isAiText 中英词表），
      "全部/仅 AI"切换。
- [x] 本地全绿（i18n 9 / ui 7 / trend 95 / ainews 13 / site 36）+ 构建通过 +
      无头实测两页有数据（aiNews 149 条 8 组、momoyu 246 条 13 组）。
- [ ] 推送上线 + 线上实测 + 微信交付。
- [ ] **待推**：refresh-snapshots.yml（三合一每日 cron，替代原 gh-trending
      单独工作流）—— 仍需带 workflow 权限的凭据。

### 每日快照工作流（待推送后生效）

`.github/workflows/refresh-snapshots.yml`：每天 00:30（UTC+8）跑
fetch-gh-trending / fetch-ai-news / fetch-momoyu-hot，三步各自
continue-on-error（部分成功仍提交成功部分），diff 为空不提交。

### 环境注意（AGENTS.md 纪律）

- 本机 3.5G 内存：无头 chrome 一次一条；起渲染前 `free -h`。
- datasets-server 校准数据当天已打过几百个请求，桶回填需 ~70s，勿连测。
- 微信通知：`/home/shaowenchen/Projects/.dsh-hooks/notify.sh "…"`（失败不重试）。
