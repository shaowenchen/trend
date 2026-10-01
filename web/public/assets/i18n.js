/**
 * 双语字典 —— **所有面向访客的文案只有这一处来源**。
 *
 * ## 为什么不用"中英文字符串散在页面里 + 一个开关"
 * 页面骨架是**手写静态文件**（`web/public/*.html`），面板文案则全部由客户端
 * （`trend.js`）渲染。如果各自留一份文案，英文站点上线后必然出现
 * "英文页头 + 中文面板"这种半截状态，而且两边会越改越不一致。
 * 所以面板文案一律从这里取，页面骨架里的固定文案由人工保持双语一致。
 *
 * ## 为什么英文是独立目录（/en/）而不是页面上一个切换按钮
 * 前端切换只有一个 URL，搜索引擎只能收录一种语言，英文长尾流量拿不到。
 * 独立 URL 才能让两种语言各自被收录，也才能用 hreflang 明确声明
 * "这两个地址是同一页的两种语言"（避免被判成重复内容）。
 * 参数命名也用 `?lang=en` 这种形式**不做** —— 那会被当成同一个页面的参数版本。
 *
 * ## 页面骨架的文案为什么不进字典
 * 本站没有服务端，页面骨架的文案**直接写在各自的页面文件里**（两种语言的文案
 * 各写各的，不会把两种语言都塞进同一页再靠 CSS 藏）。字典这里只保留
 * **客户端要用的**键。
 *
 * ## 约定
 * - 键用点号分层；两种语言的键**必须完全一致**，缺键会在测试里直接报错。
 * - 中文是"原文"，英文是译文；两边都是给**访客**看的，注释不进字典。
 * - 这里的字符串**不含 HTML**。需要插值的用 `{name}` 占位，由 `t()` 替换。
 */

export const LOCALES = ['zh', 'en'];
export const DEFAULT_LOCALE = 'zh';

/**
 * ★ 关于 hreflang：本站**没有** hreflang（以及 canonical / og:url），
 * 这是有意去掉的，不是漏了：
 *
 *   这些标记里的地址**必须是绝对 URL**，而绝对地址只能来自"部署在哪里"。
 *   本站是纯静态、路径全用相对（见 README「为什么全是相对路径」），
 *   没有任何地方知道站点挂在 `https://<用户名>.github.io/<仓库>/`
 *   还是自定义域名的根下 —— 写死一个就等于把站点钉死在一个地址上。
 *
 * 代价是明确的：两个语言版本之间**没有**对搜索引擎的互译声明，
 * 内容结构相近的中英两页有可能被当成重复内容。换来的是"换个地址部署不用改代码"。
 * 要接回来的话，正确做法是构建时读一个 `SITE_URL` 环境变量再注入，
 * 而不是把域名写进代码。
 */

