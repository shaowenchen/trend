# 趋势数据源：实测可用性

> 站点的一切榜单数据都由**访客的浏览器直接向上游接口**请求。
> 本站（GitHub Pages）**根本没有服务端**，所以没有转发、也没有缓存 ——
> 这是纯粹的静态托管事实，而不是一条设计取舍。
>
> 因此每个源能否用，**只由上游的 CORS 策略决定** —— 没有 CORS 头，浏览器就会拦掉响应，
> 无论我们的代码怎么写。
>
> 本文记录每个源的**实测结论与原始命令**。这类"当时是怎么确认的"信息最容易丢，
> 而丢了之后下一个人会重新踩一遍。核对日期：**2026-09-23**（全部为当日实测）。

---

## 1. 结论表

| 面板 | 端点 | 状态 | CORS | 结论 |
|---|---|---|---|---|
| 🔥 正在流行 | `huggingface.co/api/models?sort=trendingScore&direction=-1&limit=50` | 200 JSON | `https://<站点域名>`（回显 Origin） | ✅ 可直连 |
| ❤️ 最受喜欢 | 同上 `sort=likes` | 200 JSON | 同上 | ✅ 可直连 |
| ⬇️ 下载最多 | 同上 `sort=downloads` | 200 JSON | 同上 | ✅ 可直连 |
| 🏆 开源模型评测榜 | `datasets-server.huggingface.co/rows?dataset=open-llm-leaderboard%2Fcontents&config=default&split=train&offset=&length=` | 200 JSON | 同上 | ✅ 可直连（分页，见 §2） |
| 🧑‍💻 编程能力榜 | `raw.githubusercontent.com/Aider-AI/aider/main/aider/website/_data/polyglot_leaderboard.yml` | 200 text | `*` | ✅ 可直连 |
| 正在流行的 AI 应用 | `huggingface.co/api/spaces?sort=trendingScore` | 200 JSON | 回显 Origin | ✅ 可直连 |
| 正在流行的数据集 | `huggingface.co/api/datasets?sort=trendingScore` | 200 JSON | 回显 Origin | ✅ 可直连 |
| 每日论文热榜 | `huggingface.co/api/daily_papers?limit=50` | 200 JSON | 回显 Origin | ✅ 可直连 |
| 高星 AI 开源项目 | `api.github.com/search/repositories?q=topic:llm…` | 200 JSON | `*` | ✅ 可直连，**但匿名限流 10 次/分钟** |
| 最新发布的模型 | `models.dev/api.json` | 200 JSON | `*` | ✅ 可直连，**4.8MB / 8000+ 个模型 → 进页面即加载** |
| SWE-bench | `raw.githubusercontent.com/swe-bench/swe-bench.github.io/master/data/leaderboards.json` | 200 JSON | `*` | ✅ 可直连，**4MB → 进页面即加载** |
| 🗂️ OpenRouter 模型库 | `openrouter.ai/api/v1/models` | 200 JSON（0.76MB，464 个模型） | `*` | ✅ 可直连（见 §7） |
| 📈 GitHub Trending | `github.com/trending` | 200 **HTML**（650KB） | **无** | ❌ 无 CORS → **构建期快照**（见 §8） |
| 📰 AI 新闻（8 源） | HN·Algolia / dev.to / TechCrunch / The Verge / Latent Space / Interconnects / arXiv / lobste.rs | 全 200 | 2 源 ✓ / 6 源 无 | 📸 全部**构建期快照**（见 §9） |
| 🐟 摸摸鱼热榜 | `momoyu.cc/api/hot/list` | 200 JSON（76KB，13 榜） | **无** | ❌ 无 CORS → **构建期快照**（见 §9） |
| ❌ LMArena 官方榜 | 无可用的公开 JSON；`lmarena.ai/*` | — | **无** | ❌ **做不了**（见 §3） |
| 🔢 OpenRouter 用量榜 | `openrouter.ai/api/frontend/v1/rankings/models` + `openrouter.ai/api/v1/models`（名字） | 200 JSON | `*` | ✅ 可直连（见 §4；上一版曾误判为"没有排名"） |
| ❌ Artificial Analysis | 猜测端点 | 401 | 无 | ❌ 需要 API key |
| ❌ `/orderby`、`/filter`（datasets-server） | — | 404 / 500 | — | ❌ 不可用（见 §2） |

