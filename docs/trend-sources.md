# 趋势数据源：实测可用性

> 站点的一切榜单数据都由**访客的浏览器直接向上游接口**请求。
> aibox 版本这里还写着一句"服务端不转发、不缓存"—— 本站（GitHub Pages）**根本没有服务端**，
> 所以这句话现在是纯粹的静态托管事实，而不是一条设计取舍。
>
> 因此每个源能否用，**只由上游的 CORS 策略决定** —— 没有 CORS 头，浏览器就会拦掉响应，
> 无论我们的代码怎么写。
>
> 本文记录每个源的**实测结论与原始命令**。这类"当时是怎么确认的"信息最容易丢，
> 而丢了之后下一个人会重新踩一遍。核对日期：**2026-09-23**（全部为当日实测）。
> ★ 这一版把站点从 Vercel 搬到 GitHub Pages 时，**没有重新实测**（搬迁只改托管方式，
> 不碰数据源）；下表是 aibox 那次的原始结论，重新体检请跑 `npm run test:live`。

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
| 最新发布的模型 | `models.dev/api.json` | 200 JSON | `*` | ✅ 可直连，**4.8MB / 8080 个模型 → 点击才加载** |
| SWE-bench | `raw.githubusercontent.com/swe-bench/swe-bench.github.io/master/data/leaderboards.json` | 200 JSON | `*` | ✅ 可直连，**4MB → 点击才加载** |
| ❌ LMArena 官方榜 | 无可用的公开 JSON；`lmarena.ai/*` | — | **无** | ❌ **做不了**（见 §3） |
| ❌ OpenRouter 排名 | `openrouter.ai/api/v1/models` | 200 JSON | `*` | ⚠️ 能取，但**没有排名数据**（见 §4） |
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
  文件里带**逐题明细**的长数组，所以体积大 → 与 models.dev 一样做成**点击才加载**。
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

## 4. OpenRouter 能取但没有排名

`openrouter.ai/api/v1/models` 有 CORS `*`、746KB、454 个模型，含 `pricing`（prompt/completion
单价）、`context_length`、`architecture.modality`。但：

- 响应里**没有任何排名/用量字段**（字段全表见下）；
- `?order=top-weekly` 与 `?order=throughput-high-to-low` 返回的**首条完全一样**
  （都是 `cohere/command-a-plus`）—— 排序参数被忽略，实际是按内部 id 排的。

字段（实测）：`id, canonical_slug, huggingface_face_id, name, created, description,
context_length, architecture, pricing, top_provider, per_request_limits,
supported_parameters, default_parameters, supported_voices, knowledge_cutoff,
expiration_date, links, reasoning`。其中的 `links` 可能含它站点上的排序页链接，但那是**别的页面**，
不是 API 的排名数据。

**结论**：OpenRouter 可以做一个"模型库 + 定价"面板（有价值，但不是"榜"）。
owner 本轮未选，先不做。

---

## 5. 实测耗时（2026-09-23，`npm run test:live` 原始输出）

```
✅ HF 趋势模型     200 · 27KB · 698ms · CORS: https://<站点域名>
✅ HF 最受喜欢     200 · 25KB · 343ms · CORS: https://<站点域名>
✅ HF 下载最多     200 · 28KB · 334ms · CORS: https://<站点域名>
✅ Aider 编程榜    200 · 45KB · 408ms · CORS: *
✅ 评测榜 全量     4576 行 / 46 页 · 4576 行到手 · 0 页失败 · 7.8s
   └ 可解析 4576 行 / 4497 个模型；榜首 MaziyarPanahi/calme-3.2-instruct-78b (平均 52.1)
```

即访客首次打开 `/trend.html`（无缓存）大约需要 **8 秒左右**才把评测榜填满，
其余四个面板在 **1 秒内**就上屏（面板各自独立渲染，谁快谁先出）。
第二次打开走 `sessionStorage` 缓存，全部即时。

---

## 6. 失败时的表现（刻意如此）

每个面板**独立**取数、独立渲染、独立报错：

- 某个源没有 CORS 或挂掉 → **只有那个面板**显示"读取失败：<具体错误>"，其余照常；
- 评测榜部分页失败 → 显示"N 个模型 · 覆盖 M 页（K 页失败，结果可能不完整）"，
  **不假装完整**；
- Aider 榜的 YAML 若被上游改成超出最小子集的写法 → 明确报"上游改了写法，本面板需同步"，
  **绝不猜一个错值**（有测试盯着这条：`web/public/assets/trend.test.js`）。

这是本项目的既有取向：**宁可不显示，也不静默出错值**。