const zh = {
  // ── 首屏动作区的状态文案（按钮本身写在页面骨架里）──
  'hero.refreshing': '重新拉取中…',
  'hero.refreshed': '已更新',

  // ── 面板标题 ──
  'p.trending.title': '正在流行的模型',
  'p.trending.hint': '按趋势分排序',
  'p.liked.title': '最受喜欢的模型',
  'p.liked.hint': '累计喜欢数',
  'p.downloaded.title': '下载最多的模型',
  'p.downloaded.hint': '累计下载数',
  'p.eval.title': '开源模型评测榜',
  'p.eval.hint': '取全部成绩后按平均分排序',
  'p.aider.title': '编程能力榜（Aider Polyglot）',
  'p.aider.hint': '同一模型取最高的通过率',
  'p.spaces.title': '正在流行的 AI 应用',
  'p.spaces.hint': '按趋势分排序',
  'p.datasets.title': '正在流行的数据集',
  'p.datasets.hint': '按趋势分排序',
  'p.papers.title': '每日论文热榜',
  'p.papers.hint': '按点赞数排序',
  'p.aiNews.title': 'AI 新闻热点',
  'p.aiNews.hint': '八个来源的每日聚合快照：HN · dev.to · TechCrunch · The Verge · Latent Space · Interconnects · arXiv · lobste.rs',
  'p.aiPress.title': 'AI 官方要闻',
  'p.aiPress.hint': '八家一手信源官方博客的聚合快照：OpenAI · TechCrunch · Ars Technica · GitHub Blog · DeepMind · 微软研究院 · NVIDIA',
  'p.repos.title': '高星 AI 开源项目',
  'p.repos.hint': '按本期新增星标排序',
  'p.momoyu.title': '摸摸鱼热榜',
  'p.momoyu.hint': 'momoyu.cc 聚合的 13 个热榜（知乎 · 微博 · 豆瓣 · 虎扑 · IT之家 …），构建期快照',
  'p.momoyu.ai': '仅 AI 相关',
  'p.momoyu.all': '全部',
  'p.ghTrending.title': 'GitHub Trending（AI 过滤）',
  'p.ghTrending.hint': 'github.com/trending 每日榜的构建期快照；默认只看 AI 相关，可切全部',
  'p.ghTrending.ai': '仅 AI 相关',
  'p.ghTrending.all': '全部仓库',
  'p.newmodels.title': '最新发布的模型',
  'p.newmodels.hint': '数据较大（约 4.8MB），进页面即加载',
  'p.openrouter.title': 'OpenRouter 模型用量榜',
  'p.openrouter.hint': '按 token 用量排序，日更；standard / batch / free 三种变体已合并',
  'p.orCatalog.title': 'OpenRouter 模型库',
  'p.orCatalog.hint': '全部可路由模型：价格、上下文、模态与上线时间，按上线时间排序',
  'p.orTrends.title': 'OpenRouter 上升榜',
  'p.orTrends.hint': '按周环比增幅排序（本周 vs 上周 token 用量）',
  'p.orTrends.climbing': '上升榜',
  'p.orTrends.breakouts': '突破榜',
  'p.orAuthors.title': 'OpenRouter 厂商份额',
  'p.orAuthors.hint': '各机构在 OpenRouter 上的 token 份额与周环比变化',
  'p.orPerf.title': 'OpenRouter 性能榜',
  'p.orPerf.hint': '各模型在 OpenRouter 上的实测中位延迟与吞吐（按 provider 取最优）',
  'p.orPerf.latency': '延迟',
  'p.orPerf.throughput': '吞吐',
  'p.aaBench.title': 'Artificial Analysis 评测榜',
  'p.aaBench.hint': '与 HuggingFace 评测榜**不同来源**，可并列对照',
  'p.aaBench.intelligence': '综合智能',
  'p.aaBench.coding': '编程',
  'p.aaBench.agentic': '智能体',
  'p.orApps.title': 'OpenRouter 应用榜',
  'p.orApps.hint': '哪些应用在烧 token（按 agent 应用归因），以及图像/视频/语音模型的用量',
  'p.orApps.day': '应用 · 本日',
  'p.orApps.week': '应用 · 本周',
  'p.orApps.image': '图像模型',
  'p.orApps.video': '视频模型',
  'p.orApps.audio': '语音模型',
  'p.swebench.title': 'SWE-bench（真实代码修复）',
  'p.swebench.hint': '数据较大（约 4MB），进页面即加载',

  // ── 列名 / 字段名 ──
  'col.rank': '#',
  'col.model': '模型',
  'col.app': '应用',
  'col.dataset': '数据集',
  'col.paper': '论文',
  'col.repo': '仓库',
  'col.task': '任务',
  'col.sdk': 'SDK',
  'col.lang': '语言',
  'col.org': '机构',
  'col.provider': '服务商',
  'col.date': '日期',
  'col.release': '发布日期',
  'col.submitted': '提交日期',
  'col.avg': '平均',
  'col.score': '解决率',
  'col.rate': '通过率',
  'col.params': '参数(B)',
  'col.context': '上下文',
  'col.priceIn': '输入价',
  'col.priceOut': '输出价',
  'col.cost': '成本',
  'col.votes': '点赞',
  'col.likes': '喜欢',
  'col.downloads': '下载',
  // OpenRouter 面板专用：它是唯一按 **token 用量**口径的榜
  'col.orTokens': 'Token 用量',
  'col.orShare': '占比',
  'col.orRequests': '请求数',
  'col.orGrowth': '周环比',
  'col.orWeekTokens': '本周 token',
  'col.orPrevWeek': '上周 token',
  'col.orLatency': '延迟',
  'col.orThroughput': '吞吐',
  'col.orReqCount': '请求数',
  'col.orProvider': '最快 provider',
  'col.stars': '总星标',
  'col.title': '标题',
  'col.source': '来源',
  'col.hot': '热度',
  'col.starsToday': '今日新增星',
  'col.desc': '描述',
  'col.modality': '模态',
  'col.gained': '本期新增',
  'col.trending': '趋势分',
  'col.totalStars': '历史总星标',
  'col.weekStars': '本周新增星标',
  'col.monthStars': '本月新增星标',

  // ── 交互控件 ──
  'ui.search': '搜索…',
  'ui.searchModels': '按模型名搜索…',
  // OpenRouter 面板：清单（/api/v1/models，464 个对话模型）覆盖不到的那部分
  // 用量行（音频/视频/embedding 等）拿不到显示名，只能显示 slug —— 标一下，
  // 免得读者以为那一行本来就是这么写的
  'ui.orSlugOnly': '无显示名',
  'ui.orImages': '张图像',
  'ui.orHours': '小时视频',
  'ui.orChars': '字符',
  'ui.searchApps': '按应用名搜索…',
  'ui.searchDatasets': '按数据集名搜索…',
  'ui.searchPapers': '按标题搜索…',
  'ui.searchModelsProviders': '按模型或服务商搜索…',
  'ui.searchModelsOrgs': '按模型或机构搜索…',
  'ui.searchRepos': '按仓库名或描述搜索…',
  'ui.searchNews': '按标题或来源搜索…',
  'ui.allSources': '全部来源',
  'ui.allGroups': '全部分组',
  'ui.allTasks': '全部任务',
  'ui.allSdks': '全部 SDK',
  'ui.allLangs': '全部语言',
  'ui.allOrgs': '全部机构',
  'ui.allProviders': '全部服务商',
  'ui.noData': '没有数据',
  'ui.loading': '加载中…',
  // 单面板页的页脚导航与刷新按钮（由 trend.js 生成，不写进页面骨架）
  'ui.boardNav': '切换面板',
  'ui.boardTags': '本页标签：',
  'ui.refresh': '刷新数据',
  'ui.close': '关闭',
  'ui.openSource': '打开原始页面',
  'ui.sortHint': '点击排序',
  'ui.free': '免费',

  // ── 列表与状态 ──
  'ui.count': '{n} 条',
  'ui.countFiltered': '{n} / {total} 条',
  'ui.fullList': '完整列表（{n} 条，可点列头排序）',
  'ui.moreInList': '还有 {n} 条在下面的完整列表里',
  'ui.top10': '前 {n}',
  'ui.cached': '已缓存 {n} 个 · 抓取于 {time}（10 分钟内不重复拉取）',
  'ui.loaded': '{n} 个',

  // ── 面板状态 ──
  'st.fetching': '正在拉取…',
  'st.fetchingPages': '正在按页拉取全量成绩（限速拉取，首次约需 30–60 秒）…',
  'st.progress': '已取 {got} 行 · {done}/{total} 页',
  'st.progressFailed': '已取 {got} 行 · {done}/{total} 页 · {failed} 页失败',
  'st.evalDone': '{n} 个模型 · 覆盖 {pages} 页 · 抓取于 {time}',
  'st.evalDonePartial': '{n} 个模型 · 覆盖 {pages} 页（{failed} 页失败，可能不完整）· 抓取于 {time}',
  // 上游整个读不动时回退旧快照的说明：如实标"这是什么时候抓的、有多少"，不装成新数据
  'st.evalStale': '本次没取到（{msg}）—— 显示 {time} 抓取的旧快照：{n} 个模型，可能不完整',
  'st.evalSnap': '快照 · 抓取于 {time}（数据源 2025-03 已归档，快照即最新全量）',
  'st.staleSnap': '本次没取到（{msg}）—— 显示 {time} 抓取的旧快照，可能已过时',
  'st.orCatDone': '抓取于 {time} · 数据近实时',
  'st.ghSnap': '构建期快照 · 抓取于 {time} · 来源 github.com/trending',
  'st.aiNewsSnap': '构建期快照 · 最老来源抓取于 {time}',
  'st.pressSkipped': '观察项：{names}',
  'st.momoyuSnap': '构建期快照 · 抓取于 {time} · 来源 momoyu.cc',
  'st.failed': '读取失败：{msg}',
  'st.bigDataHint': '点击下方按钮加载（该源数据较大，避免进页面就拉）',
  'st.loadingBig': '正在拉取 {size} 数据…',
  // OpenRouter 面板：数据每天更新，读者要能判断'这是哪一天的榜'
  'st.orWindow': '数据日期 {date} · {n} 个模型（standard/batch/free 已合并）',
  'st.orTotal': '{date} 全平台 token 用量 {total}',
  'st.loadSwe': '加载 SWE-bench 榜',
  'st.loadModels': '加载最新发布模型',
  'st.rateLimited': '（上游接口不可用、跨域被拦或限流）',
  'st.board': '{name} 子榜 · 同模型取最高分',
  'st.distinct': '同模型取最高分',

  // ── 错误 ──
  'err.notArray': '上游返回的不是数组',
  'err.noItems': '上游返回结构里没有 items',
  'err.noRows': '返回结构里没有 rows',
  'err.noBoard': '没有解析出任何有效成绩',
  'err.noModels': '没有解析出任何模型',
  'err.noPapers': '没有解析出任何论文',
  'err.noRepos': '没有解析出任何仓库',
  'err.noNews': '快照里没有解析出新闻',
  'err.noBoardRows': '子榜 {name} 里没有解析出成绩',
  'err.yamlSubset': '第 {line} 行超出最小 YAML 子集：{text}',
  'err.yamlNested': '第 {line} 行是嵌套映射（键 {key} 没有值），超出最小 YAML 子集',
  'err.yamlIndent': '第 {line} 行缩进过深（疑似嵌套映射），超出最小 YAML 子集',
  'err.yamlNotKV': '第 {line} 行不是 "键: 值"：{text}',
  'err.yamlChanged': '（上游改了写法，本面板需同步）',
  'err.evalFirst': '评测榜第一页就没取到，无法得知总页数（与其显示一个残榜，不如明说拿不到）',
  'err.noBoards': '返回结构里没有子榜',
  'st.dated': '共 {total} 条，其中 {dated} 条有发布日期',
  'st.ghLimit': '（GitHub 匿名搜索限流 10 次/分钟，等一分钟或换个网络再试）',
  'st.retry': '，可点下方按钮重试',
  'st.retryRefresh': '，可用页面底部的「刷新数据」重试',
  // ★ 上面这五个键原本**只被 trend.js 引用、字典里没有**：取到的是键名本身，
  //   也就是说线上错误提示曾经直接显示 "err.evalFirst" 这种字符串。
  //   翻译自检（两种语言键一致）抓不到它 —— 它俩"一致地都缺"。
  //   web/public/assets/site.test.js 里加了一条"每个被引用的键都存在"的断言，
  //   这类漏配以后会在本地暴露，而不是等到用户看见英文键名。
  'err.init': '面板初始化失败：{msg}',
  // ★ 这一条几乎总是**旧缓存**：页面按新代码发出去、脚本还是上一次构建的那份时，
  //   就会出现"页面指名了一个老脚本不认识的 panel"。所以先把这条最可能的原因写在前面，
  //   并给出**读者能自己做**的动作 —— 原来的措辞只对开发者有意义。
  'err.unknownBoard':
    '本页面指名了一个不存在的面板：{id}。\n（最可能是页面脚本是旧缓存 —— 刷新一下本页（Cmd/Ctrl+Shift+R）多半就好；若仍然如此，则是页面上的 data-board 写错、或面板 id 改过而白名单/导航没跟着改）',

  // ── 这一版删掉的键（留着注释是为了让"原文案去哪了"有答案）──
  // 曾有 site.* / nav.* / hero.title|sub|refresh|enter / home.* / footer.sources
  // 等键，它们只服务于**页面骨架**。本站的骨架是手写静态文件（没有构建期之外的
  // 注入层），所以这些键没有调用方，按"字典里不留死键"的既有规矩删掉。
};

