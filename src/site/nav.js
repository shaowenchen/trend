/**
 * 页头导航 —— **构建期**生成，页面里写 `{{SITE_NAV}}`。
 *
 * ## 只有两样东西：左边「首页」，右边切换语言
 * 十一个榜单**不进页头**：它们已经在首页的入口卡片里各占一张卡，页头再列一遍
 * 就是同一份目录的第二次出现 —— 而窄屏上 11 条要挤成下拉才放得下。
 * 榜单页之间怎么互相走，见页面下部的 `.board-links`（`trend.js` 生成）。
 *
 * ## 为什么不写进 24 个页面文件
 * 导航里有语言切换，它必须指向**对应的那一页**（`trending.html` ↔
 * `en/trending.html`），也就是每个页面的地址都不一样。手写就是 24 份副本，
 * 而"抄 24 份"的失效方式是具体的：加一个面板时漏改几个页面，那几页的语言切换
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
 * 骨架文案。**只有三个词**，且都是导航标签 —— 这就是"页面骨架文案不进字典"
 * 的代价里可接受的那一部分：面板名走字典，因为它们本来就是客户端渲染的
 * （`p.<id>.title`）。
 */
const NAV_TEXT = {
  zh: {
    home: '首页',
    label: '站点导航',
    toggle: '切换语言：',
    switchTo: 'English',
  },
  en: {
    home: 'Home',
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
 * 生成一个语言版本的页头导航：左侧首页、右侧语言切换。
 *
 * 两段是 `header-inner` 的直接子元素，靠它的 `space-between` 各就各位 ——
 * 这样"左一个右一个"由布局负责，不需要在 CSS 里给语言切换写 `margin-left: auto`
 * 这类补丁。
 *
 * @param {'zh'|'en'} lang 本页面语言
 * @param {string} prefix 本页到站点根的相对前缀：中文页 `''`，英文页 `'../'`
 * @param {string|null} boardId 本页是哪个榜单；首页传 null
 */
export function renderNav(lang, prefix, boardId = null) {
  const text = NAV_TEXT[lang];

  // 语言切换：**指向对应的那一页**（`trending.html` ↔ `en/trending.html`），
  // 不是指向对方语言的首页 —— 换语言时读者应当留在原来的榜单上，
  // 而不是被丢回首页重新找一遍。首页之间则是目录语义（`en/` 与 `../`）。
  //
  // 它保持是 <a>：这是"另一个地址"，不是页内动作 —— 可收藏、可被搜索引擎
  // 跟随，面板页之间也正是靠它互指的（site.test.js 有断言盯着）。
  const other = lang === 'zh' ? 'en' : 'zh';
  const otherHref =
    other === 'en'
      ? `${prefix}en/${boardId ? `${boardId}.html` : ''}`
      : `${prefix}${boardId ? `${boardId}.html` : ''}`;
  const otherTag = other === 'en' ? 'en' : 'zh-CN';

  // 本页是不是首页：是的话给首页链接带上 aria-current（读屏器会播报"当前页"）。
  // 首页链接本来就在"当前页"上时**不**加边框——它已经是页头唯一的左侧元素，
  // 再加框只会看起来像一颗按钮（见 site.css 的 .nav-home）。
  const homeCurrent = boardId === null ? ' aria-current="page"' : '';

  return `<a class="nav-home" href="${prefix}index.html"${homeCurrent}>${escHtml(text.home)}</a>
    <nav class="site-nav" aria-label="${escHtml(text.label)}">
      <a class="lang" href="${otherHref}" hreflang="${otherTag}" lang="${otherTag}"><span class="ic" data-icon="globe"><span class="sr-only">${escHtml(text.toggle)}</span></span>${escHtml(text.switchTo)}</a>
    </nav>`;
}

/** 把 `{{SITE_NAV}}` 落成真值。`lang`/`prefix`/`boardId` 由调用方按文件推导。 */
export function injectNav(html, lang, prefix, boardId) {
  return String(html).split(NAV_PLACEHOLDER).join(renderNav(lang, prefix, boardId));
}
