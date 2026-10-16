# 迭代日志（dsh 会话断点文档）

> 约定：每个会话/回合把进度落到这里，重启后按文件接上，不依赖会话上下文。

## 2026-10-12 · 第八轮：卡片栅格 → 扁平行列表（照 momoyu.cc 的列表样式）

用户要求（原话）："设计扁平一点，参考一下 momoyu 的，列表样式啊。"
对象是**面板里那一块**（每个面板顶部原先是三列描边圆角卡片栅格，前 10 名）。
四个决定当场问了用户：

| 问题 | 用户选择 |
|---|---|
| 点一行做什么 | **直接去来源**（`<a target="_blank">`），不再弹详情 |
| 显示多少行 | **20 行**（原 10） |
| 5 个拿不到行级链接的榜 | **行不可点**（纯展示，不假装可点） |
| 详情浮层 `<dialog>` | **一并删掉**（改完即无调用方） |
| 面板头两片筛选标签 | 保留，**收小去描边** |
| 行下的小标签行 | **保留**（与 momoyu 唯一有意的形态差异） |

### 做了什么

1. `trend.js`：`cardGrid()` → **`cardList()`**，产出 `<ul class="card-list">` + 每行
   `<li><a class="li">`（有地址）或 `<li><span class="li">`（无地址）。`cfg` 契约
   `{title,value,meta,link}` **一字未改**，19 处调用点原样不动。
   - ★ **逐行判 link**，不是按榜判一次：`orApps` 给的是 `link: (r) => r.url`，个别行
     url 为空 —— 按榜判会产出 `<a href="">`，一点跳回本页。
   - ★ **`esc(href)`**：地址现在进的是**属性位**（以前只经 `openDetail` 的文案），
     上游原始 URL 带 `"` 就能闭合属性插标签。
   - 删 `openDetail` / `detailRow` / `detailFromCols` 与 `[data-card]` 点击绑定；
     `site.css` 的 `.detail*` 一段同步删。
2. `mountBoard`：列表 10 → **20 行**；顺手理清三个互相矛盾的计数（见下"踩到的坑"）。
3. `site.css`：**面板去描边**（`--surface` 与 `--bg` 差一档即分得开）、圆角改
   `--radius-panel: 20px`（与 `--radius` 10px 分家）、`.panel-head` 去分隔线；
   卡片段换成无框列表段；**每个面板头那两片筛选标签也去掉描边**（否则版面只剩这几个框）。
   新增 `--rank-1/2/3` **文字色** token（前三名数字染色，照 momoyu）。
4. `i18n.js`：删 `ui.close` / `ui.openSource` / `ui.top10`（最后一个是早就没调用方的死键）；
   `ui.moreInList` 改为"下面完整列表里还有 {n} 条"。

### 踩到的坑（值得记）

- **三个计数互相矛盾**：`swebench` 取数收了 89 条、`cfg.limit: 40` 只展示前 40，
  而折叠区标题原写 `rows.length` ⇒ 显示"完整列表（89 条）"、展开只有 40 行；
  说明行写 89 条；列表下方又说"还有 48 条"。改成**三个数各自取对**：
  总条数 / **表格真正显示的条数**（= `shown.length`，已切过 `cfg.limit`）/ 列表条数。
  现在 swebench 读作：说明行 89 条、折叠区（40 条）、下面还有 20 条。
- `--gold` 在亮色下压白底只有 **3.2:1**，当**文字**（名次数字）读不清 —— 所以
  `--rank-*` 另取更深的一档（亮色 `#b45309` / `#64748b` / `#92400e`，≥4.5:1）。
  同一个色值当背景填充行、当文字不行，这正是本站"两套主题各自取值"的理由。

### 验收（本地）

- [x] `npm test` 全绿（i18n 9 / ui 7 / trend **105** / ainews 16 / site 40）。
  新增 4 条列表断言：逐行 link 判空、`href` 属性转义、行内不套 `<a>`、
  以及一条**源码级门禁**（钉住 `openDetail`/`detailFromCols`/`data-card` 不再出现）。
  两条基于 `card-meta`/`card-value` 的旧断言按新类名（`li-meta`/`li-val`）保留 ——
  它们是 `cfg.meta` 缺省那次真实故障的回归测试，不能丢。
- [x] `npm run build` 通过；`grep` 确认 `web/ src/ scripts/` 下无残留引用。
- [x] 无头实测（CDP）：暗/亮两套主题、`#panel-zhihu`（有链接）与 `#panel-swebench`
      （无链接）各截图。断言：面板与行的 `border` 均为 0、行背景透明、`r1` 染色
      （暗 `#f0b429` / 亮 `#b45309`）、行高 29px（桌面）/ 48px（390px 宽）、
      `#panel-zhihu` 20 行全是 `<a target=_blank rel=noopener noreferrer>`、
      `#panel-swebench` 20 行 `<a>` 计 0、`a a` 计 0、`dialog#detail` 计 0、
      390px 下横向溢出 0、9 个面板的计数行三者对得上。