**复核方式**（一条命令看全部，含耗时）：
```bash
npm run test:live
```
它会对每个源发一个带 `Origin:` 的请求，打印状态码 / 类型 / 大小 / **CORS 头** / 耗时，
末尾给结论行。**这是"今天还能不能用"的唯一权威口径。**

---

## 2. 评测榜的两条硬约束（决定了实现为什么这么绕）

数据源是 HuggingFace 上的 `open-llm-leaderboard/contents`，**4576 行真实评测成绩**
（IFEval / BBH / MATH Lvl 5 / GPQA / MMLU-PRO / 平均分 / 参数量）。

约束来自实测：

1. **一页最多 100 条**。`length=500` → `422 Parameter 'length' must not be greater than 100`。
   所以全量要 **46 页**（`ceil(4576/100)`）。
2. **分页按 `eval_name` 字母序，不是按分数**。实测首页五条是
   `0-hero_Matter-0.2-7B-DPO_bfloat16`、`01-ai_Yi-1.5-34B_bfloat16` … 一眼可见是名字排序。
   ⇒ **"榜"必须自己取全量再排序**，服务端不会按分数给你。
3. **匿名请求限流是"突发容量 + 慢回填"的令牌桶（2026-09-30 校准）**：
   - 桶满时 46 页 8 并发连发也能全 200（实测 11.9s）—— **坏掉的是半空的桶**；
   - 本机 46 连发 8 并发（桶已被当天测试耗过）：44×200 + 2×429；
   - 无头浏览器加载真实页面：一次 **13/46 页失败**（只剩 71% 覆盖），
     另一次**连第一页都没拿到** → 整块面板报错；
   - 桶被 46 连发耗尽后**每 10s 探测一次**：+10s…+60s 全 429，**+70s 才恢复 200**
     （回填以分钟计，不是秒）；
   - 旧实现失败后**立刻原样重发** —— 对 429 恰好是再撞一次限流。

还试过但**不可用**的两条捷径：

- `datasets-server` 的 `/orderby` 端点 → **404 Not Found**；
- `/filter?where="Average ⬆️">60` → **500 `the dataset index is loading`**
  （这个数据集 2025-03 后已归档，索引起不来）。

**因此实现是**（2026-09-30 起按第 3 条约束重做取数节奏）：

- **3 并发 + 批间 700ms 错峰**拉完 46 页（`web/public/assets/trend.js` 的 `EVAL_FETCH`），
  持续 ~1.2 请求/秒：桶满时 ~35s 拉完全量，也不再触发限流；
- **退避按失败类型分**（`evalRetryWaitMs`）：普通失败（网络/5xx）短退避
  （800ms → 1.6s → 3.2s，封顶 5s，最多 3 次；第一页 5 次）；**429 走长退避**
  （25s × 次数，封顶 60s —— 等的是桶回填，秒级重试只会连环再撞）；
  上游 429 响应带的 `Retry-After` 优先于自家估算；
- 合并后按平均分降序。**零缺页**的结果缓存进 `sessionStorage`（TTL 10 分钟）；
  部分成功**不进**缓存（否则一次 71% 覆盖会在缓存期内被当成完整榜反复展示）；
- **localStorage 快照**：数据源 2025-03 已归档、内容不再变，所以"每台浏览器
  每 7 天拉一次全量"是常态（7 天内直接用快照并如实标注抓取时刻）；上游整个
  读不动时回退快照（不限龄、标旧时刻），不给空面板。"刷新数据"会强制重拉。
- `live-check.mjs` 与页面共用同一份 `EVAL_FETCH` —— 体检跑的就是访客的真实节奏。

> **数据时效性提醒**：该数据集最后更新于 2025-03（榜单本身已归档），所以"评测榜"的分数
> 反映的是那时的开源模型。这是**上游的事实**，本站不做二次加工，也不掩饰。

