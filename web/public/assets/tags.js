/**
 * `tag.html` 的收窄脚本 —— 只做一件事：按地址里的 `?t=` 留一组卡片。
 *
 * ## 为什么这么小
 * 卡片、标签、分组**全部已经由构建期落成静态 HTML**（见 `src/site/nav.js` 的
 * `renderTagPage`）。这里只是把"用户点了哪个标签"翻译成"显示哪一组"。
 * 之所以不把渲染也交给客户端：分类页的价值在于让搜索引擎发现"这些榜是一类"，
 * 而客户端渲染在爬虫（和禁用 JS 的人）眼里是空页。
 *
 * ## 为什么默认是"全部显示"
 * 分组在 HTML 里**不带 `hidden`**，`?t=` 存在时**收掉**其余的 —— 而不是
 * "默认藏起来、脚本再打开"。这样没有 JS 时看到的是全部榜单（可用），
 * 而不是一片空白。同样的道理：标签链接是 `<a href>`，没有 JS 也能点、能收藏。
 *
 * ## 标签不认识时怎么办
 * 显示全部并把标题写回"按标签浏览"。不猜、也不写一句"没有结果"就完事 ——
 * 手输错的标签是最可能的原因，而"全部"正好让人自己找。
 */
const params = new URLSearchParams(location.search);
const wanted = (params.get('t') || '').trim();

const groups = [...document.querySelectorAll('.tag-group')];
const links = [...document.querySelectorAll('[data-tag-link]')];
const known = groups.map((g) => g.getAttribute('data-tag') || '');

if (wanted && known.includes(wanted)) {
  for (const g of groups) {
    g.hidden = (g.getAttribute('data-tag') || '') !== wanted;
  }
  // 标题与说明：把静态的"按标签浏览"换成这一组自己的。
  // 前缀/后缀由构建期写在 data-* 上（它们要跟着语言走），脚本只插标签值 ——
  // 这样拼接规则只有一处（生成器），不会出现"中英文粘反了"这种错。
  const title = document.getElementById('tag-title');
  const intro = document.getElementById('tag-intro');
  if (title) title.textContent = `${title.dataset.prefix || ''}${wanted}`;
  if (intro) intro.textContent = `${intro.dataset.prefix || ''}${wanted}${intro.dataset.suffix || ''}`;
  // 当前标签标出来（与页头、页脚导航同样用 aria-current，不只靠颜色）
  for (const a of links) {
    if (a.getAttribute('data-tag-link') === wanted) a.setAttribute('aria-current', 'page');
  }
  // 浏览器标签页标题：把"按标签浏览"换成这个标签（站点名是最后一段，保持不动）
  const parts = document.title.split(' · ');
  if (parts.length > 1) {
    parts[0] = wanted;
    document.title = parts.join(' · ');
  }

  // 页头的语言切换链接：构建期还不知道当前标签（它在地址里），所以那时落的
  // 是 `?t=`（空值）。这里补上 —— 否则换语言会把筛选丢掉，读者被扔回"全部"。
  // 这一处是"服务端渲染 + 运行期参数"必然留下的缝，写在这里比让每页硬编码好。
  for (const a of document.querySelectorAll('a.lang[href*="tag.html"]')) {
    a.setAttribute('href', a.getAttribute('href').replace(/\?t=.*$/, `?t=${encodeURIComponent(wanted)}`));
  }
}
