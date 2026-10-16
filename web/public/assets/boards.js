/**
 * 面板 id —— **唯一来源**，发布集合、页头/页脚导航、测试都从它推导。
 *
 * ## 为什么放在 `assets/` 里（而不是 `src/site/`）
 * 这份清单有**四个**消费者，其中三个在 Node 下跑、一个在浏览器里跑：
 *
 *   · `assets/trend.js`（浏览器，ES module，`import` 它）；
 *   · `assets/site.test.js`（Node）要据此推出页面清单；
 *   · `scripts/build-site.mjs`（Node）要据此推出发布集合；
 *   · `src/site/nav.js`（构建期）要据此渲染页头。
 *
 * 浏览器那个是决定性的：**浏览器只能拿到发布集合里的文件**。它在这里，
 * `trend.js` 就能用 `./boards.js` 这个同级相对路径引到；而放在 `src/site/` 下时，
 * `trend.js` 里那句 `../../..` 的 import 在线上会解析成
 * `https://<域名>/src/site/boards.js` —— 一个不存在的地址，于是**整个模块
 * 加载失败**，页面上除了一片空白什么都没有（构建期与测试都看不出来，
 * 因为它们按文件路径 import，本地怎么跑都成功）。
 *
 * Node 那两个消费者隔着目录引 `assets/` 下的文件没有任何问题，方向相反则不成立，
 * 所以真值只能住在浏览器够得着的地方。
 *
 * 改 id = 改地址：`site.test.js` 有断言盯着"页面与 id 完全对齐"。
 */
export const BOARD_IDS = [
  'trending',
  'liked',
  'downloaded',
  'eval',
  'aider',
  'spaces',
  'datasets',
  'papers',
  'aiNews',
  'aiPress',
  'repos',
  'ghTrending',
  'zhihu',
  'csdn',
  'juejin',
  'itzhijia',
  'huxiu',
  'aifaner',
  'zhongguancun',
  'bilibili',
  'weibo',
  'toutiao',
  'hupu',
  'douban',
  'zhidemai',
  'newmodels',
  'openrouter',
  'orCatalog',
  'orTrends',
  'orAuthors',
  'orPerf',
  'aaBench',
  'orApps',
  'swebench',
  // ── 2026-10-16 新增三张榜 ──
  // 顺序即同主题段内的排列（`BOARD_ORDER` 段内沿用 `BOARD_IDS`）。
  // 都刻意放在各自主题段的**末尾**：它们是补充维度，不该把原有的榜挤下去
  // （读者已经熟悉的次序保持不变）。
  'hnTop',         // 资讯：HN 首页实况（与 aiNews 里那个 HN 源口径不同，见 trend.js）
  'wikiAttention', // 平台洞察：维基百科 AI 词条的大众关注度（唯一的大众注意力口径）
  'googleTrends',  // 平台洞察：Google 每日搜索趋势（按区域）
];

/**
 * 每个榜单的两个标签 —— **主题**（它是什么榜）与**来源**（数据从哪来）。
 *
 * ## 为什么标签住在**这个**文件里
 * 标签要出现在三个地方，而且三者必须一致：
 *   · 榜单页的面板头与页脚（`trend.js` 渲染，客户端）；
 *   · `tags.html` / `tag.html` 两个页面（**构建期**生成，`src/site/nav.js` 同一路数）；
 *   · 测试（Node）。
 * 与 `BOARD_IDS` 完全同一个理由：真值只能有一个地方，否则"网页上少了某个标签"
 * 这种错会静默发生 —— 页面上只是少一行，不报错。
 *
 * ## 两个字段，缺一不可
 *   · **topic**：这是**分类**。每个榜**恰好一个**，六类互不重叠 ——
 *     于是"点主题标签"就等于"看这一类"，过滤本身即分类。
 *     （旧的标签不是这样：`Models` 落在一半以上的榜上，点它几乎等于看全部。）
 *     `site.test.js` 有一条断言盯着"恰好一个、且是已知主题"。
 *   · **source**：数据从哪来。它同时是**可信度**信息 —— 榜的口径以来源方为准。
 *
 * ## 为什么值用 slug、不直接写显示文字
 * 标签值会进 URL（`tag.html?t=models`）。slug 两种语言共用，地址因此稳定、
 * 可收藏、可分享；**显示文字**则按页面语言从 `i18n.js` 的 `tag.<slug>` 取
 * （中文站「模型榜」，英文站 `Models`）。若把显示文字当值，地址就得跟着语言变，
 * `tag.html?t=模型榜` 这种地址在英文站上无解。判种类（主题 / 来源）见 `TAG_KINDS`。
 */
