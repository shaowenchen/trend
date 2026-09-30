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

**一个面板一页**：每条趋势（榜单）是一个独立地址，首页每张卡片正好对应一个 ——
不把十七个面板堆在一页里。

| 地址 | 作用 |
|---|---|
| `index.html` | 中文入口页：十七个面板的入口卡片 |
| `trending.html` `liked.html` `downloaded.html` | 模型榜：正在流行 / 最受喜欢 / 下载最多 |
| `eval.html` `aider.html` | 评测与编程能力榜 |
| `spaces.html` `datasets.html` `papers.html` `repos.html` | 社区热度：应用 / 数据集 / 论文 / 开源项目 |
| `newmodels.html` `swebench.html` | 大体积榜（点击后才拉取） |
| `openrouter.html` | OpenRouter 模型用量榜（约 1.1MB，进页面就拉） |
| `tags.html` | 全部标签（来源 + 分类），每个标签带条数 |
| `tag.html?t=<标签>` | 含该标签的榜单，卡片式 |
| `en/…` | 以上每一个的英文版（含标签页），文件名相同 |

页头**三样**：左上角「首页」与「标签」，右上角切换语言。十七个榜单不进页头 ——
它们就是首页的入口卡片（下面一格一张卡），页头再列一遍等于同一份目录出现两次。
页面**下方**另有一条由 `trend.js` 生成的 `.board-links`，列出全部面板并带
「刷新数据」按钮 —— 那是"看完了换下一个"的那条路。

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
所以 40 个页面文件里没有第二份面板名。

> ★ 刻意**没有** `hreflang`（以及 canonical / og:url）：它们的地址必须是绝对 URL，
> 而本站不写死域名。代价是中英两页之间没有对搜索引擎的互译声明。
> 详见 `i18n.js` 顶部。
>
> 页面骨架的文案**不进字典**，因为骨架是手写静态文件、没有构建期之外的注入层；
> 它由三件事保证不出错：`i18n.test.js` 要求两种语言的键完全一致，
> `site.test.js` 要求**每个被代码引用的键都存在**（见下面「曾经静默坏掉的一处」），
> 以及两条"英文页里不许有中文 / 中文页里不许有整句英文"的断言。

## 十七个面板

每个面板都有自己的页面（下表第一列即地址的文件名去掉 `.html`）：

| 面板 | 页面 | 来源 | 口径 |
|---|---|---|---|
| 正在流行的模型 | `trending` | HuggingFace Models API | `sort=trendingScore` |
| 最受喜欢的模型 | `liked` | 同上 | `sort=likes` |
| 下载最多的模型 | `downloaded` | 同上 | `sort=downloads` |
| 开源模型评测榜 | `eval` | HF `open-llm-leaderboard/contents` | 4576 行原始成绩（IFEval / BBH / MATH / GPQA / MMLU-PRO），**本站自己取全量后按平均分排序** |
| 编程能力榜 | `aider` | Aider `polyglot_leaderboard.yml` | 同一模型取最高 `pass_rate_2` |
| 正在流行的 AI 应用 | `spaces` | HuggingFace Spaces API | `sort=trendingScore` |
| 正在流行的数据集 | `datasets` | HuggingFace Datasets API | `sort=trendingScore` |
| 每日论文热榜 | `papers` | HF `daily_papers` | 按点赞数排序 |
| 高星 AI 开源项目 | `repos` | GitHub Search API | **可切**本周 / 本月新增星标与历史总星标 |
| 最新发布的模型 | `newmodels` | models.dev | 按 `release_date` 降序；数据 4.8MB 含 8000 个模型，**点击后才加载** |
| OpenRouter 模型用量榜 | `openrouter` | `openrouter.ai/api/frontend/v1/rankings/models` + `/api/v1/models`（只为名字） | 按**当天 token 用量**排序，日更 7 天窗口；standard/batch/free **已合并**（见 `docs/trend-sources.md` §4） |
| OpenRouter 上升榜 | `orTrends` | 同上 `…/rankings/discovery` | **周环比增幅**（本周 vs 上周）；子榜：上升 / 突破 |
| OpenRouter 厂商份额 | `orAuthors` | 同上 `…/discovery` 的 `authors` | 各机构 token 份额与周环比变化 |
| OpenRouter 性能榜 | `orPerf` | 同上 `…/rankings/performance` | 实测 p50 延迟 / 吞吐（190 个模型，取最快的 provider）；子榜：延迟 / 吞吐 |
| Artificial Analysis 评测榜 | `aaBench` | 同上 `…/rankings/benchmarks` | 与 HF 评测榜**不同来源**，可并列对照；子榜：综合智能 / 编程 / 智能体 |
| OpenRouter 应用榜 | `orApps` | 同上 `…/rankings/apps` + 三个多模态端点 | 哪些 agent 应用在烧 token（日/周），以及图像/视频/语音模型用量 |
| SWE-bench | `swebench` | `swe-bench.github.io` 官方榜 | 真实代码修复能力，5 个子榜**可切**；数据 4MB，**点击后才加载** |

