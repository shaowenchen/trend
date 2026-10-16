/**
 * 主题切换 —— 三态（跟随系统 / 亮 / 暗）的唯一真值。
 *
 * ## 为什么又加回来了（2026-10-16）
 * 2026-09-23 曾按 owner 要求去掉过这个按钮，理由是"只跟随系统就不需要在 head 里
 * 插一段抢在绘制前跑的内联脚本，也就没有'先白后黑'的闪烁"。那条推理本身没错，
 * 但它把两件事绑在了一起：**配色跟随系统**（好）与**读者不能自己选**（代价）。
 * 暗色成了默认之后，系统偏亮的人第一次进来看到的是一整页深色 —— 而他没有任何
 * 办法改。所以现在按 owner 的要求把选择权还给读者，同时**保住不闪**：
 * 内联脚本仍然在 head 里、仍早于首次绘制（见 `bootSnippet()`）。
 *
 * ## 三态而不是两态
 * "跟随系统"必须是一个**能回去的状态**，不是"没选过"的残留。两态开关（亮/暗）
 * 一旦点过，读者就永远失去了"跟着系统走"这个选项 —— 而那是很多人真正想要的
 * （白天亮、夜里暗，由系统负责）。所以是 system → light → dark 循环。
 *
 * ## 为什么状态写在 `<html data-theme>` 而不是 class
 * CSS 侧早就按 `data-theme` 写好了（`:root[data-theme='light']`，
 * 见 `site.css`）。属性还有一个好处：**"跟随系统"就是没有这个属性**，
 * 于是那条 `:root:not([data-theme])` 的媒体查询天然只在跟随系统时生效 ——
 * 不需要在 JS 里判断"现在该不该听系统的"。
 *
 *   跟随系统 → 没有属性 → :root 的暗色 + 媒体查询（系统亮则覆盖成亮色）
 *   手动亮   → data-theme="light" → 走到 :root[data-theme='light']，媒体查询被
 *              :not() 挡掉
 *   手动暗   → data-theme="dark"  → 仍是 :root 的暗色，媒体查询同样被挡掉
 *
 * ★ 第三行是容易看漏的一处：**"手动暗"不需要任何新的 CSS 规则**，
 * 因为 `:root` 本来就是暗色，"手动暗"要做的只是**阻止媒体查询接管**。
 * 少写一条重复的 `:root[data-theme='dark']` 就少一处将来会漂移的第二真值。
 *
 * ## 为什么这个文件在 `assets/` 下（而不是 `src/site/`）
 * 与 `boards.js` 完全同一个理由：**浏览器只能拿到发布集合里的文件**。
 * 浏览器要 `import` 它（切换逻辑），构建期要引它生成内联脚本
 * （`src/site/theme-boot.js` 的 `bootSnippet()`）—— 而后者隔着目录引前者没问题，
 * 反过来则不成立。真值只能住在浏览器够得着的地方。
 */

import { icon } from './ui.js';
import { t } from './i18n.js';

/**
 * localStorage 的键。★ 这个值有**两个**消费者：本模块与 head 里的内联脚本
 * （`bootSnippet()` 生成）。内联脚本不能 import（它必须早于一切模块执行），
 * 所以它由 `bootSnippet()` 从**这个常量**拼出来，而不是手抄一份 ——
 * 手抄的失效方式是静默的：改了这里忘了那里，读者的选择就"记不住"了。
 */
export const THEME_KEY = 'trend-theme';

/** 三态，**顺序即循环顺序**（点一下走下一个）。`system` 是默认，也是"没存过"的落点。 */
export const THEME_CYCLE = ['system', 'light', 'dark'];

/** 每一态的图标 —— 全是 `ui.js` 里现成的键（`icon()` 遇到未登记的名字会抛错） */
export const THEME_ICON = { system: 'monitor', light: 'sun', dark: 'moon' };

/** 每一态的文案键（`i18n.js` 的 `theme.*`） */
export const THEME_TEXT_KEY = { system: 'theme.system', light: 'theme.light', dark: 'theme.dark' };

/** 按钮的 id —— 页头由 `src/site/nav.js` 落 HTML，本模块按它找按钮 */
export const THEME_BTN_ID = 'theme-toggle';

/** 任何来源的值（localStorage / 手改的 DOM）都先过这一道，非法值一律回落"跟随系统" */
export function normalizeTheme(v) {
  return THEME_CYCLE.includes(v) ? v : 'system';
}

/** 循环里的下一个状态 */
export function nextTheme(cur) {
  return THEME_CYCLE[(THEME_CYCLE.indexOf(normalizeTheme(cur)) + 1) % THEME_CYCLE.length];
}