const en = {
  // ── Hero action states (the button label itself lives in the page shell) ──
  'hero.refreshing': 'Refreshing…',
  'hero.refreshed': 'Updated',

  'p.trending.title': 'Trending models',
  'p.trending.hint': 'sorted by trending score',
  'p.liked.title': 'Most-liked models',
  'p.liked.hint': 'total likes',
  'p.downloaded.title': 'Most-downloaded models',
  'p.downloaded.hint': 'total downloads',
  'p.eval.title': 'Open-model evaluation board',
  'p.eval.hint': 'all raw scores fetched, then sorted by average',
  'p.aider.title': 'Coding ability (Aider Polyglot)',
  'p.aider.hint': 'best pass rate per model',
  'p.spaces.title': 'Trending AI apps',
  'p.spaces.hint': 'sorted by trending score',
  'p.datasets.title': 'Trending datasets',
  'p.datasets.hint': 'sorted by trending score',
  'p.papers.title': 'Daily paper leaderboard',
  'p.papers.hint': 'sorted by upvotes',
  'p.aiNews.title': 'AI news roundup',
  'p.aiNews.hint': 'Daily aggregate snapshot of 8 sources: HN · dev.to · TechCrunch · The Verge · Latent Space · Interconnects · arXiv · lobste.rs',
  'p.aiPress.title': 'AI official news',
  'p.aiPress.hint': 'Build-time snapshot of 8 first-party sources: OpenAI, TechCrunch, Ars Technica, GitHub Blog, DeepMind, Microsoft Research, NVIDIA',
  'p.repos.title': 'Top-starred AI projects',
  'p.repos.hint': 'sorted by stars gained in the period',
  'p.momoyu.title': 'Momoyu hot lists',
  'p.momoyu.hint': '13 aggregated hot lists from momoyu.cc (Zhihu · Weibo · Douban · Hupu · ITHome …), build-time snapshot',
  'p.momoyu.ai': 'AI only',
  'p.momoyu.all': 'All',
  'p.ghTrending.title': 'GitHub Trending (AI filter)',
  'p.ghTrending.hint': 'build-time snapshot of the daily github.com/trending list; AI-related by default, all repos optional',
  'p.ghTrending.ai': 'AI only',
  'p.ghTrending.all': 'All repos',
  'p.newmodels.title': 'Latest model releases',
  'p.newmodels.hint': 'large payload (~4.8MB), loads on page open',
  'p.openrouter.title': 'OpenRouter model usage',
  'p.openrouter.hint': 'ranked by token usage, updated daily; standard / batch / free variants merged',
  'p.orCatalog.title': 'OpenRouter model catalog',
  'p.orCatalog.hint': 'every routable model: pricing, context, modality and release date, newest first',
  'p.orTrends.title': 'OpenRouter fastest climbers',
  'p.orTrends.hint': 'ranked by week-over-week growth (this week vs last, in tokens)',
  'p.orTrends.climbing': 'Climbing',
  'p.orTrends.breakouts': 'Breakouts',
  'p.orAuthors.title': 'OpenRouter vendor share',
  'p.orAuthors.hint': 'each vendor\'s share of OpenRouter tokens, with week-over-week change',
  'p.orPerf.title': 'OpenRouter performance',
  'p.orPerf.hint': 'measured median latency and throughput per model (best provider)',
  'p.orPerf.latency': 'Latency',
  'p.orPerf.throughput': 'Throughput',
  'p.aaBench.title': 'Artificial Analysis benchmarks',
  'p.aaBench.hint': 'a **different source** from the HuggingFace board — compare the two side by side',
  'p.aaBench.intelligence': 'Intelligence',
  'p.aaBench.coding': 'Coding',
  'p.aaBench.agentic': 'Agentic',
  'p.orApps.title': 'OpenRouter app usage',
  'p.orApps.hint': 'which apps are burning tokens (attributed per agent app), plus image/video/speech models',
  'p.orApps.day': 'Apps · day',
  'p.orApps.week': 'Apps · week',
  'p.orApps.image': 'Image models',
  'p.orApps.video': 'Video models',
  'p.orApps.audio': 'Speech models',
  'p.swebench.title': 'SWE-bench (real code fixes)',
  'p.swebench.hint': 'large payload (~4MB), loads on page open',

  'col.rank': '#',
  'col.model': 'Model',
  'col.app': 'App',
  'col.dataset': 'Dataset',
  'col.paper': 'Paper',
  'col.repo': 'Repo',
  'col.task': 'Task',
  'col.sdk': 'SDK',
  'col.lang': 'Language',
  'col.org': 'Org',
  'col.provider': 'Provider',
  'col.date': 'Date',
  'col.release': 'Released',
  'col.submitted': 'Submitted',
  'col.avg': 'Average',
  'col.score': 'Resolved',
  'col.rate': 'Pass rate',
  'col.params': 'Params (B)',
  'col.context': 'Context',
  'col.priceIn': 'Input $',
  'col.priceOut': 'Output $',
  'col.cost': 'Cost',
  'col.votes': 'Upvotes',
  'col.likes': 'Likes',
  'col.downloads': 'Downloads',
  // OpenRouter board only: the one board measured in **tokens consumed**
  'col.orTokens': 'Tokens',
  'col.orShare': 'Share',
  'col.orRequests': 'Requests',
  'col.orGrowth': 'WoW change',
  'col.orWeekTokens': 'tokens this week',
  'col.orPrevWeek': 'tokens last week',
  'col.orLatency': 'Latency',
  'col.orThroughput': 'Throughput',
  'col.orReqCount': 'Requests',
  'col.orProvider': 'fastest provider',
  'col.stars': 'Stars',
  'col.title': 'Title',
  'col.source': 'Source',
  'col.hot': 'Score',
  'col.starsToday': 'Stars today',
  'col.desc': 'Description',
  'col.modality': 'Modality',
  'col.gained': 'Gained',
  'col.trending': 'Trending',
  'col.totalStars': 'Total stars',
  'col.weekStars': 'Stars this week',
  'col.monthStars': 'Stars this month',

  'ui.search': 'Search…',
  'ui.searchModels': 'Search models…',
  // OpenRouter board: usage rows the model catalogue (464 chat models) does not
  // cover — audio/video/embedding — have no display name, so they show a slug.
  'ui.orSlugOnly': 'slug only',
  'ui.orImages': 'images',
  'ui.orHours': 'video hours',
  'ui.orChars': 'characters',
  'ui.searchApps': 'Search apps…',
  'ui.searchDatasets': 'Search datasets…',
  'ui.searchPapers': 'Search titles…',
  'ui.searchModelsProviders': 'Search models or providers…',
  'ui.searchModelsOrgs': 'Search models or orgs…',
  'ui.searchRepos': 'Search repo name or description…',
  'ui.searchNews': 'Search headlines or sources…',
  'ui.allSources': 'All sources',
  'ui.allGroups': 'All groups',
  'ui.allTasks': 'All tasks',
  'ui.allSdks': 'All SDKs',
  'ui.allLangs': 'All languages',
  'ui.allOrgs': 'All orgs',
  'ui.allProviders': 'All providers',
  'ui.noData': 'No data',
  'ui.loading': 'Loading…',
  // Footer navigation and refresh button on single-board pages (built by trend.js)
  'ui.boardNav': 'Switch board',
  'ui.boardTags': 'Tags on this board:',
  'ui.refresh': 'Refresh',
  'ui.close': 'Close',
  'ui.openSource': 'Open original page',
  'ui.sortHint': 'Click to sort',
  'ui.free': 'Free',

  'ui.count': '{n} rows',
  'ui.countFiltered': '{n} / {total} rows',
  'ui.fullList': 'Full list ({n} rows, click a column to sort)',
  'ui.moreInList': '{n} more in the full list below',
  'ui.top10': 'Top {n}',
  'ui.cached': 'Cached {n} models · fetched {time} (no refetch for 10 minutes)',
  'ui.loaded': '{n} models',

  'st.fetching': 'Loading…',
  'st.fetchingPages': 'Fetching all scores page by page (rate-limited; first visit may take 30–60 s)…',
  'st.progress': '{got} rows · {done}/{total} pages',
  'st.progressFailed': '{got} rows · {done}/{total} pages · {failed} failed',
  'st.evalDone': '{n} models · {pages} pages · fetched {time}',
  'st.evalDonePartial': '{n} models · {pages} pages ({failed} failed, may be incomplete) · fetched {time}',
  // Shown when the upstream is unreachable and we fall back to the last snapshot
  'st.evalStale': 'Fetch failed ({msg}) — showing the snapshot fetched {time}: {n} models, may be incomplete',
  'st.evalSnap': 'Snapshot · fetched {time} (source archived 2025-03; this is the full list)',
  'st.staleSnap': 'Fetch failed ({msg}) — showing the snapshot fetched {time}, may be out of date',
  'st.orCatDone': 'fetched {time} · near real-time',
  'st.ghSnap': 'build-time snapshot · fetched {time} · source: github.com/trending',
  'st.aiNewsSnap': 'build-time snapshot · oldest source fetched {time}',
  'st.pressSkipped': 'watch list: {names}',
  'st.momoyuSnap': 'build-time snapshot · fetched {time} · source: momoyu.cc',
  'st.failed': 'Failed: {msg}',
  'st.bigDataHint': 'Click the button below to load (large payload — kept out of first paint)',
  'st.loadingBig': 'Fetching {size}…',
  // OpenRouter board: the data is daily, so the reader needs to know which day they see
  'st.orWindow': 'data for {date} · {n} models (standard/batch/free merged)',
  'st.orTotal': '{total} tokens across OpenRouter on {date}',
  'st.loadSwe': 'Load SWE-bench board',
  'st.loadModels': 'Load latest releases',
  'st.rateLimited': '(source unavailable, blocked by CORS, or rate-limited)',
  'st.board': '{name} board · best score per model',
  'st.distinct': 'best score per model',

  'err.notArray': 'Source did not return an array',
  'err.noItems': 'Source response has no items',
  'err.noRows': 'Response has no rows',
  'err.noBoard': 'No valid scores parsed',
  'err.noModels': 'No models parsed',
  'err.noPapers': 'No papers parsed',
  'err.noRepos': 'No repositories parsed',
  'err.noNews': 'No news items parsed from the snapshot',
  'err.noBoardRows': 'No scores parsed from the {name} board',
  'err.yamlSubset': 'Line {line} is outside the minimal YAML subset: {text}',
  'err.yamlNested': 'Line {line} is a nested mapping ({key} has no value), outside the minimal YAML subset',
  'err.yamlIndent': 'Line {line} is indented too deep (looks nested), outside the minimal YAML subset',
  'err.yamlNotKV': 'Line {line} is not "key: value": {text}',
  'err.yamlChanged': '(the source changed its format — this panel needs updating)',
  'err.evalFirst':
    'The first page of the evaluation board could not be fetched, so the total page count is unknown (better to say so than to show a truncated board).',
  'err.noBoards': 'Response has no sub-boards',
  'st.dated': '{dated} of {total} rows carry a release date',
  'st.ghLimit': '(GitHub anonymous search is limited to 10 req/min — wait a minute or switch network)',
  'st.retry': ', or click the button below to retry',
  'st.retryRefresh': ', or retry with the Refresh button at the bottom of the page',
  'err.init': 'Panel failed to initialise: {msg}',
  'err.unknownBoard':
    'This page names a board that does not exist: {id}.\n(Most likely the page script is a stale cache — a hard refresh (Cmd/Ctrl+Shift+R) usually fixes it. If not, the page\'s data-board is misspelled, or a board id changed without updating the whitelist and navigation.)',
};