页面靠 `<div id="panels" data-board="eval">` 指名自己要跑哪一个（`trend.js` 读它）。
这些 id 同时是**文件名、导航目标、发布白名单里的条目** —— 三处必须一起改，
`site.test.js` 有断言盯着。没写 `data-board` 的页面会跑全部面板（那是老版大盘页的行为，留作兜底）。

> **没有 Arena 榜**：LMArena 官方榜没有公开 JSON，且响应不带 CORS 头 ——
> 在"浏览器直连"的前提下做不了（GitHub Pages 更不可能代理）。
> 全部取舍与实测取证见 `docs/trend-sources.md`。

## 标签（来源 + 分类）

每个榜单带两个标签：**来源**（HuggingFace / GitHub / models.dev / Aider /
OpenRouter / SWE-bench）与**分类**（Models / Evaluation / Coding / Community /
Papers）。真值只有一处：`web/public/assets/boards.js` 的 `BOARD_TAGS`。

标签出现在三处，都是同一份数据：

| 位置 | 形态 | 为什么 |
|---|---|---|
| 首页入口卡片 | **静态**标签片 | 卡片本身是 `<a>`，HTML 不允许 `<a>` 套 `<a>`（解析器会提前闭合外层，整片栅格散架）。要按标签逛走页头入口 |
| 榜单页的面板头与页脚 | **链接**（进 `tag.html?t=`） | 读者看完一个榜，顺手就能看到"同类还有哪些" |
| `tags.html` / `tag.html` | 链接 + 卡片分组 | 按来源/分类逛的两个页面 |

> 标签文字**不进 i18n 字典**，中英共用一份（专有名词 + 简短的英文分类词）。
> 走字典会得到一个更糟的状态：`tag.html?t=模型` 这种地址在英文站上无解 ——
> URL 里的标签值也得跟着分语言。站点其余文案照旧走字典，这里是有意的例外。

**两个页面都是构建期生成的**（`src/site/nav.js` 的 `renderTagsPage` /
`renderTagPage`），理由与页头导航相同，而且这里更重：分类页的价值在于让搜索引擎
发现"这些榜是一类"，客户端渲染在爬虫眼里是空页。`tag.html` 把**全部**标签与
全部卡片都落成静态 HTML，`assets/tags.js`（十几行）再按地址里的 `?t=` 收窄
—— 分组**默认不隐藏**，所以禁用 JS 时看到的是"全部榜单"而不是空白。

静态托管没有 rewrite，做不到"一个标签一个文件"（那会让每加一个标签就多发布
两个页面），所以用查询参数。代价是这些地址不进索引 —— 可接受，它们主要服务于
站内导航。

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

- **一个面板一页**：页面标题就是面板名（由 `trend.js` 渲染成 `<h1>`），
  没有另写一个 hero 标题 —— 一页一个 h1，且面板名只有字典一处来源。
- **页头三样**：左边「首页」+「标签」，右边切换语言（构建期生成，
  `src/site/nav.js` + `{{SITE_NAV}}`，不是抄 40 份）。十七个榜单**不进页头** ——
  它们已经在首页的入口卡片里各占一张卡，页头再列一遍就是同一份目录的第二次出现；
  「标签」是一条**入口**（按来源/分类逛），不是榜单清单。
  语言切换**指向对应的那一页**（`repos.html` ↔ `en/repos.html`），
  换语言时读者留在原来的榜单上，而不是被丢回首页。
  页头的两个元素都是 `header-inner` 的直接子元素，靠它的 `space-between`
  各就各位；首页链接在首页带 `aria-current`（给读屏器，不画出来）。