export const BOARD_TAGS = {
  // 模型榜 —— 模型本身的热度、人气、下载量、新发布、用量、目录
  trending: { topic: 'models', source: 'huggingface' },
  liked: { topic: 'models', source: 'huggingface' },
  downloaded: { topic: 'models', source: 'huggingface' },
  newmodels: { topic: 'models', source: 'models-dev' },
  openrouter: { topic: 'models', source: 'openrouter' },
  orCatalog: { topic: 'models', source: 'openrouter' },
  // 评测榜 —— 拿分数说话的榜（人工评测 / 真实代码任务）
  eval: { topic: 'benchmarks', source: 'huggingface' },
  aider: { topic: 'benchmarks', source: 'aider' },
  aaBench: { topic: 'benchmarks', source: 'artificial-analysis' },
  swebench: { topic: 'benchmarks', source: 'swe-bench' },
  // 社区生态 —— 模型之外，围绕它长出来的东西
  spaces: { topic: 'ecosystem', source: 'huggingface' },
  datasets: { topic: 'ecosystem', source: 'huggingface' },
  papers: { topic: 'ecosystem', source: 'huggingface' },
  repos: { topic: 'ecosystem', source: 'github' },
  ghTrending: { topic: 'ecosystem', source: 'github' },
  // 平台洞察 —— 在某一个平台上观察到的动向（用量、份额、性能、应用）
  orTrends: { topic: 'platform', source: 'openrouter' },
  orAuthors: { topic: 'platform', source: 'openrouter' },
  orPerf: { topic: 'platform', source: 'openrouter' },
  orApps: { topic: 'platform', source: 'openrouter' },
  // 资讯 —— 新闻快照。两张榜都是**多源聚合**（8 个聚合源 / 8 家一手信源），
  // 所以来源是"聚合源"，而不是某一家媒体。
  aiNews: { topic: 'news', source: 'aggregator' },
  aiPress: { topic: 'news', source: 'aggregator' },
  // HN 首页实况：单一来源（Hacker News 自己），所以来源就是它，
  // 不归到 'aggregator'（那是 aiNews/aiPress 那种多源拼盘的标签）
  hnTop: { topic: 'news', source: 'hackernews' },
  // 大众注意力两榜：来源是各自的平台本身
  wikiAttention: { topic: 'platform', source: 'wikipedia' },
  googleTrends: { topic: 'platform', source: 'google' },
  // 中文热榜 —— 13 个平台的热榜，来自同一份聚合快照，但**各算一个来源**
  // （这样"点微博"筛出的就是微博那一个榜，而不是 13 个一起出）
  zhihu: { topic: 'cn-hot', source: 'zhihu' },
  csdn: { topic: 'cn-hot', source: 'csdn' },
  juejin: { topic: 'cn-hot', source: 'juejin' },
  itzhijia: { topic: 'cn-hot', source: 'itzhijia' },
  huxiu: { topic: 'cn-hot', source: 'huxiu' },
  aifaner: { topic: 'cn-hot', source: 'aifaner' },
  zhongguancun: { topic: 'cn-hot', source: 'zhongguancun' },
  bilibili: { topic: 'cn-hot', source: 'bilibili' },
  weibo: { topic: 'cn-hot', source: 'weibo' },
  toutiao: { topic: 'cn-hot', source: 'toutiao' },
  hupu: { topic: 'cn-hot', source: 'hupu' },
  douban: { topic: 'cn-hot', source: 'douban' },
  zhidemai: { topic: 'cn-hot', source: 'zhidemai' },
};

/**
 * 主题分类 —— **顺序即显示顺序**（`tags.html` 的分组、`tag.html` 的排列都按它）。
 * 六类互不重叠，每个榜恰好落进一类：前四类是 AI 相关，后两类是资讯与中文热榜。
 */
export const TOPIC_SLUGS = ['models', 'benchmarks', 'ecosystem', 'platform', 'news', 'cn-hot'];

/**
 * 数据来源 —— 顺序即显示顺序：先是 AI 榜单的来源，再是 13 个中文热榜各自的平台
 * （它们来自同一份聚合快照，但各算一个来源 —— 这样"点微博"筛出的就是微博那一个榜）。
 * 与主题分开列，是为了让"按来源逛"与"按主题逛"是两条看得见的路。
 */
export const SOURCE_SLUGS = [
  'huggingface',
  'aider',
  'github',
  'models-dev',
  'openrouter',
  'artificial-analysis',
  'swe-bench',
  'aggregator',
  // HN 首页实况的来源（单一来源，与 'aggregator' 的多源拼盘区分开）
  'hackernews',
  // 大众注意力两榜的来源
  'wikipedia',
  'google',
  'zhihu',
  'csdn',
  'juejin',
  'itzhijia',
  'huxiu',
  'aifaner',
  'zhongguancun',
  'bilibili',
  'weibo',
  'toutiao',
  'hupu',
  'douban',
  'zhidemai',
];

/**
 * 全部标签 —— 主题在前、来源在后。顺序稳定，页面直接按它铺，
 * 不需要每次再排一遍，也不会因为 Map 迭代顺序的细枝末节而在两次构建间换位置。
 */
export const ALL_TAGS = [...TOPIC_SLUGS, ...SOURCE_SLUGS];