export const DICT = { zh, en };

/**
 * 取一条文案，并替换 `{name}` 占位符。
 *
 * 缺键时**返回键名本身**（例如 `p.eval.title`）而不是空串或 undefined：
 * 空串会让页面上出现一个看不出问题的空标题，而键名一眼就知道是漏配。
 * 另外 `__tests__` 里有一条断言要求两种语言的键完全一致，正常不会走到这里。
 */
export function t(locale, key, vars = {}) {
  const dict = DICT[locale] || DICT[DEFAULT_LOCALE];
  const s = dict[key] ?? DICT[DEFAULT_LOCALE][key] ?? key;
  return String(s).replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? `{${k}}` : String(vars[k])));
}

/** 某个语言下的全部键（测试用来对齐两种语言） */
export function keysOf(locale) {
  return Object.keys(DICT[locale] || {});
}

/**
 * 一组标签的 HTML —— 首页卡片与榜单页共用，所以放在这里而不是各写一遍。
 *
 * 标签文字**不走字典**（见 `boards.js` 的说明：它们是专有名词与英文分类词，
 * 中英共用一份）；只有链接的目标前缀随语言变（中文页 `tag.html`、
 * 英文页 `../tag.html`），所以 `prefix` 由调用方按页面层级传。
 *
 * 为什么是链接而不是死文字：标签页的存在意义就是"点进去按类看"。
 * 少了这层链接，标签就只是装饰。
 */
export function tagChips(tags, prefix = '') {
  return (tags || [])
    .map(
      (tag) =>
        `<a class="tag-chip" href="${prefix}tag.html?t=${encodeURIComponent(tag)}">${escTag(tag)}</a>`
    )
    .join('');
}

/** 标签文本的转义（与 `trend.js` 的 `esc` 同样规则，独立一份免得循环依赖） */
function escTag(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
