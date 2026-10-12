# Trend · AI 趋势大盘

把各家平台的 AI 榜单收进一个页面：模型趋势、社区热度、开源评测、编程能力。

**纯静态站，部署在 GitHub Pages**：没有服务端、没有数据库、没有构建依赖。
榜单数据由访客的浏览器**直接向上游公开接口**请求。
对外的第三方请求只有一个：Google Tag Manager（统计）。

> 有三处设计是被"没有服务端、不写死域名"这个前提决定的：品牌名与 GTM 容器 ID
> 的占位符**构建期**才落成真值、页面地址带 `.html` 后缀、
> canonical / hreflang 这类需要绝对地址的标记一律没有。
> 见下面「纯静态带来的约束」。

---

## 页面

**单页站，没有二级页面**：三十四个榜单全部在首页上按主题六类铺开，
滚到哪个面板才去上游取那个榜的数据（懒加载）。
标签是**页内筛选**（点一下只看这一类），不是另一个页面。

| 地址 | 作用 |
|---|---|
| `index.html` | 中文首页：粘性索引条 + 六个主题段 + 三十四个面板 |
| `en/index.html` | 英文首页，文件名相同、内容对应 |

页头**两样**：左上角「首页」，右上角切换语言。榜单不进页头 —— 它们就在这一页上。
找榜/筛选用页头下方那条**吸顶索引条**（四行）：
主题六类筛选（带本类榜单数）· 三十四个面板的跳转锚点（横向可滚动）
· 二十一个来源筛选（横向可滚动）· 「刷新数据」按钮。

站点地址取决于仓库名：项目页是 `https://<用户名>.github.io/<仓库>/`，
若仓库名就是 `<用户名>.github.io`，则挂在域名根下。
**两种都不用改代码** —— 页面里的引用全是相对路径（见下面「为什么全是相对路径」）。

## 双语

两种语言是**独立 URL**（`en/` 目录，文件名与中文页相同），不是一个切换按钮：
只有独立地址才能让两种语言各自被搜索引擎收录，两个版本之间在导航里互相链接。

面板文案只有**一处来源**：`web/public/assets/i18n.js`。
页面骨架里的固定文案（标题、导航）是手写的两份 —— 中英文各写各的，
**不会**把两种语言都塞进同一页再靠 CSS 藏起来（那样两种语言都会进索引，还被判重复内容）。
面板标题也是：它由 `trend.js` 从字典里取，渲染成页面的 `<h1>`，
所以页面文件里没有第二份面板名。

> ★ 刻意**没有** `hreflang`（以及 canonical / og:url）：它们的地址必须是绝对 URL，
> 而本站不写死域名。代价是中英两页之间没有对搜索引擎的互译声明。
> 详见 `i18n.js` 顶部。
>
> 页面骨架的文案**不进字典**，因为骨架是手写静态文件、没有构建期之外的注入层；
> 它由三件事保证不出错：`i18n.test.js` 要求两种语言的键完全一致，
> `site.test.js` 要求**每个被代码引用的键都存在**（见下面「曾经静默坏掉的一处」），
> 以及两条"英文页里不许有中文 / 中文页里不许有整句英文"的断言。
>
> 主题段标题与索引条**由构建期生成**（`src/site/nav.js` 的 `renderTopics` /
> `renderIndex`），所以它们的文案来自 `i18n.js`（主题名是 `tag.<slug>`）——
> 与客户端同源，不另抄一份。

## 三十四个面板

每个面板都在首页上（下表第一列即 `trend.js` 里的面板 id，也是 `#panel-<id>` 锚点）：