---

## 2.5 SWE-bench（唯一"权威榜"里能直连的）

`www.swebench.com` 本身是 Next.js 渲染的 HTML、**没有 CORS**，但它把数据存在自己的
GitHub 仓库里，而 `raw.githubusercontent.com` 对任何仓库都返回 `CORS: *` —— 所以能直连。

- 数据：`data/leaderboards.json`（**4MB**，5 个子榜 Multilingual / Test / Verified / Lite / Multimodal）。
  文件里带**逐题明细**的长数组，所以体积大，实测约 1 秒。它曾与 models.dev 一起做成
  "点击才加载"，现已改成**进页面即加载**：这一页只有这一张榜，读者点进来就是要看它，
  多一次点击只是一步多余的仪式。代价是首屏等 1 秒 —— 与"打开一个空页面再点一下"
  相比，那是划算的。
- 取第一个 **Verified** 子榜（最常被引用），同模型的多次提交按**最高分**去重。
- ★ **量纲坑**：`resolved` 是**已经在 0–100 的百分数**（Verified 最高 79.2；若按 0–1 比例
  解释则不可能超过 1）。展示时直接用，**绝不能再 ×100**。
  `trend.test.js` 与 `live-check.mjs` 各有一道守卫盯着这个口径。
- 另一个坑：官方数据里确实存在 `resolved: null` 的条目，而 `Number(null)` 是 `0`
  且 `isFinite(0)` 为真 —— 直接用 `Number()` 判断会把"没有成绩"当成 **0 分**混进榜。
  代码里显式先挡 `null/undefined/''`，同样有测试。

## 3. 为什么没有 LMArena（Arena）榜

owner 明确点名过要 Arena 榜，但它**在这条"前端直连"的路线上做不了**：

- `lmarena.ai/leaderboard` 是**服务端渲染的 HTML**（页面里没有公开 JSON 端点），
  且响应**不带 `access-control-allow-origin`** —— 浏览器直连必被拦；
- 猜测过的端点（`lmarena.ai/api/leaderboard`、`storage.googleapis.com/arena-external-data/leaderboard.json`）
  分别**无响应 / 404**；
- 它发布在 HF 上的数据（如 `lmarena-ai/arena-human-preference-55k`）是**人类偏好原始对局**，
  不是榜单分数，前端拿它算不出 Arena Elo（且要读庞大数据集）。

**要接 Arena 就得加一层服务端代理**，那会破坏"前端直拉原生接口"这个前提。
owner 的决定（2026-09-23）：**先不放**。

---

## 4. OpenRouter 用量榜（2026-09-30 补上，推翻了上一版的结论）

上一版这里写的是"OpenRouter 能取但没有排名"，理由是 `/api/v1/models` 里没有排名字段。
**那个结论对，但这个判断错了**：排名不在 `api/v1` 里，而在它站内榜单用的
`api/frontend` 那一路。把 `/rankings` 页面的请求扒出来就看到了：

```
https://openrouter.ai/api/frontend/v1/rankings/models     ← 用量榜（主数据）
https://openrouter.ai/api/v1/models                       ← 模型清单（只为拿显示名）
```

两个都是 200、CORS `*`、**无需鉴权**（`/api/v1/models/user` 才要 key）。
榜单页自己的代码是 `/api/frontend/*`，但那个前缀是我试出来的 ——
所以找这类端点时的做法是"看它站内页面的请求"，不是猜路径。

### 数据形状（实测，不是猜的）

`rankings/models` 返回 `{data: [...]}`，每行是**某个模型某一天**的用量：

| 字段 | 含义 |
|---|---|
| `date` | 日粒度，`"2026-09-29 00:00:00"`；窗口 **7 天** |
| `model_permaslug` | **模型身份**（`deepseek/deepseek-v4.1-flash-20260910`） |
| `variant` | `standard` / `batch` / `free` |
| `variant_permaslug` | 上面两者拼起来（`…-20260910:batch`） |
| `rankingMetricValue` | 该日 token 用量；**恰好等于** `total_prompt_tokens + total_completion_tokens`（602/602 行相等） |
| `count` | 请求数 |

