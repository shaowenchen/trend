/**
 * 面板 id —— **唯一来源**，发布集合与页头导航都从它推导。
 *
 * 为什么单独一个文件、而不是留在 `assets/trend.js` 里：
 * 这些 id 同时是三样东西 —— DOM 契约（`<div id="panels" data-board="…">`）、
 * 页面文件名（`trending.html` / `en/trending.html`）、以及链接目标。
 * 而要用到它们的**不只有** `trend.js`：
 *
 *   · `scripts/build-site.mjs` 要据此推出发布集合与页头导航的链接；
 *   · `assets/site.test.js` 要据此推出页面临界；
 *   · 而 `trend.js` 顶层会发请求（见它的 `panelsRoot` 一段），
 *     构建期 import 它并不合适。
 *
 * 三个地方各抄一份 11 个 id，迟早会有一份抄错，而抄错的失效方式是
 * **线上 404**（或一页永远点不到）。所以放在这里，谁都能引。
 *
 * 改 id = 改地址，`site.test.js` 有一条断言盯着"页面与 id 完全对齐"。
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
  'repos',
  'newmodels',
  'swebench',
];
