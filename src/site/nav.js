/**
 * 页头导航 —— **构建期**生成，页面里写 `{{SITE_NAV}}`。
 *
 * ## 为什么不写进 24 个页面文件
 * 导航里有 11 个榜单链接。手写就是 24 份副本，而"抄 24 份"的失效方式很具体：
 * 加一个面板时漏改几个页面，那几页就少一条入口 —— 访客看不见，测试也不一定
 * 抓得住。`BOARD_IDS` 是唯一来源（见 `boards.js`），这里由它推导链接。
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
 * 相对路径：中文页指向 `trending.html`，英文页指向 `../trending.html`。
 * 这正是 `lang` 参数的唯一作用。
 *
 * 页面骨架的文案不进 `i18n.js` 字典（那是给客户端用的，见该文件顶部说明），
 * 所以导航的文案在这里自带一份 —— 与页面里其它骨架文案是同样的处理方式。
 */

import { BOARD_IDS } from './boards.js';

/** 占位符，由 `scripts/build-site.mjs` 替换。 */
export const NAV_PLACEHOLDER = '{{SITE_NAV}}';

/**
 * 骨架文案。**只有四个词**，且都是导航标签 —— 这就是"页面骨架文案不进字典"
 * 的代价里可接受的那一部分：面板名（11 个）走字典，因为它们本来就是
 * 客户端渲染的（`p.<id>.title`）。
 */
const NAV_TEXT = {
  zh: {
    home: '首页',
    boards: '榜单',
    brand: 'Trend · AI 趋势大盘',
    toggle: '切换语言：',
    switchTo: 'English',
  },
  en: {
    home: 'Home',
    boards: 'Boards',
    brand: 'Trend · AI Trend Board',
    toggle: 'Switch language: ',
    switchTo: '中文',
  },
};

/** 面板名 —— 与 `i18n.js` 的 `p.<id>.title` 同源（这里构建期要，那边客户端要）。 */
const BOARD_TITLES = {
  zh: {
    trending: '热门模型',
    liked: '最多点赞',
    downloaded: '最多下载',
    eval: '模型评测',
    aider: '编程能力（Aider）',
    spaces: '社区应用（Spaces）',
    datasets: '数据集',
    papers: '论文',
    repos: '开源项目',
    newmodels: '新模型',
    swebench: '编程能力（SWE-bench）',
  },
  en: {
    trending: 'Trending models',
    liked: 'Most-liked models',
    downloaded: 'Most-downloaded models',
    eval: 'Model evaluation',
    aider: 'Coding (Aider)',
    spaces: 'Community apps (Spaces)',
    datasets: 'Datasets',
    papers: 'Papers',
    repos: 'Open-source projects',
    newmodels: 'New models',
    swebench: 'Coding (SWE-bench)',
  },
};

/** HTML 转义。面板名与文案都是本仓库里的常量，仍一律转义 —— 规则不该有例外。 */
export function escHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * 生成一个语言版本的页头导航。
 *
 * @param {'zh'|'en'} lang 本页面语言
 * @param {string} prefix 本页到站点根的相对前缀：中文页 `''`，英文页 `'../'`
 * @param {string} brand 品牌名（构建期落成真值）
 * @param {string|null} boardId 本页是哪个榜单；首页传 null
 */
export function renderNav(lang, prefix, brand = 'Trend', boardId = null) {
  const text = NAV_TEXT[lang];
  const titles = BOARD_TITLES[lang];

  // 榜单下拉。用 <details>/<summary>：原生就支持"点击展开、点外部关闭、
  // 键盘可达"，不需要一行 JS。禁用 JS 时它退化成"展开后一直开着"，
  // 而不是一个点不动的按钮。
  const items = BOARD_IDS.map((id) => {
    // 当前页标出来 —— 与页面下方的 .board-links 同样用 aria-current，
    // 而不是只靠颜色（只靠颜色对色觉障碍的访客等于没标）。
    const current = id === boardId ? ' aria-current="page"' : '';
    return `        <li><a href="${prefix}${id}.html"${current}>${escHtml(titles[id])}</a></li>`;
  }).join('\n');

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

  // 当前页标在**两个**地方：首页时标「首页」，榜单页时标下拉里那一条。
  // 都用 aria-current 而不是只靠颜色 —— 只靠颜色对色觉障碍的访客等于没标，
  // 与页面下方 .board-links 的标法一致。
  const homeCurrent = boardId === null ? ' aria-current="page"' : '';

  return `    <a class="brand" href="${prefix}index.html">${escHtml(brand)}</a>
    <nav class="site-nav" aria-label="${escHtml(text.brand)}">
      <a class="nav-home" href="${prefix}index.html"${homeCurrent}>${escHtml(text.home)}</a>
      <details class="nav-boards">
        <summary>${escHtml(text.boards)}<span class="caret" aria-hidden="true"></span></summary>
        <ul class="nav-boards-menu">
${items}
        </ul>
      </details>
      <a class="lang" href="${otherHref}" hreflang="${otherTag}" lang="${otherTag}"><span class="ic" data-icon="globe"><span class="sr-only">${escHtml(text.toggle)}</span></span>${escHtml(text.switchTo)}</a>
    </nav>`;
}

/** 把 `{{SITE_NAV}}` 落成真值。`lang`/`prefix`/`boardId` 由调用方按文件推导。 */
export function injectNav(html, lang, prefix, brand, boardId) {
  return String(html).split(NAV_PLACEHOLDER).join(renderNav(lang, prefix, brand, boardId));
}
