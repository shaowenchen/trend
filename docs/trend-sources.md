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

还试过但**不可用**的两条捷径：

- `datasets-server` 的 `/orderby` 端点 → **404 Not Found**；
- `/filter?where="Average ⬆️">60` → **500 `the dataset index is loading`**
  （这个数据集 2025-03 后已归档，索引起不来）。

**因此实现是**：并发分批（每批 8 个）拉完 46 页，合并后按平均分降序（`web/public/assets/trend.js`
的 `fetchAllEvalPages`）。实测耗时见 §5。结果缓存进 `sessionStorage`，TTL 10 分钟 ——
否则每次进页面都要重新拉 46 次。

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