| 面板 | id | 来源 | 口径 |
|---|---|---|---|
| 正在流行的模型 | `trending` | HuggingFace Models API | `sort=trendingScore` |
| 最受喜欢的模型 | `liked` | 同上 | `sort=likes` |
| 下载最多的模型 | `downloaded` | 同上 | `sort=downloads` |
| 开源模型评测榜 | `eval` | HF `open-llm-leaderboard/contents` | 4576 行原始成绩（IFEval / BBH / MATH / GPQA / MMLU-PRO），**本站自己取全量后按平均分排序**；46 页**限速拉取**（3 并发+错峰+退避，上游限流实测），失败回退最近快照并标抓取时刻 |
| 编程能力榜 | `aider` | Aider `polyglot_leaderboard.yml` | 同一模型取最高 `pass_rate_2` |
| 正在流行的 AI 应用 | `spaces` | HuggingFace Spaces API | `sort=trendingScore` |
| 正在流行的数据集 | `datasets` | HuggingFace Datasets API | `sort=trendingScore` |
| 每日论文热榜 | `papers` | HF `daily_papers` | 按点赞数排序 |
| AI 新闻热点 | `aiNews` | HN(Algolia) · dev.to · TechCrunch · The Verge · Latent Space · Interconnects · arXiv·cs.AI · lobste.rs | **8 源每日快照聚合**（部分源无 CORS）；按时间倒序、可按来源分组；页面标"最老来源抓取于 …"，某源失联保留其旧块与旧时刻 |
| AI 官方要闻 | `aiPress` | OpenAI · TechCrunch · Ars Technica · GitHub Blog · DeepMind · 微软研究院 · NVIDIA 官方博客 | **8 家一手信源快照聚合**（官方 RSS 均无 CORS）；官方 RSS 无统一热度口径，不硬造列；The Decoder 域名挂牌出售 → **观察项**如实显示 |
| 高星 AI 开源项目 | `repos` | GitHub Search API | **可切**本周 / 本月新增星标与历史总星标 |
| GitHub Trending | `ghTrending` | `github.com/trending`（HTML 解析） | **构建期快照**（页面无 CORS，浏览器直连做不了）；默认**仅 AI 相关**可切全部；每日 Actions 刷新，失败保留旧快照 |
| 知乎热榜 | `zhihu` | 中文热榜聚合管道（见 docs §9） | 知乎站内热度排序问题榜的**构建期快照**，条目链接指向知乎 |
| CSDN 热榜 | `csdn` | 同上 | CSDN 技术社区热榜快照 |
| 掘金热榜 | `juejin` | 同上 | 掘金技术社区热榜快照 |
| IT之家热榜 | `itzhijia` | 同上 | IT之家科技资讯热榜快照 |
| 虎嗅热榜 | `huxiu` | 同上 | 虎嗅科技商业热榜快照 |
| 爱范儿热榜 | `aifaner` | 同上 | 爱范儿科技媒体热榜快照 |
| 中关村在线热榜 | `zhongguancun` | 同上 | 中关村在线硬件资讯热榜快照 |
| B站热榜 | `bilibili` | 同上 | B站热门视频榜快照 |
| 微博热搜 | `weibo` | 同上 | 微博站内热搜榜快照 |
| 今日头条热榜 | `toutiao` | 同上 | 今日头条站内热榜快照 |
| 虎扑步行街热榜 | `hupu` | 同上 | 虎扑步行街热帖榜快照 |
| 豆瓣热话 | `douban` | 同上 | 豆瓣热门话题快照 |
| 值得买热榜 | `zhidemai` | 同上 | 值得买 3 小时热门促销榜快照 |
| 最新发布的模型 | `newmodels` | models.dev | 按 `release_date` 降序；数据 4.8MB，**进页面即加载**（约 0.5s） |
| OpenRouter 模型用量榜 | `openrouter` | `openrouter.ai/api/frontend/v1/rankings/models` + `/api/v1/models`（只为名字） | 按**当天 token 用量**排序，日更 7 天窗口；standard/batch/free **已合并**（见 `docs/trend-sources.md` §4） |
| OpenRouter 模型库 | `orCatalog` | `openrouter.ai/api/v1/models`（0.76MB，CORS `*`） | 全部可路由模型的**目录**：价格（$/M tokens）/ 上下文 / 模态 / 上线时间，按上线时间降序；失败回退本地快照并标时刻 |
| OpenRouter 上升榜 | `orTrends` | 同上 `…/rankings/discovery` | **周环比增幅**（本周 vs 上周）；子榜：上升 / 突破 |
| OpenRouter 厂商份额 | `orAuthors` | 同上 `…/discovery` 的 `authors` | 各机构 token 份额与周环比变化 |
| OpenRouter 性能榜 | `orPerf` | 同上 `…/rankings/performance` | 实测 p50 延迟 / 吞吐（190 个模型，取最快的 provider）；子榜：延迟 / 吞吐 |
| Artificial Analysis 评测榜 | `aaBench` | 同上 `…/rankings/benchmarks` | 与 HF 评测榜**不同来源**，可并列对照；子榜：综合智能 / 编程 / 智能体 |
| OpenRouter 应用榜 | `orApps` | 同上 `…/rankings/apps` + 三个多模态端点 | 哪些 agent 应用在烧 token（日/周），以及图像/视频/语音模型用量 |
| SWE-bench | `swebench` | `swe-bench.github.io` 官方榜 | 真实代码修复能力，5 个子榜**可切**；数据 4MB，**进页面即加载**（约 1s） |