/** 每个标签属于哪一类 —— 由上面两个清单**推导**，不再手写第二份会漂移的真值。 */
export const TAG_KINDS = Object.fromEntries([
  ...TOPIC_SLUGS.map((slug) => [slug, 'topic']),
  ...SOURCE_SLUGS.map((slug) => [slug, 'source']),
]);

/** 某一类下的标签，顺序沿用 `ALL_TAGS`（保证页面上的排列稳定） */
export function tagsOfKind(kind) {
  return ALL_TAGS.filter((tag) => (TAG_KINDS[tag] || 'topic') === kind);
}

/** 某个标签下的榜单 id（按 `BOARD_IDS` 的顺序，保证页面上的排列稳定） */
export function boardsWithTag(tag) {
  return BOARD_IDS.filter((id) => {
    const t = BOARD_TAGS[id];
    return !!t && (t.topic === tag || t.source === tag);
  });
}

/**
 * 某个榜单自己的标签 —— **主题在前、来源在后**（卡片上就按这个顺序显示）。
 * 是 `boardsWithTag` 的逆运算，供 `trend.js` 在面板头/页脚渲染标签片。
 */
export function tagsOfBoard(id) {
  const t = BOARD_TAGS[id];
  return t ? [t.topic, t.source] : [];
}

/**
 * 面板图标 —— 与 `assets/ui.js` 的内联 SVG 图标表同源（值就是 `ICONS` 的键）。
 *
 * ## 为什么住在**这里**（而不是继续留在 `src/site/nav.js`）
 * 扁平站之后 `trend.js` 要在浏览器里**预建骨架**（每个面板的头像必须先在，
 * 懒加载的观察器才有东西可盯），而 `ui.js` 的 `icon()` 在遇到未登记的图标名时
 * 会**直接抛错**（见 `ui.js`）。头像名因此成了"面板渲染会不会炸"的真值。
 * 真值只能有一处：以前它在 `src/site/nav.js`（构建期），浏览器够不着，
 * 于是它在那儿另存了一份 `BOARD_ICONS` 供标签页用 —— 两份迟早会漂移
 * （改一头像只改一边 → 某面板上线成"未知图标：xxx"）。搬到这里之后
 * `nav.js` 隔着目录引同一份，不再有第二份。
 *
 * 加面板时这里必须补一条：漏了会静默回落到 `'box'`（骨架不炸，但头像不对）。
 */
export const BOARD_ICONS = {
  trending: 'trending',
  liked: 'heart',
  downloaded: 'download',
  eval: 'trophy',
  aider: 'code',
  spaces: 'cube',
  datasets: 'layers',
  papers: 'file',
  aiNews: 'file',
  aiPress: 'file',
  repos: 'star',
  ghTrending: 'trending',
  zhihu: 'file',
  csdn: 'code',
  juejin: 'code',
  itzhijia: 'monitor',
  huxiu: 'file',
  aifaner: 'monitor',
  zhongguancun: 'monitor',
  bilibili: 'monitor',
  weibo: 'trending',
  toutiao: 'trending',
  hupu: 'trending',
  douban: 'star',
  zhidemai: 'star',
  newmodels: 'box',
  openrouter: 'bolt',
  orCatalog: 'database',
  orTrends: 'trending',
  orAuthors: 'database',
  orPerf: 'bolt',
  aaBench: 'trophy',
  orApps: 'cube',
  swebench: 'code',
  // 2026-10-16 新增三张榜。★ 漏登记会**静默**回落到 'box'（骨架不炸、头像不对），
  // 所以这三个都挑了语义明确的图标：
  //   hnTop        —— trending（首页排名，与 weibo/toutiao 那种热榜同形）
  //   wikiAttention—— file（百科条目；与 papers/aiNews 同一个"文档"语义）
  //   googleTrends —— trending（搜索趋势，同上）
  // 刻意**不用** 'globe'：那个是语言切换专用的（页头那个链接），
  // 复用到面板头像上会让"地球"这个符号同时指两件事。
  hnTop: 'trending',
  wikiAttention: 'file',
  googleTrends: 'trending',
};

/**
 * 面板在页面上的**排列顺序** —— 按主题六类分段（`TOPIC_SLUGS` 的顺序），
 * 段内沿用 `BOARD_IDS` 的顺序。扁平站的骨架按它铺，于是"同一类的榜挨在一起"，
 * 而 `BOARD_IDS` 本身不必为了排版而重排（它同时是别的消费者眼里的稳定清单）。
 *
 * 是**推导**出来的，不是手写第二份：`BOARD_IDS` 加一个 id、`BOARD_TAGS` 给它
 * 一个主题，它就自动出现在该主题段里（`site.test.js` 有一条断言盯着
 * "每个 id 恰好出现一次"）。
 */
export const BOARD_ORDER = TOPIC_SLUGS.flatMap((topic) => boardsWithTag(topic));