/**
 * 读读者的选择。
 * ★ 包 try：`localStorage` 这个**属性访问本身**在"阻止所有 Cookie"、
 * 隐私模式、内嵌 WebView 里会抛 SecurityError（与 `trend.js` 的缓存层同一个坑）。
 * 存储读不了就当作"没选过"（跟随系统），而不是让整个模块在求值时死掉。
 */
export function readTheme() {
  try {
    return normalizeTheme(localStorage.getItem(THEME_KEY));
  } catch {
    return 'system';
  }
}

/** 记住选择。存不下就算了 —— 顶多下次进来回到跟随系统，不影响本次展示。 */
export function writeTheme(theme) {
  try {
    const v = normalizeTheme(theme);
    // "跟随系统"**删掉**这个键，而不是存字符串 'system'：
    // 键不存在 = 没选过 = 跟随系统，两者本来就该是同一件事。
    if (v === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, v);
  } catch {
    /* 存不下不影响本次展示 */
  }
}

/**
 * 把状态落到 DOM 上。`system` 是**移除**属性（见文件头：媒体查询靠"没有属性"生效）。
 * `documentElement` 不存在时（Node 下测试 import）直接返回，不炸。
 */
export function applyTheme(theme) {
  if (typeof document === 'undefined') return;
  const v = normalizeTheme(theme);
  if (v === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', v);
}

/**
 * head 里那段内联脚本的**正文**（不含 `<script>` 标签）。
 *
 * 它必须满足三条，缺一条就会退回"先白后黑"：
 *   1. 早于首次绘制执行 —— 由 `src/site/theme-boot.js` 落在 `<head>` 的样式表之前；
 *   2. **不能是 module** —— module 是 defer 语义，会晚到绘制之后；
 *   3. 不能 import 任何东西 —— 同理，同步内联是唯一选择。
 * 所以它只有几行、只用 `localStorage` 与 `documentElement`，且整段包 try
 * （存储被拦时静默跳过，让后面的主题模块去处理）。
 */
export function bootSnippet() {
  return (
    `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});` +
    `if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`
  );
}

/**
 * 把按钮画成当前状态：换图标 + 换无障碍名。
 *
 * 图标用"清空再填"而不是 `injectIcons()`：那个函数是 `insertAdjacentHTML`
 * （只加不删），在同一个占位元素上调用两次会**叠出两个 svg** ——
 * 页面上表现为"图标变成了两层"或"换主题时图标没变"。这里显式清空，
 * 于是它天然幂等，也不依赖本模块与 `ui.js` 的加载先后。
 */
function paintButton(btn, theme) {
  const ic = btn.querySelector('.ic');
  if (ic) {
    ic.innerHTML = '';
    ic.insertAdjacentHTML('afterbegin', icon(THEME_ICON[theme]));
  }
  const name = t(locale(), THEME_TEXT_KEY[theme]);
  // 当前状态进 aria-label（读屏器念得出"现在是跟随系统"）；
  // 下一步进 title（鼠标悬停能看出点下去会变成什么）
  btn.setAttribute('aria-label', `${t(locale(), 'theme.name')}：${name}`);
  btn.setAttribute('title', t(locale(), 'theme.hint', { next: t(locale(), THEME_TEXT_KEY[nextTheme(theme)]) }));
}

/** 当前语言 —— 与 `trend.js` 的 `LOCALE` 同法（读 `<html lang>`，两边说的是同一件事） */
function locale() {
  if (typeof document === 'undefined') return 'zh';
  return String(document.documentElement.getAttribute('lang') || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh';
}

/**
 * 接上页头那个按钮。**没有按钮就直接返回**：扁平站的两个页面都有它，
 * 但主题模块不该因为"某个页面少了按钮"而报错。
 */
export function wireThemeToggle() {
  if (typeof document === 'undefined') return;
  const btn = document.getElementById(THEME_BTN_ID);
  if (!btn) return;
  paintButton(btn, readTheme());
  btn.addEventListener('click', () => {
    const next = nextTheme(readTheme());
    writeTheme(next);
    applyTheme(next);
    paintButton(btn, next);
  });
}

/**
 * 自绑定：接上页头那个按钮。
 *
 * ★ 这里**不**再 `applyTheme(readTheme())` 一遍 —— DOM 状态一律以 head 里
 * 那段内联脚本的结果为准，本模块只管"点了之后怎么办"。重设一次看起来更"稳"，
 * 其实有害：内联脚本读不到存储时（隐私模式）不写属性是**正确的**回落
 * （跟随系统），而这里再写一遍同样写不出什么；反过来，将来若两者规则出现分叉，
 * 这里就成了一个会静默覆盖内联脚本结果的第二真值。少一个写入点就少一处这种可能。
 *
 * 模块是 defer 语义（`type="module"`），执行时文档已解析完 —— 页头按钮由
 * 构建期落在 HTML 里，此刻一定在。所以不需要等 `DOMContentLoaded`。
 */
if (typeof document !== 'undefined') {
  wireThemeToggle();
}
