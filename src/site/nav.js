/**
 * 页头导航 —— **构建期**生成，页面里写 `{{SITE_NAV}}`。
 *
 * ## 三样：左边「首页」+「标签」，右边切换语言
 * 十二个榜单**不进页头**：它们已经在首页的入口卡片里各占一张卡，页头再列一遍
 * 就是同一份目录的第二次出现 —— 而窄屏上 12 条要挤成下拉才放得下。
 * 「标签」是一条**入口**（进 tags 页按来源/分类逛），不是榜单清单。
 * 榜单页之间怎么互相走，见页面下部的 `.board-links`（`trend.js` 生成）。
 *
 * ## 为什么不写进每个页面文件（现在是 30 个）
 * 导航里有语言切换，它必须指向**对应的那一页**（`trending.html` ↔
 * `en/trending.html`，`tags.html` ↔ `en/tags.html`，而 `tag.html` 还要带上
 * 自己的 `?t=` 参数），也就是每个页面的地址都不一样。手写就是 30 份副本，
 * 而"抄 30 份"的失效方式是具体的：加一个面板时漏改几个页面，那几页的语言切换
 * 就把读者丢回首页，而不是留在原来的榜单上。
 *
 * ## 为什么在构建期而不是客户端（`assets/*.js`）
 *   · 与 `{{BRAND}}` / `{{GTM}}` 同一套机制，不新增一层；
 *   · **无 JS 也能用**：导航是页面骨架的一部分，而骨架本来就该在没有脚本时
 *     也可读（客户端渲染的导航在禁用 JS 时是整条消失）；
 *   · 链接是静态的相对路径，构建期就能被 `findMissingAssets` 校验 ——
 *     写错一个文件名，构建直接失败，而不是上线后 404。
 *
 * ## 语言与路径
 * 两种语言的页面在各自的目录里（`/` 与 `/en/`），所以同一份导航要落成两套
 * 相对路径：中文页的首页是 `index.html`，英文页是 `../index.html`。
 * 这正是 `lang` 参数的唯一作用。
 *
 * 页面骨架的文案不进 `i18n.js` 字典（那是给客户端用的，见该文件顶部说明），
 * 所以导航的文案在这里自带一份 —— 与页面里其它骨架文案是同样的处理方式。
 */

/** 占位符，由 `scripts/build-site.mjs` 替换。 */
export const NAV_PLACEHOLDER = '{{SITE_NAV}}';

/**
 * 骨架文案。**只有四个词**，且都是导航标签 —— 这就是"页面骨架文案不进字典"
 * 的代价里可接受的那一部分：面板名走字典，因为它们本来就是客户端渲染的
 * （`p.<id>.title`）。
 */
const NAV_TEXT = {
  zh: {
    home: '首页',
    tags: '标签',
    label: '站点导航',
    toggle: '切换语言：',
    switchTo: 'English',
  },
  en: {
    home: 'Home',
    tags: 'Tags',
    label: 'Site navigation',
    toggle: 'Switch language: ',
    switchTo: '中文',
  },
};

/** HTML 转义。文案都是本仓库里的常量，仍一律转义 —— 规则不该有例外。 */
export function escHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * 生成一个语言版本的页头导航：左侧首页 + 标签，右侧语言切换。
 *
 * 两段是 `header-inner` 的直接子元素，靠它的 `space-between` 各就各位 ——
 * 这样"左一个右一个"由布局负责，不需要在 CSS 里给语言切换写 `margin-left: auto`
 * 这类补丁。
 *
 * @param {'zh'|'en'} lang 本页面语言
 * @param {string} prefix 本页到站点根的相对前缀：中文页 `''`，英文页 `'../'`
 * @param {string|null} boardId 本页是哪个榜单；首页传 null
 * @param {{tags?: boolean, tag?: string}} [opts]
 *   `tags` 为真表示本页是 tags 页（那它自己的链接要带 `aria-current`）；
 *   `tag` 是 tag 页当前的标签（语言切换要把它带上，否则换语言会丢掉筛选）。
 */