- [x] `eval` 首次拉取撞上游限流（"第一页就没取到"）后重试成功 → 20 行正常（取数路径未动）。

### 已知、与本轮无关的一处数据缺陷

`assets/data/ai-news.json` 里有 14 处 HTML 实体以**字面量**存着
（`&#8217;` / `&#039;`，来自上游 RSS），页面渲染出字面量 "&#8217;" 而不是 `'`。
在 `5e84c3d` 就已存在（抓取脚本的实体还原表不全），本轮只改了展示层，**未动**它 ——
单独一轮修 `scripts/fetch-ai-news.mjs` 的实体还原更容易看清。
（另有一处同名旧账：GitHub Trending 的 `&#39;`，见第七轮 git 记录。）

### 未做（留给下一轮）

- [ ] 推送上线 + 线上实测 + 微信交付。
- [ ] 上面那处 RSS 实体字面量的抓取脚本修复。

## 2026-10-12 · 第七轮：改成单页站（首页装下全部 34 个面板，没有二级页面）

用户要求（原话）："页面扁平设计，不用点击二级页面。" 三个范围问题当场确认：

| 问题 | 用户选择 |
|---|---|
| 扁平到哪一步 | **首页装下全部，首页带标签过滤，标签小一点**（删 34 个榜单页 + 两个标签页） |
| 取数时机 | **滚动到才加载** |
| 怎么找榜/逛 | **粘性索引条 + 主题六类分组** |

第六轮"保留一张卡一个面板入口"的结构这一轮被推翻；第六轮的**视觉**（暗色默认、
momoyu 取色、13 个来源色）保留不动。

### 做了什么

1. **`trend.js` 扁平化**（主体）：
   - 主题分段：新增 `rootFor(id)` —— 面板挂进 `#topic-<主题> [data-panels]`，
     `attachPanel` 的"同 id 原地替换"因此是在**段内**生效（切子榜不跳段）。
   - 骨架复用：新增 `ensurePanel(meta)`（幂等）+ `shellMeta(id)`。启动时先同步建
     34 个骨架（零网络），loader 复用同一元素 —— 于是 34 处 `panel({…})` 改成
     `ensurePanel(...)`（字面替换）。
   - 懒加载：`observePending`（IntersectionObserver，`rootMargin: 600px`），
     命中即 observe→startLoader；不支持 IO 时退化成全部加载。
   - 标题层级：`SINGLE_BOARD ? 'h1' : 'h3'`（页面 h1 = 站点名、主题段 h2）。
   - 筛选总线：`boardVisible(id, filter)`（纯函数，已导出）+ `applyFilter` +
     `wireFilters`（绑 **document**，见下"踩到的坑"）。
   - 大表格延后：`mountBoard` 的完整表放进 `.table-slot[data-deferred]`，
     `details` 首次展开才建（`eval` 是 4576 行 × 9 列）；搜索加 120ms 防抖。
   - 深链接 `#panel-<id>`：`startAll` 读到就立刻 `startLoader`，不等滚动。
2. **`boards.js`**：新增 `BOARD_ICONS`（头像真值，从 `src/site/nav.js` 搬来 ——
   浏览器要它建骨架）与 `BOARD_ORDER`（按主题分段的排列，推导而非手写）。
3. **`src/site/nav.js`**：删 `renderTagsPage`/`renderTagPage`/`tagCard`/
   `tagKindSection`（标签页没了）；`renderNav` 去掉「标签」项（页头两样）；
   新增 `renderIndex`（吸顶索引条）+ `renderTopics`（六个主题段骨架）。
   删掉 34×2 的 `BOARD_TITLES` 手抄表 —— 面板名改从 `i18n.js` 的 `p.<id>.title` 取，
   整个仓库只剩一份。`BOARD_ICONS` 也改为引 `boards.js`。
4. **`i18n.js`**：`tagChips()` 由 `<a href="tag.html?t=…">` 改成
   `<button data-tag-filter="…">`（就地筛选，不跳页；也天然躲开 `<a>` 套 `<a>`）。
5. **构建/删除**：`SITE_FILES` 从 ~86 项缩到 11 项；删 34×2 个榜单页、四个标签页、
   `assets/tags.js`、两个孤儿 `momoyu.html`。
6. **`site.css`**：面板容器改 `#panels > .topic > .topic-grid`；新增索引条
   （吸顶 `top: 52px`）与主题段样式；删 `.entry-grid`/`.board-links`/整套标签页样式；
   `.panel-head :is(h1, h2, h3)`；13 个来源色选择器改指 `.idx-jump[data-jump]`。
