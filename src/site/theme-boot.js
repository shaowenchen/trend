/**
 * 主题状态的内联引导脚本 —— 构建期落进 `<head>` 的占位符。
 *
 * ## 为什么需要一段内联脚本（而不是全交给 `assets/theme.js`）
 * `assets/theme.js` 是 **module**，而 module 是 defer 语义：它要等文档解析完才跑。
 * 那时浏览器**已经画过一帧**了 —— 一个选了亮色的读者，每次打开都会先看到
 * 一整页深色再闪成亮色。这就是"先白后黑"（FOUC），也正是 2026-09-23
 * 当初去掉主题按钮时的理由（见 `site.css` 顶部与 `ui.js` 顶部的那两段注释）。
 *
 * 所以这一段必须是：**同步、内联、不进 module、不 import**，且摆在样式表之前。
 * 它只做一件事 —— 把已选的主题写进 `<html data-theme>` —— 而这件事只需要
 * 三行。切换、记忆、三态循环全部留在 `assets/theme.js` 里。
 *
 * ## 为什么正文由 `theme.js` 的 `bootSnippet()` 生成
 * 内联脚本没法 import，但它需要的那个 localStorage 键（`THEME_KEY`）与
 * "什么算合法值"这套规则，与 `theme.js` 必须是同一份。手抄一遍的失效方式是
 * **静默的**：改了键名忘了这里，读者的选择就"记不住"了，而页面上看不出任何异常
 * （只是每次回来都回到跟随系统）。所以这里引 `theme.js` —— 与 `nav.js`
 * 隔着目录引 `assets/boards.js` 是同一个套路，方向也同样是"构建期引浏览器侧"。
 *
 * ## 与 GTM 占位符的关系
 * 位置不同、互不引用，但共用同一条门禁：发布物里残留任何 `{{…}}` 都会让
 * `site.test.js` 失败（`findUnresolvedPlaceholders`）。所以这里不另写检查。
 */
import { bootSnippet } from '../../web/public/assets/theme.js';

/** 手写静态页里的占位标记 */
export const THEME_BOOT_PLACEHOLDER = '{{THEME_BOOT}}';

/**
 * 内联脚本（含 `<script>` 标签）。
 *
 * ★ **不能加 `type="module"`** —— 那会把它变成 defer 语义，等于没写（见文件头）。
 * 也**不能加 `defer` / `async`**：两者都要求 `src`，写在有正文的脚本上会被忽略，
 * 而"被忽略"这件事页面上看不出来 —— 所以这里连注释都写明白，免得后人"顺手加上"。
 */
export function themeBootScript() {
  return `<script>${bootSnippet()}</script>`;
}

/** 把 `{{THEME_BOOT}}` 落成真值（幂等：没有占位符就原样返回） */
export function injectThemeBoot(html) {
  return String(html).split(THEME_BOOT_PLACEHOLDER).join(themeBootScript());
}