首页正文是六个主题段（`<section class="topic" id="topic-<主题>">`），每个面板由
`trend.js` 运行时挂进**自己主题那一段**（`rootFor(id)`），于是同类的榜挨在一起。
id 同时是**锚点目标（`#panel-<id>`）、索引条跳转片、`BOARD_ICONS` 的键** ——
少登记一处就会在 `npm test` 里暴露（头像名写错会让 `icon()` 抛错、整页骨架炸掉）。

> **懒加载**：滚到面板附近（`rootMargin: 600px`）才去上游取数。这是扁平页的必需项 ——
> `newmodels`（4.8MB）、`swebench`（4MB）、`openrouter` + `orCatalog`（~1.9MB）、
> `eval`（46 页限速）如果进页面就全开拉，首屏会被最慢的源拖住。深链接
> `#panel-<id>` 会立刻加载目标，不必等滚到。
>
> **大表格延后**：折叠区（完整列表）里的表格**展开时才建**。`eval` 的完整表是
> 4576 行 × 9 列 —— 三十四个面板各建一份等于几万个看不见的单元格。

> **没有 Arena 榜**：LMArena 官方榜没有公开 JSON，且响应不带 CORS 头 ——
> 在"浏览器直连"的前提下做不了（GitHub Pages 更不可能代理）。
> 全部取舍与实测取证见 `docs/trend-sources.md`。

## 标签（主题 + 来源）

每个榜单带两个标签：**主题**（它是什么榜）与**来源**（数据从哪来）。
真值只有一处：`web/public/assets/boards.js` 的 `BOARD_TAGS`。

**主题六类互不重叠，每个榜恰好一个** —— 所以「点主题标签」就等于「看这一类」，
过滤本身即是分类：

| 主题 | 榜单 |
|---|---|
| 模型榜 `models` | trending · liked · downloaded · newmodels · openrouter · orCatalog |
| 评测榜 `benchmarks` | eval · aider · aaBench · swebench |
| 社区生态 `ecosystem` | spaces · datasets · papers · repos · ghTrending |
| 平台洞察 `platform` | orTrends · orAuthors · orPerf · orApps |
| 资讯 `news` | aiNews · aiPress |
| 中文热榜 `cn-hot` | zhihu · csdn · juejin · itzhijia · huxiu · aifaner · zhongguancun · bilibili · weibo · toutiao · hupu · douban · zhidemai |

来源则按主题各有各的：AI 榜单是 HuggingFace / Aider / GitHub / models.dev /
OpenRouter / Artificial Analysis / SWE-bench（它同时是**可信度**信息 ——
榜的口径以来源方为准）；资讯两张榜多源聚合，来源记作「多源聚合」；
13 个中文热榜虽来自同一份聚合快照，但**各记一个平台**来源 ——
这样点「微博」筛出的就是微博那一个榜，而不是 13 个一起出。

**标签是就地筛选**（扁平站之后没有标签页）：索引条上有主题筛选片（6 + 全部）与
来源筛选片（21，横向滚动），每个面板头里还有它自己的主题 + 来源两片 ——
点一下就把页面收窄，**再点一次取消**。主题与来源取交集；筛完是空的主题段整段隐藏。

> 标签值是**英文 slug**（`data-tag-filter="models"`），两种语言共用同一个值；
> **显示文字**按页面语言从字典取（`i18n.js` 的 `tag.<slug>`）——
> 中文站显示「模型榜」，英文站显示 `Models`。若把显示文字当值，
> 筛选逻辑就得跟着语言变，那是没必要的。