7. **测试**：`site.test.js` 从"逐页扫描"改成"单页门禁"（发布集合恰两页、
   六个主题段都在、索引条 6+34 片、恰一个 h1、头像都有图标、旧页面删净）；
   `trend.test.js` 新增 BOARD_ORDER 完备性/分段连续/头像可渲染/懒加载源码级/
   `boardVisible` 真值表/`wireOnce` 只绑一次。`trend.test.js:855` 那条源码门禁
   同步成 `attachPanel(rootFor(id), el, id)`。

### 踩到的坑（两个，都是"页面上看不出来"的那类）

1. **索引条是 `#panels` 的兄弟**，不是子节点。筛选委托一开始绑在 `panelsRoot` 上，
   于是点索引条的主题/来源片**毫无反应**（面板头里的标签片倒是能）。
   由一段临时 DOM 探针（点一下再把 `visible/hidden` 写进 `title`）照出来的 ——
   改成绑 `document`。
2. **`{{SITE_NAV}}` 也出现在 `site.css` 的注释里**，而构建对**每个**发布文件都跑
   `injectNav` —— 于是那段导航 HTML 被塞进 CSS 的一条注释里（产物看着像损坏的 CSS）。
   这个隐患在第六轮就存在（那时 CSS 里也写着这个 token），只是没看产物。
   本轮把占位符替换**收口到 HTML**，并把注释里的字面量改掉。另：`index.html` 注释里
   写出的 `{{BOARD_INDEX}}` 同样被撑开（索引条出现两次）—— 一并改掉。

### 验证

`npm test` 全绿（i18n 9 / ui 7 / trend 103 / ainews 16 / site 40 = 175 条），
`npm run build` 通过（dist 11 个文件）。无头实测（本机 3.5G，一次一条 chrome）：

- **懒加载**（1200×900 视口）：34 个骨架都在，只有 `models` 段前 4 个拉了数据
  （10 张卡/个），其余 30 个仍是 `加载中…` 骨架 —— 证实"没滚到就不拉"。
  （★ 第八轮起同一处显示 **20 行**，且不再有 "卡" 这种形态 —— 本行是当轮的记录，不改写。）
- **深链接** `#panel-zhihu`：zhihu/csdn 立刻有数据（各 10 卡），仍未全量加载。
- **大表延后**：`#panel-swebench` 渲染出 10 张卡但 `<tr>` 为 0（表在收起的折叠区里）。
- **筛选**（DOM 探针）：点「中文热榜」→ 可见 13、隐藏 5 个主题段、`aria-pressed=true`；
  点「全部」→ 回到 34；点来源 `huggingface` → 可见 7，再点一次 → 34；
  先筛选再点跳转 → 清筛选并跳 `#panel-swebench`。
- **暗/亮 + 移动端**（390px）：截图确认索引条四行、主题分段、卡片栅格都正常，
  页面无横向溢出（只有刻意横向滚动的那两条索引行超宽）。
- **旧地址 404**：本地服务下 `trending.html` 返回 404（站点已无二级页）。

### 待办

- [ ] **推送 + 线上实测**：本轮尚未推送。推送后需复核 `index.html` / `en/index.html`
      200 且有数据、旧地址（`trending.html`）404。
- [ ] 快照每日刷新工作流仍未推送（第五/六轮就欠着，需带 workflow 权限的凭据）。
- [ ] 想更激进的话：把 `models`（含 4.8MB 的 newmodels）与 `benchmarks`（含 4MB 的
      swebench）排到主题顺序后面，让首屏更轻 —— 本轮没做，`rootMargin 600px`
      已经让"一屏内"只加载 `models` 段的 4 个。

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

## 2026-10-16 · 第六轮：主题切换按钮（三态）+ 三张新数据榜（34 → 37）

用户："你继续迭代，加入更多趋势数据，给页面加一个主题切换的按钮"。

### ① 主题切换按钮（把 2026-09-23 删掉的那个加回来）

- 三态 **跟随系统 → 亮 → 暗 → 跟随系统**，页头一个按钮，摆在语言切换左边。
- 删掉的原因（"只跟随系统就不用 head 里的内联脚本，也就没有先白后黑的闪烁"）
  本身没错，但它把**配色跟随系统**（好）与**读者不能自己选**（代价）绑在了一起 ——
  暗色成了默认之后，系统偏亮的读者进来看到一整页深色而无法可改。现在把选择权
  还给读者，同时**保住不闪**：内联脚本仍在 head、仍在样式表**之前**、仍非 module。
