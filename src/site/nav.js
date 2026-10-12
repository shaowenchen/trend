/**
 * 页头导航与**首页的粘性索引条** —— 都是**构建期**生成，页面里写占位符。
 *
 * ## 页头只有两样：左边「首页」，右边切换语言
 * 榜单**不进页头**：扁平站之后全部 34 个面板都在首页上，页头再列一遍就是同一份
 * 目录的第二次出现。原来还有第三个「标签」入口 —— 它指向的 `tags.html` /
 * `tag.html` 两个页面已经删掉（标签改为就地筛选），所以这一项也没了。
 *
 * ## 首页正文由 `renderIndex` 生成：一条粘性索引条
 * 第一行是**主题六类**的筛选片（点一下只看那一类），第二行是 34 个面板的跳转
 * 索引（`#panel-<id>`），右边一个「刷新数据」按钮。面板骨架本身由 `trend.js`
 * 在运行时铺（数据要按语言取 `i18n.js`），构建期只落这条**导航**。
 *
 * ## 为什么不写进页面文件
 * 索引条里每条都带文案（中/英）与 href，手写就是两份副本 —— 而"抄两份"的失效
 * 方式是具体的：加一个面板时漏改一处，那个榜就没有入口。真值只有 `boards.js`
 * （面板 id + 主题 + 来源）与 `i18n.js`（文案），这里只是把它们渲染成 HTML。
 *
 * ## 为什么在构建期而不是客户端
 *   · 与 `{{BRAND}}` / `{{GTM}}` 同一套机制，不新增一层；
 *   · **无 JS 也能用**：导航是页面骨架的一部分，本来就该在没有脚本时也可读
 *     （客户端渲染的导航在禁用 JS 时是整条消失）；
 *   · 链接是静态的相对路径，构建期就能被 `findMissingAssets` 校验。
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
 * 骨架文案 —— 页头导航与索引条里的固定词。面板名走 `i18n.js`
 * （它们本来就是客户端渲染的 `p.<id>.title`），这里只放几条**结构性**文案。
 */
