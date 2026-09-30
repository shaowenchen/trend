/**
 * 站点品牌名 —— **唯一来源**。
 *
 * 为什么单独一个文件、而不是把名字散在各个页面里：
 * 页面是**手写静态文件**，写死品牌名 = "改品牌"要手改每一处，
 * 漏改一处就会让同一个站点出现两个名字。所以页面上出现品牌名的地方
 * 一律引用这里（见 `BRAND_PLACEHOLDER` 的说明）。
 *
 * 与 aibox 版本的差别：那边品牌名由**服务端**在响应前替换（占位符 `{{BRAND}}`），
 * 本站没有服务端 —— 占位符由构建步骤 `scripts/build-site.mjs` 落成真值，
 * 并把产物复制进 `dist/`。所以：
 *   · 仓库里的 `web/public/*.html` 可以带占位符；
 *   · **发布出去的 HTML 里绝不能有**（`web/public/assets/site.test.js` 有一道门禁盯着）。
 */
export const BRAND = 'trend';

/**
 * 手写静态页里写品牌名的方式：`{{BRAND}}`，由 `scripts/build-site.mjs` 替换。
 */
export const BRAND_PLACEHOLDER = '{{BRAND}}';

/** 把文本里的 `{{BRAND}}` 全部替换成品牌名（页面上会出现多次，所以用 split/join 而非 replace） */
export function injectBrand(text, brand = BRAND) {
  return String(text).split(BRAND_PLACEHOLDER).join(String(brand));
}

/**
 * 门禁用：找出**未替换**的占位符，例如 `{{BRAND}}`。
 * 占位符一旦漏替换就会发布上线 —— 用户直接在页面上看到 `{{BRAND}}`。
 *
 * 为什么限定"大写字母/数字/下划线"：`web/public/assets/*.js` 里有大量
 * JSDoc 类型注释形如 `{{ok:boolean}}`，它们会**合法地**进入页面。
 * 把任何 `{{` 都判成缺陷会天天误报，而误报会训练人忽略门禁。
 */
const PLACEHOLDER_RE = /\{\{[A-Z][A-Z0-9_]*\}\}/g;

export function findUnresolvedPlaceholders(text) {
  return [...String(text).matchAll(PLACEHOLDER_RE)].map((m) => m[0]);
}
