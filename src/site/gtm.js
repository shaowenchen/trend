/**
 * Google Tag Manager 容器 —— **唯一来源**，与品牌名（`src/site/brand.js`）同一套做法。
 *
 * ## 为什么 ID 与代码片段都要走占位符
 * 页面是**手写静态文件**，直接写入容器 ID 就等于把这个值复制到四个页面里：
 * 换容器要手改每一处，漏改一处就会出现"这个页面统计到了、那个没有"——
 * 而统计缺失**不报错**，报表上只是少一截，没人会立刻发现。
 *
 * 所以页面里写 `{{GTM}}`（head 里的容器脚本）与 `{{GTM_NOSCRIPT}}`
 * （`<body>` 顶部、给禁用 JS 的访客用的 iframe，Google 要求的位置），
 * 由 `scripts/build-site.mjs` 在构建时一起落成真值。
 *
 * 好处是**门禁免费**：现有的"发布物里不许残留 `{{…}}` 占位符"那条断言
 * （`site.test.js`）会自动盯上漏落的页面 —— 不需要为 GTM 另写一套检查。
 *
 * ## 为什么拆成两个占位符
 * Google 给的两个片段位置不同：脚本进 `<head>`（越早越好，早于页面绘制），
 * `noscript` 的 iframe 紧跟 `<body>` 开标签（放在 head 里是无效 HTML）。
 * 合成一个占位符就只能二选一，所以拆开。
 *
 * ## 同意（consent）：这里是**直接加载**
 * 本站当前的选择是访客一到就加载容器（无同意横幅），与容器里配了什么标签
 * 无关 —— 只要容器里有 GA4/Ads 标签，未同意前就会写入 `_ga` / `_gcl` 这类
 * cookie。要改成"先同意后加载"，做法是只发布 `<meta name="gtm-id">`、
 * 把容器脚本的注入挪进一个 consent 脚本 —— 即把下面 gtmSnippet() 从构建期
 * 调用改成运行期调用，页面结构不用动。欧盟流量占比高时再评估这件事。
 */
export const GTM_ID = 'GTM-MTW4XNQ';

/** 手写静态页里的两个占位标记，构建期由 `injectGtm()` 替换 */
export const GTM_PLACEHOLDER = '{{GTM}}';
export const GTM_NOSCRIPT_PLACEHOLDER = '{{GTM_NOSCRIPT}}';

/**
 * 容器 ID 形状校验：`GTM-` 加 4-12 位大写字母数字。
 *
 * 为什么值得写：这是个手抄进代码的常量，最典型的错误是把 GA4 的衡量 ID
 * （`G-XXXXXXXXXX`）填进来。形状不对时容器脚本会**加载不出来**，
 * 而页面上什么提示都没有 —— 统计静默全零。构建期直接失败比这好得多。
 */
export function isValidGtmId(id = GTM_ID) {
  return /^GTM-[A-Z0-9]{4,12}$/.test(String(id || '').trim());
}

/** `<head>` 里的容器脚本 */
export function gtmScript(id = GTM_ID) {
  return (
    `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});` +
    `var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;` +
    `j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})` +
    `(window,document,'script','dataLayer','${id}');</script>`
  );
}

/** 紧跟 `<body>` 开标签的 `noscript` 回退 */
export function gtmNoScript(id = GTM_ID) {
  return (
    `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${id}" ` +
    `height="0" width="0" style="display:none;visibility:hidden" title="Google Tag Manager"></iframe></noscript>`
  );
}

/**
 * 把 `{{GTM}}` / `{{GTM_NOSCRIPT}}` 落成真值（页面上各出现一次，用 split/join）。
 *
 * ID 形状不合法时**直接抛错**：这一步在构建期跑，失败会让整个构建非零退出，
 * 而不是产出一个"统计悄悄不工作"的站点。
 */
export function injectGtm(text, id = GTM_ID) {
  if (!isValidGtmId(id)) {
    throw new Error(`GTM 容器 ID 形状不对：${JSON.stringify(id)}（应为 GTM- 加 4-12 位大写字母数字）`);
  }
  return String(text)
    .split(GTM_PLACEHOLDER)
    .join(gtmScript(id))
    .split(GTM_NOSCRIPT_PLACEHOLDER)
    .join(gtmNoScript(id));
}