export function renderNav(lang, prefix, boardId = null, { tags = false, tag = '' } = {}) {
  const text = NAV_TEXT[lang];

  // 语言切换：**指向对应的那一页**（`trending.html` ↔ `en/trending.html`），
  // 不是指向对方语言的首页 —— 换语言时读者应当留在原来的榜单上，
  // 而不是被丢回首页重新找一遍。首页之间则是目录语义（`en/` 与 `../`）。
  //
  // 它保持是 <a>：这是"另一个地址"，不是页内动作 —— 可收藏、可被搜索引擎
  // 跟随，面板页之间也正是靠它互指的（site.test.js 有断言盯着）。
  const other = lang === 'zh' ? 'en' : 'zh';
  const otherTag = other === 'en' ? 'en' : 'zh-CN';
  // 本页的种类决定"对方的哪一页"：榜单页 → 对方同名榜单页；tags 页 → 对方 tags 页；
  // tag 页 → 对方 tag 页**并带上同一个标签**（丢了这个参数就等于把筛选丢了）；
  // 首页 → 对方的根（目录语义，`en/` 与 `../`）。
  let otherHref;
  if (tags) otherHref = `${prefix}${other === 'en' ? 'en/' : ''}tags.html`;
  else if (boardId === 'tag') otherHref = `${prefix}${other === 'en' ? 'en/' : ''}tag.html?t=${encodeURIComponent(tag)}`;
  else if (boardId) otherHref = `${prefix}${other === 'en' ? 'en/' : ''}${boardId}.html`;
  else otherHref = other === 'en' ? `${prefix}en/` : `${prefix}`;

  // 本页是不是首页：是的话给首页链接带上 aria-current（读屏器会播报"当前页"）。
  // 首页链接本来就在"当前页"上时**不**加边框——它已经是页头唯一的左侧元素，
  // 再加框只会看起来像一颗按钮（见 site.css 的 .nav-home）。
  const homeCurrent = !boardId && !tags ? ' aria-current="page"' : '';

  return `<a class="nav-home" href="${prefix}index.html"${homeCurrent}>${escHtml(text.home)}</a>
    <nav class="site-nav" aria-label="${escHtml(text.label)}">
      <a class="nav-tags" href="${prefix}tags.html"${tags ? ' aria-current="page"' : ''}><span class="ic" data-icon="tag" aria-hidden="true"></span>${escHtml(text.tags)}</a>
      <a class="lang" href="${otherHref}" hreflang="${otherTag}" lang="${otherTag}"><span class="ic" data-icon="globe"><span class="sr-only">${escHtml(text.toggle)}</span></span>${escHtml(text.switchTo)}</a>
    </nav>`;
}

/** 把 `{{SITE_NAV}}` 落成真值。`lang`/`prefix`/`boardId` 由调用方按文件推导。 */
export function injectNav(html, lang, prefix, boardId, opts) {
  return String(html).split(NAV_PLACEHOLDER).join(renderNav(lang, prefix, boardId, opts));
}

/**
 * 标签与"某标签下有哪些榜单"的真值 —— 住在 `assets/boards.js`（浏览器侧也要用，
 * 见该文件顶部说明为什么它必须在发布目录里）。这里只是隔着目录引它。
 * 不再 `export` 转出去：那会让这个构建期模块多一层对外表面，而调用方
 * （构建脚本、测试）都能直接引 `boards.js`。
 */
import { ALL_TAGS, boardsWithTag, BOARD_TAGS, tagsOfKind } from '../../web/public/assets/boards.js';

/* ================================================================== */
/* 标签页                                                              */
/* ================================================================== */

/**
 * 标签页的正文 —— 同样是**构建期**生成，页面里写占位符。
 *
 * ## 为什么构建期而不是客户端
 * 与导航同一个理由，而且这里更重：榜单**卡片**（名字 + 说明 + 链接）是构建期
 * 就有的东西，标签页只是把它们按标签重组一遍。做成客户端渲染的话，
 * 一个"给爬虫看的分类页"在禁用 JS 时就什么都不剩了 —— 而分类页的价值恰恰在于
 * 让搜索引擎发现"这些榜是一类"。所以这里直接落成静态 HTML。
 *
 * ## 链接为什么是 `tag.html?t=<标签>`
 * 静态托管没有 rewrite（见 README），一个标签一个文件意味着**每加一个标签就要
 * 多发布两个页面**（中英各一），而标签是最容易随手加的东西。用查询参数则
 * 只多一个页面，筛选在运行期完成。代价是这些地址不进搜索引擎索引 —— 可接受，
 * 因为标签页的主要作用是**站内导航**，而不是拿排名。
 */
export const TAGS_PLACEHOLDER = '{{TAGS_PAGE}}';
export const TAG_PAGE_PLACEHOLDER = '{{TAG_PAGE}}';

/**
 * 面板名 —— 与 `i18n.js` 的 `p.<id>.title` 同源（这里构建期要，那边客户端要）。
 * 与标签同理：构建期需要一份，所以放在这里而不是去 import 客户端模块。
 */