标签出现在三处，都是同一份数据（`boards.js` 的 `BOARD_TAGS`）：

| 位置 | 形态 | 为什么 |
|---|---|---|
| 索引条的主题行 | 主题筛选片（6 + 全部），带本类榜单数 | 一页装下 34 个面板，"只看这一类"是最常用的动作 |
| 索引条的来源行 | 来源筛选片（21），横向滚动 | 同一份来源横跨多个主题，单列一行才好找 |
| 面板头 | 该榜的主题 + 来源两片 | 看到某个榜，顺手就能收窄到它这一类 / 这个来源 |

筛选片是 `<button data-topic-filter>` / `<button data-tag-filter>`，**不是链接** ——
它不是"另一个地址"，而是把当前页收窄（再点一次取消）。用 `<button>` 还顺手保证了
无障碍语义，并避免了"`<a>` 套 `<a>`"（本站曾在入口卡片上踩过，整片栅格散架）。

## 面板怎么展示

**卡片（前 10）→ 点进详情 → 完整列表（折叠，可筛可排）**

- 每个面板先给 **10 张卡片**，一眼看完最靠前的是谁。卡片上是大号的关键数字
  （趋势分 / 平均分 / 解决率 / 星标）与几个标签（任务 / 机构 / 日期）。
- **点卡片弹详情**：字段与表格的列**同源**（都由同一份 `cols` 生成），
  所以不会出现"加了列但详情里没有"。详情里还给一个打开原始页面的链接。
- 详情用**原生 `<dialog>`**：Esc 关闭、焦点陷阱、背景 inert 都是浏览器给的 ——
  自己拼浮层通常只做对第一件。
- 完整列表收在**折叠区**里（默认收起）：卡片回答"最靠前的是谁"，
  表格回答"第 47 名是谁 / 按成本排一下"，两者不是同一个问题，都要有。

## 每个面板都能过滤和排序

- **搜索**：按关键词筛当前面板（模型名 / 仓库名 / 论文标题 / 服务商…）
- **分组**：有天然分类的面板给一个分组下拉（任务 / SDK / 语言 / 机构 / 服务商），括号里是条数
- **排序**：点表头即排，再点一次反向；当前排序列有箭头，读屏器能听到 `aria-sort`
- **名次会跟着重算**：筛掉一半后序号从 1 重排，不会停在原始的 1、3、7…
- ★ **空值恒排在最后**（升序也是）。否则一升序，"缺数据的"会全聚到榜首，
  读者看到的就是一个由空值组成的假榜。

## 界面

- **单页 + 三级标题**：页面 `<h1>` 是站点名（手写的骨架文案），六个主题段是
  `<h2>`（构建期落在骨架里），面板标题是 `<h3>`（由 `trend.js` 渲染）——
  一页一个 h1，层级一以贯之，且面板名/主题名都只有字典一处来源。
- **页头两样**：左边「首页」，右边切换语言（构建期生成，`src/site/nav.js` 的
  `renderNav`）。榜单不进页头 —— 它们就在这一页上。扁平站只有两个页面，
  语言切换因此走目录语义（`en/` 与 `../`）。
  页头的两个元素都是 `header-inner` 的直接子元素，靠它的 `space-between`
  各就各位；扁平页上每个页面都是首页，所以首页链接恒带 `aria-current`。
- **索引条吸顶**（`.board-index`，四行：主题 / 跳转 / 来源 / 刷新）：
  34 个面板要滚很久，它如果跟着滚走，翻到中段想换一类就得回到顶部。
  跳转行与来源行**横向滚动不换行** —— 否则吸顶条会高过一屏、反而不堪用。
  「刷新数据」按钮也在这一行（它依赖 `trend.js` 的 `reloadAll`，所以只能由脚本绑）。
- **配色暗色为默认**，浅色系统偏好时自动切成亮色（CSS 的 `prefers-color-scheme`），
  页面**没有主题切换按钮**。这样无需 JS 参与，浏览器在首次绘制前就定好了配色 ——
  不存在"先白后黑"的闪烁。两套配色各自完整定义（不是一套加滤镜）：
  同一个强调色在白底与深底上的对比度不可能都达标，所以亮色那套的 `--accent`
  比暗色的深一档。
