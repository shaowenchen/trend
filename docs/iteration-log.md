# 迭代日志（dsh 会话断点文档）

> 约定：每个会话/回合把进度落到这里，重启后按文件接上，不依赖会话上下文。

## 2026-10-12 · 第六轮：照 momoyu.cc 那一版换观感 + 中文热榜不再截断

用户要求（原话）："https://momoyu.cc/ 参考以下这个风格，重新更新以下设计。
另外，你需要包含全部这里的数据"。三处范围由用户当场确认：

| 问题 | 用户选择 |
|---|---|
| 首页要不要变成实时数据大盘 | **只换视觉风格** —— 保留"一张卡一个面板入口"的结构 |
| 范围 | **整站统一换肤**（34 个面板页 + 首页 + 两个标签页，中英各一） |
| 暗色主题 | **暗色为默认，亮色跟随系统** |

### 实测取证（不是凭印象抄的）

`momoyu.cc` 是 Vue SPA（`/assets/index-*.js`），WebFetch 拿不到东西 ——
用无头 chrome 截图 + PIL 采样取的真实配色：

- 页面底 `#18191e`（rgb 24,25,30）、卡片 `#1f2025`（rgb 31,32,37）、
  搜索框 `#2a2d34`。**卡片与页面只差一档亮度，没有描边** —— 密集排布下
  每张卡一圈边线会把版面切碎，这是那一版"密而不乱"的关键。
- 强调色 `#409eff`（CSS 变量 `--el-color-primary`，Element Plus 默认）。
- 每张卡 = 彩色来源字徽（知乎蓝"知"、微博红"微"…）+ 平台名 + "（N分钟前）"，
  下面编号列表：名次带色（前三红）、标题两行、热度右对齐。

API 直测（`/api/hot/list?type=0`）：13 个来源，站方给的 `icon_color` 就是各家品牌色，
本轮直接采用（见下）。站方的榜条数 12–100 不等，**不是 20**。

### 做了什么

1. **配色**（`web/public/site.css` 顶部 token 块重写）：暗色写进 `:root` 当默认，
   亮色由 `prefers-color-scheme: light` 覆盖（仍是"只跟随系统、无切换按钮"的约定，
   所以不需要在 head 插抢绘制前跑的内联脚本）。两套配色各自完整定义 ——
   亮色那套的 `--accent` 特意比暗色深（`#1667c8` vs `#409eff`），
   因为 `#409eff` 压白底只有 ~2.6:1，拿它当链接文字读不清。
2. **新增 `--hover`**：原来 hover 用的是 `--bg`，在亮色世界成立（页面比卡片深），
   换暗色之后 `--bg` 比卡片**暗**，卡片会"陷下去"像按下去了。所以单独一个变量。
3. **密度收紧**：圆角 14→10px、页头 58→52px、面板间距 22→14px、
   表格行距与各处 padding 小一号；入口卡改成 momoyu 那种紧凑卡
   （图标 38→32px、说明收成一行、去掉位移与阴影、hover 换描边+提亮）。
4. **★ 修了一处既有缺陷**：榜单页的标题一直是 `<h1>`（`trend.js` 里
   `SINGLE_BOARD ? 'h1' : 'h2'`），而 CSS 只写了 `.panel-head h2` ——
   于是每个榜单页的标题都退回浏览器默认的 `2em` + 上下 margin，
   比它下面所有内容都大一截。改成 `.panel-head :is(h1, h2)`。
5. **13 个中文热榜的来源色**：把颜色写进 `--src` 变量，两处图标各取一次 ——
   榜单页面板头（`#panel-<id>`）与**首页入口卡**（`a.entry[href="<id>.html"]`）。
   写两份规则迟早漏一处，所以只声明一次。爱范儿站方给的是 `#fff`（白图标在
   浅色主题里等于没有），改用可读的灰 `#6c7a89`。
6. **数据不再截断**（`scripts/fetch-momoyu-hot.mjs`）：`PER_SOURCE_LIMIT`
   20 → `Infinity`。快照 260 → **471 条**（85KB），B站 100、虎扑 60、微博 51
   全都进来了 —— 页面上的"完整列表（100 条）"从此真的是 100 条。
   理由与取舍写在该常量上方与 `docs/trend-sources.md` §9。

### 验证

`npm test` 全绿（9 / 7 / 97 / 16 / 41 = 170 条），`npm run build` 通过。
无头实测（暗色用 `--force-dark-mode`；★ 本机 chrome 默认报
`prefers-color-scheme: light`，不加这个 flag 量到的是亮色）：
首页 · zhihu · repos（真实 GitHub 数据） · bilibili（100 条） · tags · tag?t=cn-hot ·
en/index · 390px 移动端，均正常；亮色版抽样复核未回归。

### 没做（用户明确没选）

首页**没有**变成 momoyu 那种"一屏铺满全部来源的实时大盘" —— 那会推翻
第五轮"一个面板一页"的返修结论。若将来要做，是独立一轮的事。

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
- [x] 推送上线（5e84c3d）+ 线上实测通过：aiNews（149 条 · 8 组）、
      momoyu（246 条 · 13 组）、en/aiNews 全部 200 且有数据，
      快照 JSON 线上可取（39KB / 45KB）。