const BOARD_TITLES = {
  zh: {
    trending: '正在流行的模型',
    liked: '最受喜欢的模型',
    downloaded: '下载最多的模型',
    eval: '开源模型评测榜',
    aider: '编程能力榜（Aider Polyglot）',
    spaces: '正在流行的 AI 应用',
    datasets: '正在流行的数据集',
    papers: '每日论文热榜',
    repos: '高星 AI 开源项目',
    ghTrending: 'GitHub Trending（AI 过滤）',
    newmodels: '最新发布的模型',
    openrouter: 'OpenRouter 模型用量榜',
    orCatalog: 'OpenRouter 模型库',
    orTrends: 'OpenRouter 上升榜',
    orAuthors: 'OpenRouter 厂商份额',
    orPerf: 'OpenRouter 性能榜',
    aaBench: 'Artificial Analysis 评测榜',
    orApps: 'OpenRouter 应用榜',
    swebench: 'SWE-bench（真实代码修复）',
  },
  en: {
    trending: 'Trending models',
    liked: 'Most-liked models',
    downloaded: 'Most-downloaded models',
    eval: 'Open-model evaluation board',
    aider: 'Coding ability (Aider Polyglot)',
    spaces: 'Trending AI apps',
    datasets: 'Trending datasets',
    papers: 'Daily paper leaderboard',
    repos: 'Top-starred AI projects',
    ghTrending: 'GitHub Trending (AI filter)',
    newmodels: 'Latest model releases',
    openrouter: 'OpenRouter model usage',
    orCatalog: 'OpenRouter model catalog',
    orTrends: 'OpenRouter fastest climbers',
    orAuthors: 'OpenRouter vendor share',
    orPerf: 'OpenRouter performance',
    aaBench: 'Artificial Analysis benchmarks',
    orApps: 'OpenRouter app usage',
    swebench: 'SWE-bench (real code fixes)',
  },
};

/** 卡片图标 —— 与 `i18n.js`/`boards.js` 无关，纯粹是"这一页长什么样" */
const BOARD_ICONS = {
  trending: 'trending',
  liked: 'heart',
  downloaded: 'download',
  eval: 'trophy',
  aider: 'code',
  spaces: 'cube',
  datasets: 'layers',
  papers: 'file',
  repos: 'star',
  ghTrending: 'trending',
  newmodels: 'box',
  openrouter: 'bolt',
  orCatalog: 'database',
  orTrends: 'trending',
  orAuthors: 'database',
  orPerf: 'bolt',
  aaBench: 'trophy',
  orApps: 'cube',
  swebench: 'code',
};

/** 标签页的骨架文案 */
const TAG_TEXT = {
  zh: {
    tagsTitle: '标签',
    // ★ 这一页**没有**说明句：标签卡自带数量与"包含哪些榜"的预览，
    //   "按来源或类别浏览"这种事由分组标题直接说明，再补一句就是废话。
    // tag.html 的标题分前后缀，脚本只往中间插标签值
    tagPrefix: '标签：',
    allTitle: '按标签浏览',
    // 分组标题（两类标签）
    sourceKind: '数据来源',
    topicKind: '榜单类别',
    // 卡片里的两行小字
    boardCount: '{n} 个榜单',
    noBoard: '暂无',
    allTags: '全部标签',
    back: '← 全部标签',
  },
  en: {
    tagsTitle: 'Tags',
    tagPrefix: 'Tag: ',
    allTitle: 'Browse by tag',
    sourceKind: 'Data sources',
    topicKind: 'Board topics',
    boardCount: '{n} boards',
    noBoard: 'none yet',
    allTags: 'All tags',
    back: '← All tags',
  },
};

const fill = (s, vars) =>
  String(s).replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? `{${k}}` : String(vars[k])));

/** 一张榜单卡片（与首页 `.entry` 同一套样式，所以长相一致） */
function boardCard(lang, prefix, id) {
  const title = BOARD_TITLES[lang][id] || id;
  return `<a class="entry" href="${prefix}${id}.html">
      <span class="ic" data-icon="${BOARD_ICONS[id] || 'box'}"></span>
      <span class="entry-body">
        <span class="entry-title">${escHtml(title)}</span>
        <span class="entry-desc">${escHtml((BOARD_TAGS[id] || []).join(' · '))}</span>
      </span>
      <span class="entry-go" aria-hidden="true">→</span>
    </a>`;
}

/**
 * `tags.html` 的正文：标签**卡片**，分两类摆。
 *
 * 每张卡给出三样读者要判断的东西：标签名、**多少个榜单**、以及**具体是哪些**
 * （名字连着列出来）。少了后两样，读者只能挨个点进去才知道是不是自己要找的 ——
 * 而"有多少、都是什么"正是这一页要回答的。
 *
 * 分组（数据来源 / 榜单类别）让人一眼看出"HuggingFace 是来源、Models 是类别"
 * 是两件不同的事，而不是一坨平铺的标签片。这一页**不写导语**：
 * 分组标题与卡片本身就把话说完了。
 */