- **页面下方还有一条面板跳转**（`.board-links`，由 `trend.js` 生成）：它摆在面板
  之后，作用是"看完了换下一个"，并带一个「刷新数据」按钮 —— 刷新依赖 `trend.js`，
  所以它只能由脚本生成，不能进页头。
- **主题只跟随系统**（CSS 的 `prefers-color-scheme`），页面**没有主题切换按钮**。
  这样无需 JS 参与，浏览器在首次绘制前就定好了配色 —— 不存在"先白后黑"的闪烁。
- **图标全部是内联 SVG**（不用 emoji）：emoji 的字形由操作系统决定，
  Windows / Android / iOS 上长得完全不同。
- **全端适配**：手机、平板、桌面到打印各有规则；评测榜 9 列在窄屏收起次要列、
  首列与表头粘住；触控目标 ≥44px；尊重 `prefers-reduced-motion` 与安全区。

---

## 纯静态带来的约束（三处）

| 约束 | 做法 | 为什么 |
|---|---|---|
| 占位符只能构建期落值 | 品牌名 `{{BRAND}}` 与 GTM 片段 `{{GTM}}` 由 `scripts/build-site.mjs` 替换 | 没有"响应时"这一层；发布物里残留占位符会直接让构建失败 |
| 页面地址带 `.html` | `index.html`、`eval.html`、`en/eval.html`… | Pages 没有 rewrite，无扩展名的 `/trend` 做不到 |
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
少了它，`/eval.html` 与 `/eval.html/` 这类地址会解析到不同的目录。

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
| `site.test.js` | 站点门禁：文案键存在、HTML 引用与**脚本 import** 都能解析到发布集合、无绝对路径、无占位符残留、语言不串页、**首页卡片与面板一一对应**、面板页与发布白名单对齐、标签非空且每个都筛得出面板、**卡片里不许套链接** |

## 代码结构

```
web/public/                       手写静态页（页面 + 样式 + 客户端脚本）
  index.html                      中文入口：十七个面板的入口卡片
  <board>.html                    ★ 十七个中文面板页（eval.html、repos.html…）
  tags.html  tag.html             标签总览 / 按标签筛选
  en/index.html  en/<board>.html  对应的英文版（文件名相同）
  site.css
  assets/
    trend.js                      面板注册表 + 数据层与渲染（1600 行，主体在这里）
    boards.js                     面板 id 唯一来源（★ 必须在 assets/ 下，见下）
    tags.js                      标签页的收窄脚本（只读 ?t=，页面静态生成）
    i18n.js                       双语字典 —— 面板文案的唯一来源
    ui.js                         内联 SVG 图标
    *.test.js                     测试（★ 不发布，构建的白名单挡在外面）
src/site/brand.js                 品牌名唯一来源 + 占位符替换/校验
src/site/gtm.js                   GTM 容器 ID 唯一来源 + 两段代码片段
src/site/nav.js                   页头导航的构建期生成器（{{SITE_NAV}}：首页 + 语言切换）
scripts/build-site.mjs            构建：白名单复制 + 落占位符 + 校验
scripts/serve.mjs                 本地预览服务器（零依赖）
scripts/live-check.mjs            上游数据源体检（联网）
docs/deploy.md                    部署与排错
docs/trend-sources.md             每个数据源的实测可用性
.github/workflows/pages.yml       测试 → 构建 → 发布到 Pages
```

面板页是"一个面板一页"，所以加一个面板要动五处：`assets/boards.js` 的
`BOARD_IDS` **与 `BOARD_TAGS`**（后者不填的话那一页就没有标签、也不出现在任何
标签组里）、`trend.js` 的加载器、中英两个页面文件、首页的入口卡。
少任何一处都会在 `npm test` 里暴露，不会静默上线 —— 构建白名单从 `BOARD_IDS`
推导，页脚的面板跳转由 `trend.js` 从同一份清单生成，都不用手改。

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