- **图标全部是内联 SVG**（不用 emoji）：emoji 的字形由操作系统决定，
  Windows / Android / iOS 上长得完全不同。
- **全端适配**：手机、平板、桌面到打印各有规则；评测榜 9 列在窄屏收起次要列、
  首列与表头粘住；触控目标 ≥44px；尊重 `prefers-reduced-motion` 与安全区。

---

## 纯静态带来的约束（三处）

| 约束 | 做法 | 为什么 |
|---|---|---|
| 占位符只能构建期落值 | 品牌名 `{{BRAND}}` 与 GTM 片段 `{{GTM}}` 由 `scripts/build-site.mjs` 替换 | 没有"响应时"这一层；发布物里残留占位符会直接让构建失败 |
| 页面地址带 `.html` | `index.html`、`en/index.html` | Pages 没有 rewrite，无扩展名的 `/trend` 做不到 |
| 需要绝对地址的标记一律没有 | 不写 canonical / hreflang / og:url / 站长验证 | 它们的地址只能来自"部署在哪里"，而本站刻意不写死域名（见下） |

统计（Google Tag Manager）是**有**的：容器 ID 与部署地址无关，不违反上面任何一条。
它的 ID 与代码片段同样只有一处来源（`src/site/gtm.js`），构建期落下。
换来的一点是门禁免费 —— "发布物里不许残留占位符"那条现成的断言自动覆盖它。

### 为什么全是相对路径

页面里没有一行以 `/` 开头的引用，且每个页面都写 `<base href="./">`。

理由是项目页挂在 `/<仓库>/` 这个**子路径**下：写 `/site.css` 会解析到
`https://<用户名>.github.io/site.css`，那里什么都没有 ——
整站白屏，而浏览器只会给几条 404，页面上什么都不会说。
相对路径对"子路径"与"自定义域名根目录"两种挂法都成立，
所以不需要 `BASE_PATH` 这类配置，也就不存在"换个地方就白屏"。

`<base href="./">` 则把这些相对路径**钉在本文件所在目录**上：
少了它，`/index.html` 与 `/index.html/` 这类地址会解析到不同的目录。

`site.test.js` 有一条断言盯着"页面里不许出现 `/` 开头的资源引用"。

### 曾经静默坏掉的一处（构建门禁就是为此加的）

`trend.js` 引用了 `err.evalFirst`、`err.noBoards`、`st.dated`、`st.ghLimit`、`st.retry`
五个文案键，而字典里**从来没有这五个键** —— `t()` 在缺键时返回键名本身，
所以线上错误提示显示的是 `err.evalFirst` 这样的字符串。

翻译自检抓不到它：那条断言只要求"两种语言的键一致"，而这五个键是**一致地都缺**。
现在补上了键，并在 `site.test.js` 里加了一条新断言：
**每个被代码引用的键都必须在字典里存在**。这类漏配以后会在本地暴露。

---

## 三条设计取向

1. **页面不做任何数据工作。** 榜单由浏览器直接请求上游 —— **根本没有服务端**
   （不是"服务端不做"，是没有）。代价是能不能取到由上游的 CORS 决定 ——
   所以每个源都必须实测过（`docs/trend-sources.md`）。
2. **一个面板坏了不拖垮整页。** 每个面板各自取数、各自渲染、各自报错。
   某个源挂了，只有那一块显示错误。
3. **不静默失败，也不猜数据。** 拿不到就明说哪个源、什么错、部分成功了多少页；
   上游格式变了就报"本面板需同步"，而不是解析出一个悄悄错位的值。

---

## 快速开始

零依赖，不需要 `npm install`。

```bash
npm start        # 构建 + 起本地预览 → http://localhost:8788
npm run build    # 只构建，产物在 dist/
```

验证：

```bash
npm test           # 四组本地测试（不联网）：字典 / 图标 / trend.js 纯逻辑 / 站点门禁
npm run test:live  # 对真实上游体检：状态码 · CORS · 耗时 · 分页是否仍可用（联网）
```