- [ ] **待推**：e47b679（refresh-snapshots.yml 三合一每日 cron，替代原
      gh-trending 单独工作流）—— 仍需带 workflow 权限的凭据。推送前
      快照不会每日自动刷新（面板照常工作，只是数据停在入库时刻）。

### 每日快照工作流（待推送后生效）

`.github/workflows/refresh-snapshots.yml`：每天 00:30（UTC+8）跑
fetch-gh-trending / fetch-ai-news / fetch-momoyu-hot，三步各自
continue-on-error（部分成功仍提交成功部分），diff 为空不提交。

### 环境注意（AGENTS.md 纪律）

- 本机 3.5G 内存：无头 chrome 一次一条；起渲染前 `free -h`。
- datasets-server 校准数据当天已打过几百个请求，桶回填需 ~70s，勿连测。
- 微信通知：`/home/shaowenchen/Projects/.dsh-hooks/notify.sh "…"`（失败不重试）。

## 2026-10-01 · 第三轮：AI 官方要闻（用户点名 8 家一手信源）

- [x] 逐源实测：7 家 RSS 全通（OpenAI/TechCrunch·AI/Ars·AI/GitHub Blog/
      DeepMind/MSR/NVIDIA）；**The Decoder 域名挂牌出售**（GoDaddy 停靠页）
      → 观察项，快照 skipped 字段如实记录并在页面显示（trend-sources.md §10）。
- [x] fetch-ai-press.mjs（复用 §9 的 parseRssItems，逐源回退 + 直跑守卫）；
      aiPress 面板与 aiNews 共用 mountNewsPanel 工厂（一手源无热度口径 →
      不硬造列，卡片主数值是时间；观察项进 note）。
- [x] 快照入库 7 源 117 条；本地全绿（trend 95 / ainews 16 / site 36 等）+
      无头实测（117 条 · 7 组 · 观察项声明可见）。
- [x] 推送上线（8ec9e34）+ 线上实测通过：aiPress / en / 快照 JSON 全 200，
      面板 ok、117 条、**7/7 源有条目**（DoD ≥6），note 显示
      "最老来源抓取于 … · 观察项：The Decoder"；微信交付已发。
- [ ] **待推**：16417cc（四合一每日快照工作流 refresh-snapshots.yml）——
      仍需带 workflow 权限的凭据。注意：工作流提交不能混进面板提交的
      祖先链（GitHub 按"推送包含的提交树"判 workflow 权限，推过一次
      被拒：即便面板提交本身不含 .github，祖先链里的工作流提交也会挡）。

## 2026-10-01 · 第四轮：momoyu 细化为「科技热榜 + 中文热榜」两个精选面板

- [x] API 复测（200 · 13 榜 · 条数与用户给的一致；无 CORS → 快照维持）。
- [x] 用户方向 + 自主取舍（方案/理由在 trend-sources.md §9 与 trend.js 注释）：
      科技热榜 8 榜（知乎/CSDN/掘金 + IT之家/虎嗅/爱范儿/中关村在线 + B站）、
      中文热榜 4 榜（微博/头条/虎扑 + 豆瓣）、值得买落选（促销比价）。
      两个面板共用同一份全量快照（fetch 脚本不变），分组真值
      MOMOYU_TECH_KEYS / MOMOYU_CN_KEYS 在 trend.js。
- [x] 替换原 13 榜全量面板（momoyu.html 已删，页面 404）；本地全绿
      （trend 97 / ainews 16 / site 36）+ 无头实测（techHot 148 条 8 组、
      cnHot 80 条 4 组，note 标"momoyu.cc 聚合"）。
- [ ] 推送上线 + 线上实测 + 微信交付。

## 2026-10-01 · 第五轮：返修——13 个中文热榜独立成页 + 去聚合站品牌

- [x] ①首页入口：线上首页本就有全部面板卡片（23 张，拆分前的版本）；
      本轮拆 13 页后首页共 34 张卡，中英同步。
- [x] ②去品牌：发布物（页面/i18n/标签/JS 注释/快照 JSON/数据文件名
      cn-hot.json）零"momoyu/摸摸鱼"字样；函数名 flattenMomoyu→flattenHotList；
      工程记录（docs §9 + 抓取脚本注释）保留真实管道出处（不编数据）。
- [x] ②拆分：techHot/cnHot 两块聚合面板删除（页面 404），13 个榜各自独立
      面板/路由（zhihu.html…zhidemai.html），共用 loadHotList(key) 加载器
      与同一份全量快照；每页快照声明用该榜的站方抓取时刻。
- [x] "仅 AI"过滤保留（理由一行：全站一致、零成本；命中少是真实信号）。
- [x] 本地：全绿（trend 97 / ainews 16 / site 36）+ 无头实测 13/13 页 ok
      有数据 + 旧页 404 + dist 品牌清扫 0 残留。
- [x] 推送上线（37cd536）+ 线上实测通过：13/13 页中英双语 200 且有数据
      （抽查 zhihu/weibo/bilibili/csdn 面板 ok），首页 34 张入口卡（中英），
      页面零品牌残留；微信交付已发。
- [x] 工作流 refresh-snapshots.yml 已重建为本地待推提交 d9ceb83（四合一，
      步骤名已中性化）—— 推送仍需带 workflow 权限的凭据。
