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
  'openrouter',
  'swebench',
];

/**
 * 每个榜单的标签 —— 两类，顺序有意义（**来源在前，分类在后**）。
 *
 * ## 为什么标签住在**这个**文件里
 * 标签要出现在三个地方，而且三者必须一致：
 *   · 首页与榜单页的卡片上（`trend.js` 渲染，客户端）；
 *   · `tags.html` / `tag.html` 两个页面（**构建期**生成，`src/site/nav.js` 同一路数）；
 *   · 测试（Node）。
 * 与 `BOARD_IDS` 完全同一个理由：真值只能有一个地方，否则"网页上少了某个标签"
 * 这种错会静默发生 —— 页面上只是少一行，不报错。
 *
 * ## 两类标签
 *   · **来源**：数据从哪来（HuggingFace / GitHub / models.dev / Aider /
 *     OpenRouter / SWE-bench）。它们同时是**可信度**信息 —— 榜的口径以来源方为准。
 *   · **分类**：这是什么榜（模型 / 评测 / 编程 / 社区 / 论文）。
 *
 * ## 为什么标签文字**不进 i18n 字典**
 * 它们是专有名词与简短的英文分类词，**两种语言用同一份**。走字典会得到一个
 * 更糟的状态：中文页显示"模型"、英文页显示"Models"、而 `tag.html?t=模型`
 * 这种地址在英文站上无解（URL 里的标签值也得跟着分语言）。
 * 保持一份，地址与文字都稳定。站点其余文案照旧走字典，这里是有意的例外。
 */
export const BOARD_TAGS = {
  trending: ['HuggingFace', 'Models'],
  liked: ['HuggingFace', 'Models'],
  downloaded: ['HuggingFace', 'Models'],
  eval: ['HuggingFace', 'Evaluation', 'Models'],
  aider: ['Aider', 'Coding', 'Evaluation'],
  spaces: ['HuggingFace', 'Community'],
  datasets: ['HuggingFace', 'Community'],
  papers: ['HuggingFace', 'Papers', 'Community'],
  repos: ['GitHub', 'Community'],
  newmodels: ['models.dev', 'Models'],
  openrouter: ['OpenRouter', 'Models'],
  swebench: ['SWE-bench', 'Coding', 'Evaluation'],
};

/**
 * 全部标签，按**首次出现的顺序**去重 —— 顺序稳定（来源先出现、分类随后），
 * `tags.html` 直接按它铺，不需要每次再排一遍，也不会因为 Map 迭代顺序的
 * 细枝末节而在两次构建间换位置。
 */
export const ALL_TAGS = [...new Set(Object.values(BOARD_TAGS).flat())];

/** 某个标签下的榜单 id（按 `BOARD_IDS` 的顺序，保证页面上的排列稳定） */
export function boardsWithTag(tag) {
  return BOARD_IDS.filter((id) => (BOARD_TAGS[id] || []).includes(tag));
}