- ★ **"手动暗"没有新增任何 CSS 规则**：`:root` 本来就是暗色，"手动暗"要做的只是
  阻止 `prefers-color-scheme` 那条媒体查询接管，而 `:root:not([data-theme])`
  已经做到了。少写一条 `:root[data-theme='dark']` 就少一份会漂移的第二真值。
- 新增 `assets/theme.js`（状态/循环/按钮接线 + `bootSnippet()`）、
  `src/site/theme-boot.js`（构建期落内联脚本的占位符注入）、
  `assets/theme.test.js`（12 条）；`site.test.js` 加 5 条**对着发布物**的断言
  （引导脚本在样式表之前 / 不是 module / 页头有那个 button / 模块被发布 /
  按钮文案本地化）—— 这几处错了页面上只是"闪一下"，本地构建与测试全看不出。
- 无头实测 18/18（中英各 9）：跟随系统两态、三态循环、选择被记住、
  加载早期 `data-theme` 已就位；截图确认页头与窄屏观感。

### ② 三张新榜（先实测再决定，用户多选确认）

| 新面板 | id | 源 | CORS 实测 | 上线方式 |
|---|---|---|---|---|
| Hacker News 首页 | `hnTop` | `hn.algolia.com …tags=front_page` | ✅ 通 | **快照**（不是为绕 CORS —— 一次构建期请求对 Algolia 最友好、标注一致；改直连只需删快照） |
| 维基百科 AI 词条关注度 | `wikiAttention` | `wikimedia …/pageviews` | `*` 但**要 UA** | **快照**（`User-Agent` 是浏览器的 forbidden header，无 UA 实测 403 → 浏览器这条路是死的） |
| Google 搜索趋势 | `googleTrends` | `trends.google.com/trending/rss` | ❌ 无 | **快照** |

三张都是**站内此前没有的维度**：`hnTop` 是"技术社区此刻在顶什么"（与 aiNews 里
那个按 AI 关键词搜的 HN 源不同口径）、`wikiAttention` 是**全站唯一的大众注意力**
口径（不是技术圈热度）、`googleTrends` 是**搜索引擎注意力**。

- 三张各配抓取脚本（`snap:hn` / `snap:wiki` / `snap:trends`，另加 `snap:all`）：
  逐源/逐区域回退，全失败才非零退出不写文件；部分成功如实记 `skipped` 并显示在页面。
- ★ 三处实测坑都处理了并各有测试钉住：HN 自帖 `url` 为 null → 回落讨论页
  （否则是"看着能点、点了跳回本页"的空链接）；维基的 AI 判据撞到三类误报
  （法国歌手 Claude Nougaro、五月风暴 Mai 68、俄文形容词 Искусственный +
  "AI 词根在逗号之后的限定从句里"）→ 词根只匹配第一个逗号之前 + 精确排除表 +
  每语种白名单；Google 热度是 `2000+` 这种**粗粒度字符串** → 保留原文不解析成数字。
- 维基是 **8 语种**（只取英文会把非英语世界的注意力整块丢掉）、Google 是
  **10 个区域**可切；★ Google **没有中国大陆区域**（`geo=CN` 实测 400）——
  面板上写明了，读者找不到 CN 时有答案，而不是以为我们漏了。
- `newboards.test.js` 18 条（真实响应 fixture）。

### ③ 用户点名但**做不了**的（如实记，不硬上）

抖音 / 小红书 / 微信视频号 —— 无任何可用公开接口：抖音官方端点连接失败，
vvhan / tenapi / oioweb / cenguigui / xingzhige / 52vmy / pearktrue 等第三方聚合
全部"连接失败或返回 HTML 壳"，RSSHub 公共实例连不上。**没有数据通路，不是取舍**。
今日头条**站内已有**（13 个中文热榜里的 `toutiao`）；GitHub 新星榜也**已有**
（`repos` 面板的"本周"视图就是 `created:>7天前` 按星标排）。详见 docs §11-13 末节。

### 验证

- `npm test` 七组全绿（i18n 9 / ui 7 / theme 12 / trend 105 / ainews 16 /
  newboards 18 / site 45 = 212 条），`npm run build` 通过（15 个文件）。
- 无头实测：主题 18/18；三张新面板都渲染出真实数据（HN 20 行 / 维基 20 行 /
  Google 10 行），区域切换（US→HK→TW）、语种分组下拉（en 4 / zh 4 / ru 3 …）、
  中英双语页都跑通；截图确认暗/亮两套观感。
- [ ] 推送上线 + 线上实测（本轮尚未推 — `hnTop`/`wikiAttention`/`googleTrends`
      三份快照与 `hn-top.json` 等已入库，但**七份快照仍无每日 cron**
      （历史上 refresh-snapshots.yml 因 PAT 缺 workflow 权限一直没推上去），
      所以新老快照都会停在入库时刻）。
