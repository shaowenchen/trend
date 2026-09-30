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
  'repos',
  'newmodels',
  'swebench',
];