function tagCard(lang, prefix, tag) {
  const text = TAG_TEXT[lang];
  const ids = boardsWithTag(tag);
  const names = ids.map((id) => BOARD_TITLES[lang][id] || id);
  return `<a class="tag-card" href="${prefix}tag.html?t=${encodeURIComponent(tag)}">
      <span class="tag-card-top">
        <span class="tag-card-name">${escHtml(tag)}</span>
        <span class="tag-card-count">${escHtml(fill(text.boardCount, { n: ids.length }))}</span>
      </span>
      <span class="tag-card-boards">${escHtml(names.join(' · '))}</span>
    </a>`;
}

/** 一类标签的一段（带小标题）。顺序固定：来源在前、类别在后 */
function tagKindSection(lang, prefix, kind) {
  const text = TAG_TEXT[lang];
  const tags = tagsOfKind(kind);
  if (!tags.length) return '';
  return `<section class="tag-section">
      <h2 class="tag-section-head">${escHtml(kind === 'source' ? text.sourceKind : text.topicKind)}</h2>
      <div class="tag-cards">
    ${tags.map((tag) => tagCard(lang, prefix, tag)).join('\n    ')}
      </div>
    </section>`;
}

export function renderTagsPage(lang, prefix) {
  const text = TAG_TEXT[lang];
  return `<h1>${escHtml(text.tagsTitle)}</h1>
    ${tagKindSection(lang, prefix, 'source')}
    ${tagKindSection(lang, prefix, 'topic')}`;
}

/**
 * `tag.html` 的正文：**把全部标签与全部榜单卡片都落成静态 HTML**，
 * 再由 `assets/tags.js`（一小段脚本）按地址里的 `?t=` 收窄成一组。
 *
 * ★ 两个刻意的选择，都是为了**没有 JS 时页面仍然可用**：
 *   1. 分组**不带 `hidden`** —— 禁用 JS 时脚本不会跑，默认"全部显示"，
 *      那正是"没指定标签"该有的样子。
 *   2. 全部标签都渲染出来，而不是只渲染当前标签那一组 —— 静态托管没有
 *      rewrite，做不到"一个标签一个文件"，所以只能一个页面装下全部。
 */
export function renderTagPage(lang, prefix) {
  const text = TAG_TEXT[lang];
  const groups = ALL_TAGS.map((tag) => {
    const ids = boardsWithTag(tag);
    return `<section class="tag-group" data-tag="${escHtml(tag)}">
      <h2 class="tag-group-head">${escHtml(tag)}<span class="tag-group-count">${escHtml(fill(text.boardCount, { n: ids.length }))}</span></h2>
      <div class="entry-grid">
    ${ids.map((id) => boardCard(lang, prefix, id)).join('\n    ')}
      </div>
    </section>`;
  }).join('\n    ');

  // 顶部的标签选择条：每个标签带条数，点它把页面收窄到那一组。
  // 顺序**按类**（来源在前、类别在后）而不是 ALL_TAGS 的"首次出现"顺序 ——
  // 后者会把 Aider 夹在 Models 与 Coding 之间，读起来像随手排的。
  const ordered = [...tagsOfKind('source'), ...tagsOfKind('topic')];
  const chips = ordered.map(
    (tag) =>
      `<a class="tag-chip" data-tag-link="${escHtml(tag)}" href="${prefix}tag.html?t=${encodeURIComponent(tag)}">` +
      `${escHtml(tag)}<span class="tag-chip-n">${boardsWithTag(tag).length}</span></a>`
  ).join('\n      ');

  return `<p><a class="muted" href="${prefix}tags.html">${escHtml(text.back)}</a></p>
  <!-- 没有 ?t= 时显示"按标签浏览"（下面默认全部展开）；脚本选中某个标签后
       会把它换成"标签：<那个标签>"。data-prefix 就是给脚本用的前缀，见 assets/tags.js。 -->
  <h1 id="tag-title" data-prefix="${escHtml(text.tagPrefix)}">${escHtml(text.allTitle)}</h1>
  <nav class="tag-grid" aria-label="${escHtml(text.allTags)}">
      ${chips}
  </nav>
  <div id="tag-boards">
    ${groups}
  </div>
  <script type="module" src="${prefix}assets/tags.js"></script>`;
}

/** 把两个占位符分别落成真值（幂等：页面里没有占位符就原样返回） */
export function injectTagsPage(html, lang, prefix) {
  return String(html).split(TAGS_PLACEHOLDER).join(renderTagsPage(lang, prefix));
}

export function injectTagPage(html, lang, prefix) {
  return String(html).split(TAG_PAGE_PLACEHOLDER).join(renderTagPage(lang, prefix));
}