`npm test` 里的四组各盯一件事：

| 文件 | 盯什么 |
|---|---|
| `i18n.test.js` | 两种语言的键一致、无空值、英文侧不含中文 |
| `ui.test.js` | 图标表与 `[data-icon]` 回填 |
| `trend.test.js` | YAML 子集解析、评测行字段提取、"同模型取最高分"的合并规则 |
| `site.test.js` | 站点门禁：文案键存在、HTML 引用与**脚本 import** 都能解析到发布集合、无绝对路径、无占位符残留、语言不串页、**发布集合恰为两个首页**、**六个主题段都在且面板都挂得进去**、**每个榜恰好一个主题且每个主题都有榜**、每个标签两种语言都有名字、**面板头像都有对应图标**、**旧的二级页面确实删干净了** |

## 代码结构

```
web/public/                       手写静态页（页面 + 样式 + 客户端脚本）
  index.html                      中文首页：h1 + 索引条 + 六个主题段（骨架）
  en/index.html                   英文首页，文件名相同
  site.css
  assets/
    trend.js                      面板注册表 + 数据层与渲染（约 1800 行，主体在这里）
                                  含：主题分段挂载 rootFor / 骨架复用 ensurePanel /
                                  懒加载观察器 / 索引条筛选 / 大表格延后构建
    boards.js                     面板 id、图标、标签（主题/来源）的唯一来源（★ 必须在 assets/ 下，见下）
    i18n.js                       双语字典 —— 面板文案的唯一来源
    ui.js                         内联 SVG 图标
    *.test.js                     测试（★ 不发布，构建的白名单挡在外面）
src/site/brand.js                 品牌名唯一来源 + 占位符替换/校验
src/site/gtm.js                   GTM 容器 ID 唯一来源 + 两段代码片段
src/site/nav.js                   构建期生成：页头导航 + 索引条 + 六个主题段骨架
scripts/build-site.mjs            构建：白名单复制 + 落占位符 + 校验
scripts/serve.mjs                 本地预览服务器（零依赖）
scripts/live-check.mjs            上游数据源体检（联网）
docs/deploy.md                    部署与排错
docs/trend-sources.md             每个数据源的实测可用性
.github/workflows/pages.yml       测试 → 构建 → 发布到 Pages
```

扁平站里加一个面板要动**三处**：`assets/boards.js` 的 `BOARD_IDS`、
`BOARD_TAGS`（主题 + 来源）与 `BOARD_ICONS`（头像名，必须是 `ui.js` 里有的图标）；
`trend.js` 的 `BOARD_LOADERS` 加载器；`i18n.js` 两种语言的 `p.<id>.title` 与
`p.<id>.hint`。**不用改页面文件** —— 首页骨架是从 `BOARD_IDS` / `BOARD_ORDER`
推出来的，面板自己会出现在它主题那一段、索引条也会多一个跳转片。
少任何一处都会在 `npm test` 里暴露，不会静默上线。

新加一个**主题**（不是榜单）才需要多动两处：`boards.js` 的 `TOPIC_SLUGS` 加 slug，
`i18n.js` 两种语言各加一条 `tag.<slug>`（门禁盯着"每个 slug 两种语言都有名字"），
外加 `boards.js` 的 `SOURCE_SLUGS` 若也新增来源同理。

> ★ `boards.js` 放在 `assets/` 下是**必须的**，不是随手：浏览器只能拿到发布集合里的
> 文件，而 `trend.js` 要在浏览器里 `import` 它。它曾经住在 `src/site/` 下，
> `trend.js` 那句 `../../../src/site/boards.js` 在线上解析成
> `https://<域名>/src/site/boards.js` → 404 → **整个模块不执行，所有榜单页空白**，
> 而本地构建与测试按文件系统路径 import，怎么跑都成功。现在构建期有一条
> 「发布出去的脚本没有 import 发布集合之外的文件」（`findMissingImports`）盯着，
> 见 `docs/deploy.md` 排错表。

## 部署

推到 GitHub 后由 Actions 自动发布，见 `docs/deploy.md`。

**首次需要手动做一次设置**：仓库 Settings → Pages → Source 选 **GitHub Actions**。