### 三个必须处理的地方（都踩过）

1. **同一模型是好几行。** `standard` / `batch` / `free` 各一行，按行排会得到
   "GPT-5.6 Luna"、"GPT-5.6 Luna (batch)"这种把同一个模型拆成三份的榜。
   所以按 `model_permaslug` 合并 —— 合并后也**顺带解决了**名字里的 `(batch)` 后缀
   （清单里带 `(batch)` 的那条是另一个 id，见第 3 点）。
2. **有 1 行 `model_permaslug` 是空串**（不是模型，是"未归属"的合计），要丢掉。
3. **接口不带显示名。** 名字只能靠 `/api/v1/models` 连接，三级匹配：
   `id` 精确 → `canonical_slug` 精确 → 去掉 `-YYYYMMDD` 后缀后相等。
   清单**只有对话模型**（464 个），而用量里含音频/视频/embedding/rerank，
   所以必然有一部分解析不到 —— 实测**按用量加权的覆盖率 97.7%**，
   落到 slug 的那 2.3% 在页面上标一个「无显示名」标签，**不编名字**。

两个请求合计约 1.1MB、一次往返，所以进页面就拉（与 SWE-bench / models.dev 现在的处理一致）。

`?order=top-weekly` 之类的排序参数确实被忽略（上一版测的没错），
但那是 `api/v1` 的老结论，与用量榜无关。

### `rankings/` 下还有 15 个端点（2026-09-30 实测，全部 CORS `*`）

把它们全挖出来之后，OpenRouter 能做的**不止一张榜**。同一个 `/rankings` 页面背后：

| 端点 | 内容 | 做成哪张榜 |
|---|---|---|
| `discovery` | `climbing`(8) / `breakouts`(8) / `authors`(8) / `modelOfWeek` / `totals`(548) / `routerTokens` / `videoRequests` | 上升榜、厂商份额 |
| `performance` | 190 个模型的 p50 延迟 / 吞吐 / 请求量 / 最快 provider | 性能榜 |
| `benchmarks` | Artificial Analysis 的 intelligence(103) / coding(148) / agentic(103) + `percentilesBySlug` | AA 评测榜 |
| `apps` | 按 **agent 应用**归因的用量，`day` / `week` 两窗口 | 应用榜 |
| `image-output` / `video-output-hours` / `stt-transcript-characters` | 图像 / 视频 / 语音模型的用量序列 | 多模态用量 |
| `models` | 按天的模型用量（7 天） | 模型用量榜（本站已有的那张） |
| `programming-language` / `natural-language` | 按编程语言 / 自然语言的 token 序列 | 未做（与模型榜重叠） |
| `session-cost` / `task-spend` | 按 harness / 任务类别的花费 | 未做（偏费用，与榜的取向不同） |
| `context-length` / `model-rankings-chart` / `modality-chart` / `modality-models` / `rerank-documents` | 曲线与分布数据 | 未做（前两个要参数） |

★ **`changePercent` 在同一接口里有两套单位**（这是本轮最容易踩的坑）：
`climbing` 给的是**百分数**（359.85 = +359.85%），`breakouts` 给的是**比率**
（3.57 = +357%），`authors` 的也是比率（0.0289 = +2.9%）。
数值看着差不多，乘 100 之后差两个数量级 —— 混排会让突破榜整条沉到上升榜末尾，
而页面上**不会报错**。所以换算集中在 `growthPct(v, kind)` 一处做，
`trend.test.js` 有一条断言把它钉住。

★ **两个多模态端点多套一层**：`image-output` 是 `{data:[{x,ys}]}`，而
`video-output-hours` / `stt-transcript-characters` 是 `{data:{data:[{x,ys}]}}`。
按同一种形状解析的话，后两个只会得到一行（把 `data` 当模型映射，取到 `cachedAt`
这种键），页面上表现为"只有一个模型的榜"。另外 `Others` 是上游的**合计桶**，
不是模型，要排除。

---