const NAV_TEXT = {
  zh: {
    home: '首页',
    label: '站点导航',
    toggle: '切换语言：',
    switchTo: 'English',
    indexLabel: '榜单索引',
    allTopics: '全部',
    sources: '来源',
    refresh: '刷新数据',
  },
  en: {
    home: 'Home',
    label: 'Site navigation',
    toggle: 'Switch language: ',
    switchTo: '中文',
    indexLabel: 'Board index',
    allTopics: 'All',
    sources: 'Source',
    refresh: 'Refresh data',
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
/**
 * 生成一个语言版本的页头导航：左侧首页，右侧语言切换。
 *
 * 两段是 `header-inner` 的直接子元素，靠它的 `space-between` 各就各位 ——
 * 这样"左一个右一个"由布局负责，不需要在 CSS 里给语言切换写 `margin-left: auto`
 * 这类补丁。
 *
 * @param {'zh'|'en'} lang 本页面语言
 * @param {string} prefix 本页到站点根的相对前缀：中文页 `''`，英文页 `'../'`
 * @param {string|null} boardId 保留形参：`build-site.mjs` 仍按文件推导它传入，
 *   但扁平站之后每个页面都是首页（`index.html` / `en/index.html`），
 *   语言切换一律走目录语义（`en/` 与 `../`）。
 */
export function renderNav(lang, prefix, boardId = null) {
  const text = NAV_TEXT[lang];

  // 语言切换指向**对方的首页**：扁平站只有两个页面（中英各一），
  // 原来"换语言留在同一个榜单上"的逐页对应已不存在（没有榜单页可对应了）。
  const other = lang === 'zh' ? 'en' : 'zh';
  const otherTag = other === 'en' ? 'en' : 'zh-CN';
  const otherHref = other === 'en' ? `${prefix}en/` : `${prefix}`;

  // 首页链接永远指向本语言的首页；扁平站里每个页面**都是**首页，
  // 所以它恒是"当前页"，带 `aria-current`（读屏器播报"当前页"）。
  const homeCurrent = ' aria-current="page"';

  return `<a class="nav-home" href="${prefix}index.html"${homeCurrent}>${escHtml(text.home)}</a>
    <nav class="site-nav" aria-label="${escHtml(text.label)}">
      <a class="lang" href="${otherHref}" hreflang="${otherTag}" lang="${otherTag}"><span class="ic" data-icon="globe"><span class="sr-only">${escHtml(text.toggle)}</span></span>${escHtml(text.switchTo)}</a>
    </nav>`;
}

/** 把 `{{SITE_NAV}}` 落成真值。`lang`/`prefix` 由调用方按文件推导。 */
export function injectNav(html, lang, prefix, boardId, opts) {
  return String(html).split(NAV_PLACEHOLDER).join(renderNav(lang, prefix, boardId, opts));
}

/**
 * 面板与标签的真值 —— 住在 `assets/boards.js`（浏览器侧也要用，
 * 见该文件顶部说明为什么它必须在发布目录里）。这里只是隔着目录引它。
 * 不再 `export` 转出去：那会让这个构建期模块多一层对外表面，而调用方
 * （构建脚本、测试）都能直接引 `boards.js`。
 *
 * 标签的**显示文字**从 `assets/i18n.js` 取（`tagLabel`）—— 那份字典里没有任何
 * DOM 依赖，Node 下能直接 import（构建脚本本来就在 Node 里跑）。这与 `BOARD_TITLES`
 * 需要另抄一份不同：标签文字进了字典（因为它要按语言变），就不该再有第二份。
 */
import {
  BOARD_IDS,
  BOARD_ICONS,
  BOARD_ORDER,
  TOPIC_SLUGS,
  SOURCE_SLUGS,
  boardsWithTag,
} from '../../web/public/assets/boards.js';
import { t, tagLabel } from '../../web/public/assets/i18n.js';

/* ================================================================== */
/* 首页索引条                                                          */
/* ================================================================== */

/**
 * 首页的粘性索引条 —— **构建期**生成，页面里写 `{{BOARD_INDEX}}`。
 *
 * 一页装下 34 个面板之后，"怎么快速找到某一个、怎么只看一类"必须由这条来回答：
 *   · 第一行：**主题六类**的筛选片（点一下收窄到这一类；`*` 是"全部"）。
 *     收窄的逻辑在 `trend.js`（`data-topic-filter`），这里只落 HTML。
 *   · 第二行：34 个面板的跳转索引（`#panel-<id>`，横向可滚动），点一下滚过去。
 *   · 右侧：「刷新数据」按钮（`#refresh`，`trend.js` 绑 `reloadAll`）。
 *
 * 面板骨架本身不在这里 —— 它由 `trend.js` 运行时按语言铺（数据、文案都要走
 * `i18n.js`），这里只落**导航**。锚点 `#panel-<id>` 与 `trend.js` 建的骨架
 * 对得上（`panel()` 里 `el.id = 'panel-' + id`）。
 */
export const INDEX_PLACEHOLDER = '{{BOARD_INDEX}}';

/**
 * 面板名 —— 取 `i18n.js` 的 `p.<id>.title`（**只有那一处来源**，不再另抄一份）。
 *
 * 这里曾经有一份 34×2 的手抄表（`BOARD_TITLES`），那是"构建期要、客户端也要"
 * 时的历史做法。既然构建脚本本来就在 Node 里跑、`i18n.js` 的 `t()` 没有任何 DOM
 * 依赖（见其顶部说明），直接引过来即可 —— 于是面板名在整个仓库里只剩一份，
 * 改一个名字不会漏掉索引条那一处。
 */
function boardTitle(lang, id) {
  return t(lang, `p.${id}.title`);
}

/**
 * 首页的粘性索引条正文 —— 主题筛选行 + 面板跳转行 + 刷新按钮。
 *
 * 顺序：主题按 `TOPIC_SLUGS`（六类互不重叠），跳转索引按 `BOARD_ORDER`
 * （与 `trend.js` 铺骨架的顺序**同源**，所以索引条里的次序与页面上真正
 * 从上到下的次序一致 —— 点索引跳过去不会"跳到一个奇怪的位置"）。
 */
export function renderIndex(lang) {
  const text = NAV_TEXT[lang];

  // 主题筛选：`*` 是"全部"。每片带本主题的榜单数（"多少个榜"是判断点它值不值的信息）。
  const topicChips = [
    { slug: '*', label: text.allTopics, n: BOARD_IDS.length },
    ...TOPIC_SLUGS.map((slug) => ({ slug, label: tagLabel(slug, lang), n: boardsWithTag(slug).length })),
  ]
    .map(
      ({ slug, label, n }) =>
        `<button class="idx-chip${slug === '*' ? ' on' : ''}" type="button" data-topic-filter="${escHtml(slug)}" aria-pressed="${slug === '*' ? 'true' : 'false'}">` +
        `${escHtml(label)}<span class="idx-n">${n}</span></button>`
    )
    .join('');

  // 面板跳转索引：锚点指到 `trend.js` 建的骨架（`#panel-<id>`）。用 <a href> 而不是
  // 按钮 —— 它是"另一个位置"，可右键、可复制、无 JS 时也能跳。`data-jump` 让
  // `trend.js` 在跳之前**先清筛选**（否则目标可能正被隐藏着，浏览器滚不过去）。
  const jumpLinks = BOARD_ORDER.map(
    (id) =>
      `<a class="idx-jump" href="#panel-${escHtml(id)}" data-jump="${escHtml(id)}">` +
      `<span class="idx-ic" data-icon="${escHtml(BOARD_ICONS[id] || 'box')}"></span>` +
      `${escHtml(boardTitle(lang, id))}</a>`
  ).join('');

  // 来源筛选：与面板头里的来源标签同一套 slug（`SOURCE_SLUGS`）。放在最后一行、
  // 可横向滚动 —— 21 个来源平铺会把索引条撑得比面板还高，而"按来源逛"是次要路径。
  const sourceChips = SOURCE_SLUGS.map(
    (slug) =>
      `<button class="idx-chip subtle" type="button" data-tag-filter="${escHtml(slug)}" aria-pressed="false">` +
      `${escHtml(tagLabel(slug, lang))}</button>`
  ).join('');

  // 「刷新数据」按钮依赖 `trend.js` 的 `reloadAll`，所以它只能由脚本绑；
  // 这里落 HTML，`trend.js` 按 id 找它。图标由 `ui.js` 按 [data-icon] 回填。
  const refresh =
    `<button class="idx-refresh" type="button" id="refresh">` +
    `<span class="ic" data-icon="refresh"></span>${escHtml(text.refresh)}</button>`;

  return `<nav class="board-index" id="board-index" aria-label="${escHtml(text.indexLabel)}">
    <div class="idx-row idx-topics">${topicChips}</div>
    <div class="idx-row idx-jumps">${jumpLinks}</div>
    <div class="idx-row idx-sources"><span class="idx-lbl">${escHtml(text.sources)}</span>${sourceChips}</div>
    <div class="idx-row idx-actions">${refresh}<span class="muted" id="refresh-hint"></span></div>
  </nav>`;
}

/** 把 `{{BOARD_INDEX}}` 落成真值（幂等：页面里没有占位符就原样返回） */
export function injectIndex(html, lang) {
  return String(html).split(INDEX_PLACEHOLDER).join(renderIndex(lang));
}

/**
 * 面板**主题分段**的静态骨架 —— 页面里写 `{{BOARD_TOPICS}}`。
 *
 * 六段（`TOPIC_SLUGS`），每段一个 `<h2>`（主题名取 `i18n.js` 的 `tag.<slug>`，
 * 与索引条上的筛选片同一份文案）与一个空的 `<div data-panels>`：
 * `trend.js` 运行时把每个面板挂到**自己主题那一段**里（`rootFor(id)`）。
 *
 * ## 为什么骨架在构建期落，而不是运行时由脚本建
 *   · 分段的**层次**（h1 站点名 → h2 主题 → h3 面板）是页面结构，不是数据：
 *     它该在没有脚本时也在（禁用 JS 时看到六个分节标题，而不是一片空白）；
 *   · 主题名与 `i18n.js` 只有一处来源 —— 若在 HTML 里手抄六份，改一个主题名
 *     要记得改五个地方（中英各一份、再加上索引条）。
 */
export const TOPICS_PLACEHOLDER = '{{BOARD_TOPICS}}';

export function renderTopics(lang) {
  return TOPIC_SLUGS.map(
    (slug) => `<section class="topic" id="topic-${escHtml(slug)}">
    <h2 class="topic-head">${escHtml(tagLabel(slug, lang))}</h2>
    <div class="topic-grid" data-panels></div>
  </section>`
  ).join('\n  ');
}

/** 把 `{{BOARD_TOPICS}}` 落成真值 */
export function injectTopics(html, lang) {
  return String(html).split(TOPICS_PLACEHOLDER).join(renderTopics(lang));
}
