/**
 * 站点 UI 共享件：内联 SVG 图标。
 *
 * （这里原来还有一套主题切换 —— 跟随系统/亮/暗三态 + 页头按钮。
 *  2026-09-23 按 owner 要求去掉了那个按钮：站点的配色现在**只跟随系统**，
 *  由 CSS 的 prefers-color-scheme 直接生效，不需要 JS 参与，
 *  也就不存在"先白后黑"的闪烁问题。）
 *
 * ## 为什么图标用 SVG 而不是 emoji
 * emoji 的字形由**操作系统**决定 —— 同一个 🔥 在 Windows（Segoe UI Emoji）、
 * Android（Noto）、iOS（Apple Color Emoji）上是三套完全不同的画。
 * 对一个要求"全端一致"的站点，这是缺陷而不是风格差异：
 * 面板图标在手机上看起来跟桌面上不是同一个东西。
 * 内联 SVG 用 `currentColor`，因此**自动跟随主题**，也不需要额外请求。
 *
 * ## 为什么每个图标都用一条 path
 * 站点零依赖，不引图标库；这些图形都很简单（圆、线、箭头），
 * 一条 path 就够。`fill: none` + `stroke: currentColor` 的描边风格
 * 在亮暗两套主题下都清晰，不需要第二套图形。
 */

/**
 * 图标表。viewBox 统一 24×24、描边 2px（与主流图标集一致的视觉重量）。
 * 每个图标都是 `{ label, path }`：label 用于无障碍文本（读屏器念得出名字）。
 */
export const ICONS = {
  // 标签（页头的 Tags 入口、卡片上的来源/分类标记）
  tag: {
    label: '标签',
    path: '<path d="M3 12V5a2 2 0 012-2h7l8 8-9 9-8-8z"/><circle cx="8" cy="8" r="1.4"/>',
  },
  // 趋势上行（正在流行）
  trending: {
    label: '趋势上行',
    path: '<path d="M3 17l6-6 4 4 8-8"/><path d="M21 7h-5"/><path d="M21 7v5"/>',
  },
  // 爱心（最受喜欢）
  heart: {
    label: '喜欢',
    path: '<path d="M12 20s-7-4.35-7-9a4 4 0 017-2.65A4 4 0 0119 11c0 4.65-7 9-7 9z"/>',
  },
  // 下载（下载最多）
  download: {
    label: '下载',
    path: '<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/>',
  },
  // 奖杯（评测榜）
  trophy: {
    label: '评测榜',
    path: '<path d="M8 4h8v5a4 4 0 01-8 0V4z"/><path d="M8 5H5v2a3 3 0 003 3"/><path d="M16 5h3v2a3 3 0 01-3 3"/><path d="M12 13v4"/><path d="M9 20h6"/><path d="M10 20v-3h4v3"/>',
  },
  // 代码（编程能力榜）
  code: {
    label: '编程能力',
    path: '<path d="M9 8l-4 4 4 4"/><path d="M15 8l4 4-4 4"/>',
  },
  // 数据库（不经服务端 / 数据源）
  database: {
    label: '数据',
    path: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.66 3.13 3 7 3s7-1.34 7-3V6"/><path d="M5 12v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6"/>',
  },
  // 闪电（实时）
  bolt: {
    label: '实时',
    path: '<path d="M13 3L5 14h6l-1 7 8-11h-6l1-7z"/>',
  },
  // 亮色：太阳
  sun: {
    label: '亮色',
    path: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  },
  // 暗色：月亮
  moon: {
    label: '暗色',
    path: '<path d="M21 13.2A8.5 8.5 0 1110.8 3a6.6 6.6 0 0010.2 10.2z"/>',
  },
  // 跟随系统：显示器
  monitor: {
    label: '跟随系统',
    path: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  },
  // 应用/演示（Spaces）
  cube: {
    label: '应用',
    path: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M12 12l8-4.5"/><path d="M12 12v9"/><path d="M12 12L4 7.5"/>',
  },
  // 数据集（叠层）
  layers: {
    label: '数据集',
    path: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  },
  // 论文（文档）
  file: {
    label: '论文',
    path: '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
  },
  // 星标（GitHub 项目）
  star: {
    label: '星标',
    path: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9L12 3.5z"/>',
  },
  // 发布（盒子）
  box: {
    label: '发布',
    path: '<path d="M3 7l9-4 9 4v10l-9 4-9-4V7z"/><path d="M3 7l9 4 9-4"/><path d="M12 11v10"/>',
  },
  // 刷新
  refresh: {
    label: '刷新',
    path: '<path d="M20 11a8 8 0 10-2.3 5.7"/><path d="M20 5v6h-6"/>',
  },
  // 语言切换（地球）
  globe: {
    label: '切换语言',
    path: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 010 18a14 14 0 010-18z"/>',
  },
};

/** 渲染一个图标为内联 SVG 字符串。`cls` 用于加额外 class。 */
export function icon(name, cls = '') {
  const it = ICONS[name];
  if (!it) throw new Error(`未知图标：${name}`);
  return (
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"` +
    `${cls ? ` class="${cls}"` : ''}>${it.path}</svg>`
  );
}

/**
 * 把页面上所有 `[data-icon]` 占位换成真实 SVG。
 *
 * 为什么用"占位 + 回填"而不是直接在 HTML 里写死 SVG：
 * 图标定义只有一份（本文件），若在 HTML 里再抄一遍 path，
 * 改图标时就会有第二个地方要同步 —— 而漏改一处只会表现为"某页图标没变"，
 * 很难被发现。`data-icon="名字"` 保证图标只有这一个来源。
 */
export function injectIcons(root = document) {
  let n = 0;
  for (const el of root.querySelectorAll('[data-icon]')) {
    const name = el.getAttribute('data-icon');
    if (!ICONS[name]) continue;
    // 插在开头，保留占位元素里原有的 .sr-only 文本（给读屏器用）
    el.insertAdjacentHTML('afterbegin', icon(name));
    n += 1;
  }
  return n;
}

/* 自绑定：页面上有什么就接什么。
 * 为什么放在模块末尾自动做，而不是让每个页面各写一段初始化脚本：
 * 漏写一处就会出现"按钮长得像按钮但点了没反应"——这种沉默的坏掉最难发现。
 * 顶层访问 document 前先判环境，Node 里 import 本模块做测试不会炸。 */
if (typeof document !== 'undefined') {
  injectIcons();
}