## 5. 实测耗时（2026-09-23，`npm run test:live` 原始输出）

```bash
npm run test:live
```

下面是当时的一次原始输出（含耗时）：

```
✅ HF 趋势模型     200 · 27KB · 698ms · CORS: https://<站点域名>
✅ HF 最受喜欢     200 · 25KB · 343ms · CORS: https://<站点域名>
✅ HF 下载最多     200 · 28KB · 334ms · CORS: https://<站点域名>
✅ Aider 编程榜    200 · 45KB · 408ms · CORS: *
✅ 评测榜 全量     4576 行 / 46 页 · 4576 行到手 · 0 页失败 · 7.8s
   └ 可解析 4576 行 / 4497 个模型；榜首 MaziyarPanahi/calme-3.2-instruct-78b (平均 52.1)
```

即访客首次打开 `/eval.html`（无缓存）大约需要 **8 秒左右**才把评测榜填满，
上面其余几个源在 **1 秒内**就上屏（一个面板一页之后，访客一般只会等自己看的那一个）。
第二次打开走 `sessionStorage` 缓存，即时。

---

## 6. 失败时的表现（刻意如此）

每个面板**独立**取数、独立渲染、独立报错：

- 某个源没有 CORS 或挂掉 → **只有那个面板**显示"读取失败：<具体错误>"，其余照常；
- 评测榜部分页失败 → 显示"N 个模型 · 覆盖 M 页（K 页失败，结果可能不完整）"，
  **不假装完整**；
- Aider 榜的 YAML 若被上游改成超出最小子集的写法 → 明确报"上游改了写法，本面板需同步"，
  **绝不猜一个错值**（有测试盯着这条：`web/public/assets/trend.test.js`）。

这是本项目的既有取向：**宁可不显示，也不静默出错值**。

---

## 7. OpenRouter 模型库（2026-10-01 新增）

`openrouter.ai/api/v1/models` —— 全部可路由模型的目录（464 个，0.76MB JSON）。
与用量榜（§4）互补：那边回答"谁在被用"，这边回答"有什么可用的、多少钱"。

- **CORS `*`**（2026-09-30 实测，`access-control-allow-origin: *`），浏览器直连可行；
  站点本来就在客户端拉它（用量榜取模型名），不是新通道。
- 字段：`id` / `name` / `created`（unix 秒）/ `context_length` /
  `architecture.modality` / `pricing.prompt|completion`（**每 token 美元的字符串**，
  `"0.000002"` → 换算成 $2/M tokens 展示）/ `canonical_slug`。
- 0.76MB 与 models.dev（4.8MB）/ SWE-bench（4MB）同属"进页面就拉"的量级，
  且 `cache-control: max-age=120` 有边缘缓存。
- 失败回退：localStorage 里留一份最后一次成功抓取的快照（标旧时刻），不给空面板。
- 侦察清单（`~/.hermes/workspace/ai-trend-scout/候选-2026-09-30.md`）建议
  "构建期快照取子集"；本站改为**浏览器直连**：CORS 通、体积可承受、
  目录是近实时更新的 —— 构建期快照会把"近实时"变成"上次部署时"，反而更差。

## 8. GitHub Trending 每日榜（2026-10-01 新增，唯一的构建期快照源）

`github.com/trending` —— GitHub 官方每日趋势榜。

- **为什么必须快照**：页面响应**不带 CORS**（2026-09-30 实测），浏览器直连做不了；
  650KB 的 HTML 也不该让每个访客拖一遍。
- **管道**：`scripts/fetch-gh-trending.mjs` 抓 HTML → `parseGhTrending()`（与页面
  **同一份**实现，住在 `trend.js`）→ 落 `assets/data/gh-trending.json`
  （含 `fetchedAt`）→ `.github/workflows/gh-trending-snapshot.yml` 每日 00:30（UTC+8）
  跑一次，有变化才提交（提交触发 Pages 部署）。
- **失败语义**：抓不到 / 解析 < 5 条 → 非零退出、**不提交** → 仓库里的旧快照
  原样保留，页面继续显示旧快照与它的旧抓取时刻。宁可旧，不可错。
- **AI 过滤**：默认只看 AI 相关（关键词表 + 词边界匹配，`isAiRepo`），
  可切全部。词边界是硬要求：storage 里的 rag、html 里的 ml、array 里的 ai
  都不该命中（有测试盯着）。
- 解析依赖的标记（h2 链接 / `p.col-9` 描述 / stargazers·forks 链接 / "N stars today" /
  `programmingLanguage`）均取自 2026-10-01 的真实页面；GitHub 改版时解析条目骤减，
  抓取脚本按"少于 5 条"拒绝提交 —— 门禁在 CI 侧。

---

---

## 9. AI 新闻（8 源）与 摸摸鱼热榜（2026-10-01 新增，构建期快照）

用户确认的方案：**全部快照**（含 CORS 可直连的 2 源）—— 对上游最友好
（每天每源 1 个请求），"抓取于 …"标注统一，新闻时效损失 ≤24h 如实可见。

### AI 新闻 8 源（`scripts/fetch-ai-news.mjs`，快照 `assets/data/ai-news.json`）

| 源 | 端点 | 形状 | 备注 |
|---|---|---|---|
| Hacker News · AI | `hn.algolia.com/api/v1/search_by_date?query=AI OR LLM OR GPT&numericFilters=points>10` | JSON | ★ 不用"近 7 天+points>50"：实测会整周空窗；按时间序+10 分线永不空 |
| dev.to · AI | `dev.to/api/articles?tag=ai&top=7` | JSON | 反应数当热度 |
| TechCrunch · AI | `…/category/artificial-intelligence/feed/` | RSS | ⚠️ 会 429（当日实测），逐源回退兜住 |
| The Verge · AI | `…/rss/ai-artificial-intelligence/index.xml` | **Atom** | ★ 根元素是 Atom；链接在 `<link href>`（`<id>` 是 tag: URI）；`<title type="html">` 带属性 |
| Latent Space | `latent.space/feed` | RSS(substack) | 1.4MB 全量 feed，只取前 20 |
| Interconnects | `interconnects.ai/feed` | RSS(substack) | 同上 |
| arXiv · cs.AI | `export.arxiv.org/api/query?cat:cs.AI` | Atom | ⚠️ 限流狠（当日连打几次后冷却 10 分钟+）；链接回落 `<id>`（abs 页） |
| lobste.rs · AI | `lobste.rs/t/ai.json` | JSON | ★ 最热榜里 ai 标签稀疏，用**标签订阅**才稳定 |

实测落选：量子位 403、机器之心 /rss 返回 HTML 壳（RSS 已下线）、Reddit
top.json 拦截、VentureBeat 稳定 429、smol.ai /rss 404。

失败语义：**逐源回退** —— 某源当天抓不到，保留它上次的块与旧 `fetchedAt`；
8 源全失败才非零退出不提交。页面标注"最老来源抓取于 …"（标最旧比标最新诚实）。
解析器有真实 fixture 测试（`ainews.test.js`），含 XML 实体还原（`&amp;` → `&`，
不还原页面上会显示字面量）。

### 摸摸鱼热榜（`scripts/fetch-momoyu-hot.mjs`，快照 `assets/data/momoyu-hot.json`）

- `GET momoyu.cc/api/hot/list?type=0`（**带浏览器 UA**，裸 UA 会被拒）→ 200 JSON：
  13 个来源（知乎/微博/豆瓣/虎扑/IT之家/虎嗅/CSDN/掘金…）各带条目与
  **站方 create_time**；`/api/hot/source` 需登录（401），`/api/hot/top` 是
  20 条跨源聚合（备用）。响应无 CORS → 只能快照。
- 口径：每源前 20 条；块内 `fetchedAt` 用**站方 create_time**（比"我们何时拉的"
  更接近数据真相）；`extra` 是站方热度文字（'552 万'），保留原文不解析成数字。
- AI 过滤在**页面端**做（`isAiText`：中文子串 + 英文词边界），"全部 / 仅 AI"
  由读者切换 —— 快照存全量，过滤口径可迭代不用重抓。
