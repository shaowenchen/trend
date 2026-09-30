/**
 * 站点门禁测试 —— 抓的是**静态站会静默坏掉**的那几类事。
 *
 * 为什么这些检查不能只靠人看：GitHub Pages 上出错时页面**不会报错**，
 * 它只会少东西或显示错的语言，而提交者本地很可能看不出差别。逐条对应：
 *
 *   1. 面板引用的文案键在字典里不存在 → 页面上直接显示英文键名（如 `err.evalFirst`）。
 *      翻译自检抓不到它：它只比对两种语言，而这类键两边**一致地都缺**。
 *   2. 页面里引用的资源没被构建复制进 dist → 线上 404，页面只是白屏/没样式。
 *   3. 发布集合里混进测试文件或隐藏文件 → 静默上线。
 *   4. 页面用了以 `/` 开头的绝对路径 → 站点挂在 `/<仓库>/` 子路径下时整站失效。
 *   5. 页面把品牌名写死 → 改品牌时漏改的页面会自称另一个名字。
 *   6. 英文页里混进中文（或反过来）→ 只有对应语言的访客会发现。
 *   7. `<html lang>` 与页面实际语言不符 → 面板文案按 lang 取字典，整页文案会串语言。
 *
 * 这个文件住在 `web/public/assets/` 下（与 trend.js 同目录，便于用相对路径 import），
 * 但**不在构建的发布集合里**（`scripts/build-site.mjs` 的 `SITE_FILES` 是白名单）。
 * 构建还会再挡一道：发布集合里出现 `*.test.js` 直接失败。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { t, LOCALES } from './i18n.js';
import { BOARD_IDS } from './trend.js';
import { BRAND, findUnresolvedPlaceholders } from '../../../src/site/brand.js';import { buildSite, SITE_FILES, findMissingAssets, findMissingImports, findForbidden, assertSafeOutDir } from '../../../scripts/build-site.mjs';
import { resolveRequest } from '../../../scripts/serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PUBLIC = path.join(ROOT, 'web', 'public');

/**
 * 页面清单 —— 从 `BOARD_IDS`（trend.js 里的面板注册表）**推导**，不手写。
 *
 * 手写清单的失效方式是静默的：新加一个面板页、登记进 `SITE_FILES` 却漏在这里，
 * 下面所有"逐页扫描"的断言就都跳过了它 —— 那一页可以带着绝对路径、串着语言
 * 上线，而门禁一路绿灯。从注册表推导则不会漂移。
 */
const PAGES = {
  zh: ['index.html', ...BOARD_IDS.map((id) => `${id}.html`)],
  en: ['en/index.html', ...BOARD_IDS.map((id) => `en/${id}.html`)],
};
const ALL_PAGES = [...PAGES.zh, ...PAGES.en];
/**
 * 要扫文案键的脚本 —— **从发布集合推导**，不是手写清单。
 *
 * 手写清单的失效方式是静默的：新加一个客户端脚本、加进 `SITE_FILES` 却没加进这里，
 * 门禁就漏掉了它的全部文案键，而且看不出来。从白名单推导则不会漂移 ——
 * 将来把新的 `assets/*.js` 登记进发布集合，它就自动被扫。
 */
const CLIENT_SCRIPTS = SITE_FILES.filter((f) => /^assets\/[^/]+\.js$/.test(f));

let pass = 0;
const test = async (name, fn) => {
  try {
    await fn();
    pass += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n    ${e.message}`);
    process.exitCode = 1;
  }
};

const read = (rel) => fs.readFile(path.join(PUBLIC, rel), 'utf8');

/**
 * 页面的**可见文本**：先去掉注释、再去掉标签。
 *
 * 顺序很重要，且必须先去除注释：本站的注释是给人看的，里面会写
 * `https://<用户名>.github.io/<仓库>/` 这种带尖括号的例子 ——
 * 直接按 `<[^>]*>` 去标签，会在注释里第一个 `>` 处提前收尾，
 * 把剩下的注释文字当成正文。上面那两类"串语言"检查都会因此误报。
 */
function visibleText(html) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ');
}

console.log('\n站点门禁测试');

/* ---------------- 1. 文案键 ---------------- */

/** 从脚本源码里抠出所有被引用的文案键：`L('x')` 与 `t(LOCALE, 'x')` */
export function referencedKeys(source) {
  const keys = new Set();
  for (const m of String(source).matchAll(/\bL\(\s*'([A-Za-z0-9._]+)'/g)) keys.add(m[1]);
  for (const m of String(source).matchAll(/\bt\(\s*[^,)]+,\s*'([A-Za-z0-9._]+)'/g)) keys.add(m[1]);
  return keys;
}

const sources = Object.fromEntries(await Promise.all(CLIENT_SCRIPTS.map(async (f) => [f, await read(f)])));

await test('★ 面板脚本引用的每个文案键都存在于字典（缺了就会在页面上显示键名）', () => {
  const missing = [];
  for (const [file, src] of Object.entries(sources)) {
    for (const key of referencedKeys(src)) {
      for (const locale of LOCALES) {
        const v = t(locale, key);
        if (v === key) missing.push(`${file}: ${locale} 缺 ${key}`);
      }
    }
  }
  assert.deepEqual(missing, [], `字典里没有这些键：\n      ${missing.join('\n      ')}`);
});

await test('引用的键确实被扫到了（防止上面那条因为正则失配而"永远通过"）', () => {
  // 先确认扫的是发布集合里的脚本、且不止一个 —— 上面那条的覆盖面靠这里兜底
  assert.ok(CLIENT_SCRIPTS.length >= 2, `只扫到 ${CLIENT_SCRIPTS.length} 个脚本`);
  assert.ok(CLIENT_SCRIPTS.includes('assets/trend.js'), '没扫到 trend.js');
  const all = new Set(Object.values(sources).flatMap((s) => [...referencedKeys(s)]));
  assert.ok(all.size > 100, `只扫到 ${all.size} 个键，正则大概写错了`);
  assert.ok(all.has('p.eval.title'), '没扫到 p.eval.title');
  assert.ok(all.has('err.evalFirst'), '没扫到 err.evalFirst');
});

/* ---------------- 2 & 3. 构建产物 ---------------- */

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'trend-site-'));
const built = await buildSite({ outDir: path.join(tmp, 'dist') });
const distRead = (rel) => fs.readFile(path.join(built.outDir, rel), 'utf8');

await test('★ 构建产出的每个文件都没有残留占位符', async () => {
  const bad = [];
  for (const rel of built.files) {
    for (const marker of findUnresolvedPlaceholders(await distRead(rel))) bad.push(`${rel}: ${marker}`);
  }
  assert.deepEqual(bad, [], `发布物里残留占位符：${bad}`);
});

await test('★ 页面引用的相对资源都在发布集合里（否则线上 404、页面白屏）', async () => {
  const files = Object.fromEntries(await Promise.all(SITE_FILES.map(async (f) => [f, await read(f)])));
  assert.deepEqual(findMissingAssets(files), []);
});

await test('★ 发布出去的脚本没有 import 发布集合之外的文件（否则模块加载失败、整页空白）', async () => {
  const files = Object.fromEntries(await Promise.all(SITE_FILES.map(async (f) => [f, await read(f)])));
  assert.deepEqual(findMissingImports(files), []);
});

await test('★ 上面那条确实能抓到"import 越出站点根"（它漏过一次，真出过线上故障）', () => {
  // 复现当时那一版：`assets/trend.js` 里 import 了 `../../../src/site/boards.js`。
  // src/site/ 从来不在发布集合里，浏览器会请求 /src/site/boards.js → 404 →
  // 整个 trend.js 不执行，所有榜单页空白；而构建/测试按文件系统路径 import，
  // 本地怎么跑都成功 —— 这就是需要这个函数盯着的原因。
  const broken = {
    'assets/trend.js': `import { x } from '../../../src/site/boards.js';\nexport { x } from '../../../src/site/boards.js';\n`,
    'assets/ui.js': `import { y } from './nope.js';\n`,
    'assets/i18n.js': `import { z } from './boards.js';\n`,
    'assets/boards.js': 'export const BOARD_IDS = [];\n',
  };
  const found = findMissingImports(broken);
  // trend.js 里有**两行**指向那个不存在的文件（`import` 与 `export … from`
  // 各算一处 —— 两处都得改，所以不去重），加 ui.js 一行，共三处。
  assert.equal(found.length, 3, `应当报三处，实得：${JSON.stringify(found)}`);
  assert.equal(found.filter((f) => f.includes('越出站点根')).length, 2, '越出站点根的两行没都报出来');
  assert.ok(found.some((f) => /nope\.js/.test(f)), '没报出 assets/ui.js 里那个不存在的同级文件');
});

await test('★ 注释里的路径示例不会被误判成 import（否则门禁天天误报，人就不看了）', () => {
  // 本站的注释里满是 `src/site/boards.js` 这种示例路径。它们行首是 `*`，
  // 不该被当成 import 语句 —— 误报会训练人忽略门禁。
  const files = {
    'assets/trend.js': `/**\n * 见 src/site/boards.js 与 ../../../src/site/gtm.js\n */\nimport { a } from './ui.js';\n`,
    'assets/ui.js': 'export function icon() {}\n',
  };
  assert.deepEqual(findMissingImports(files), []);
});

await test('发布集合里没有测试文件、也没有隐藏文件', async () => {
  const files = Object.fromEntries(SITE_FILES.map((f) => [f, '']));
  assert.deepEqual(findForbidden(files), []);
  assert.equal(SITE_FILES.some((f) => f.endsWith('.test.js')), false);
});

await test('构建产出 .nojekyll（不让 GitHub Pages 的 Jekyll 插手产物）', async () => {
  await fs.access(path.join(built.outDir, '.nojekyll'));
});

await test('构建会拒绝引用不存在的资源（校验本身有效，不是永远通过）', async () => {
  const broken = { 'index.html': '<link rel="stylesheet" href="nope.css">' };
  assert.deepEqual(findMissingAssets(broken), ['index.html → nope.css']);
});

/* ---------------- 4. 相对路径 ---------------- */

await test('★ 页面里没有以 / 开头的资源引用（否则挂在 /<仓库>/ 子路径下会整站失效）', async () => {
  const bad = [];
  for (const rel of ALL_PAGES) {
    const html = await read(rel);
    for (const m of html.matchAll(/(?:href|src)="(\/[^"]*)"/g)) bad.push(`${rel}: ${m[1]}`);
  }
  assert.deepEqual(bad, [], `出现了站根绝对路径：\n      ${bad.join('\n      ')}`);
});

await test('每个页面都用 <base href="./"> 把相对路径钉在自己的目录上', async () => {
  for (const rel of ALL_PAGES) {
    assert.match(await read(rel), /<base href="\.\/">/, `${rel} 缺 base 标签`);
  }
});

/* ---------------- 5. 品牌名唯一来源 ---------------- */

/**
 * 品牌名与页头导航都是**构建期**落值的，所以这两条断言看的是**发布物**
 * （`distRead`），不是源页面 —— 源页面里现在只有 `{{SITE_NAV}}`，
 * 对着它断言等于在问"生成器之外的另一个副本对不对"，而那正是要消灭的东西。
 */
await test('★ 发布物的标题不是写死的，来自 {{BRAND}} 与构建期导航', async () => {
  for (const rel of ALL_PAGES) {
    const src = await read(rel);
    // 源页面里应当**有**占位符：写死品牌名就等于多了一份来源。
    assert.match(src, /\{\{BRAND\}\}/, `${rel} 源页面没有 {{BRAND}} 占位符`);
    assert.match(src, /\{\{SITE_NAV\}\}/, `${rel} 源页面没有 {{SITE_NAV}} 占位符`);

    // 发布物里品牌必须已经落成真值。
    //
    // ★ 页头**没有**品牌位了：那里只剩「首页」与语言切换（榜单在首页的入口卡片里，
    //   见 `src/site/nav.js`）。品牌因此只出现在 <title> 里，下面这条就是它唯一
    //   的门禁 —— 盯的两件事：含品牌、且没有残留占位符。
    //   <title> 里品牌的位置因页而异（首页是「Trend · AI 趋势大盘」，面板页是
    //   「热门模型 · Trend」），规定位置等于把排版钉死；这里要防的是**写死第二份品牌名**。
    const html = await distRead(rel);
    const title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1];
    assert.ok(title, `${rel} 发布物里没有 <title>`);
    assert.ok(title.includes(BRAND), `${rel} 的标题里没有 ${BRAND}：${title.trim().slice(0, 60)}`);
    assert.doesNotMatch(title, /\{\{/, `${rel} 的标题里残留占位符：${title.trim().slice(0, 60)}`);
  }
});

/* ---------------- 6 & 7. 语言 ---------------- */

await test('★ 英文页里不得出现中文（只有语言切换那个链接是有意的例外）', async () => {
  const bad = [];
  for (const rel of PAGES.en) {
    // 去掉那个有意的「中文」链接（它用的是 `中文</a>`）再检查：
    // 其余任何汉字都是漏译或串页
    const text = visibleText(await read(rel)).split('中文').join('');
    const hit = text.match(/[一-鿿]+/g);
    if (hit) bad.push(`${rel}: ${[...new Set(hit)].slice(0, 8).join(' ')}`);
  }
  assert.deepEqual(bad, [], `英文页里混进了中文：\n      ${bad.join('\n      ')}`);
});

await test('★ 中文页里没有整段英文文案（导航的语言切换链接除外）', async () => {
  const bad = [];
  for (const rel of PAGES.zh) {
    const text = visibleText(await read(rel)).split('English').join('');
    // 只揪"看起来像句子的英文"（连续三个以上英文单词），放过 HTML/属性/标识符
    for (const m of text.matchAll(/[A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){3,}/g)) {
      bad.push(`${rel}: ${m[0].trim().slice(0, 60)}`);
    }
  }
  assert.deepEqual(bad, [], `中文页里混进了英文：\n      ${bad.join('\n      ')}`);
});

await test('★ <html lang> 与页面语言一致（面板文案按它取字典，错了整页串语言）', async () => {
  for (const rel of PAGES.zh) {
    assert.match(await read(rel), /<html lang="zh-CN">/, `${rel} 的 lang 不是 zh-CN`);
  }
  for (const rel of PAGES.en) {
    assert.match(await read(rel), /<html lang="en">/, `${rel} 的 lang 不是 en`);
  }
});

await test('双语互链：每个页面都有指向另一语言的链接', async () => {
  // 首页那一对是目录语义（`en/` 与 `../`）；面板页逐页对应，由上面专门那条盯着。
  // 链接由构建期生成的页头导航落下，所以看发布物。
  const expect = { 'index.html': 'en/', 'en/index.html': '../' };
  for (const [rel, target] of Object.entries(expect)) {
    assert.match(
      await distRead(rel),
      new RegExp(`href="${target.replace(/[.]/g, '\\.')}"`),
      `${rel} 没有指向 ${target}`
    );
  }
});

await test('★ 首页每张入口卡片都是 <a>（整块可点、键盘一次 Tab 就到）', async () => {
  // 这条盯的是一个**看不出来的**退化：把 `<a class="entry">` 换成
  // `<div class="entry">`，样式一模一样，但既点不动、也 Tab 不到 ——
  // 页面看起来完全正常，只有用键盘或读屏器的人发现进不去大盘。
  const bad = [];
  for (const rel of [PAGES.zh[0], PAGES.en[0]]) {
    const html = await read(rel);
    // 抓**完整的开标签**再过滤：`href` 在 `class` 前后都可能出现，
    // 只匹配到 class 就收尾会漏掉 href，把正确的页面判成缺陷。
    const opens = (html.match(/<(?:a|div)\b[^>]*>/g) || []).filter((tag) => /\bclass="entry"/.test(tag));
    if (opens.length < 2) bad.push(`${rel}: 没找到入口卡片（${opens.length}）`);
    for (const tag of opens) {
      if (!tag.startsWith('<a')) bad.push(`${rel}: 入口卡片不是链接 —— ${tag}`);
      else if (!/\bhref="[^"]+"/.test(tag)) bad.push(`${rel}: 入口卡片没有 href —— ${tag}`);
    }
  }
  assert.deepEqual(bad, [], bad.join('\n      '));
});

await test('★ 首页卡片与面板**一一对应**：每张卡指向自己那一页，不重复、不遗漏', async () => {
  // 这条盯的需求是"不要多个卡片对应一个趋势页面"。
  // 重复的 href 意味着有面板**没有入口** —— 页面上看不出来（卡片数量没变、
  // 名字也都在），只有点进去才发现两张卡到了同一个地方。
  const bad = [];
  for (const rel of [PAGES.zh[0], PAGES.en[0]]) {
    const html = await read(rel);
    const hrefs = [...html.matchAll(/<a class="entry"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
    const wanted = BOARD_IDS.map((id) => `${id}.html`);
    const dup = hrefs.filter((h, i) => hrefs.indexOf(h) !== i);
    if (dup.length) bad.push(`${rel}: 有卡片指向同一页 —— ${[...new Set(dup)].join(' ')}`);
    const missing = wanted.filter((h) => !hrefs.includes(h));
    if (missing.length) bad.push(`${rel}: 这些面板没有入口卡片 —— ${missing.join(' ')}`);
    const extra = hrefs.filter((h) => !wanted.includes(h));
    if (extra.length) bad.push(`${rel}: 有卡片指向了非面板页 —— ${extra.join(' ')}`);
  }
  assert.deepEqual(bad, [], bad.join('\n      '));
});

await test('★ 每个面板页都指名了自己那一个面板，且名字是真的', async () => {
  // data-board 写错时页面**不报错**，只是渲染出空白（或别的面板）。
  // 这里同时核对"写的是合法 id"与"页面文件名与 id 一致"，
  // 后者是地址契约：trending.html 必须跑 trending 面板。
  const bad = [];
  for (const id of BOARD_IDS) {
    for (const rel of [`${id}.html`, `en/${id}.html`]) {
      const html = await read(rel);
      const m = html.match(/<div id="panels" data-board="([^"]+)"><\/div>/);
      if (!m) bad.push(`${rel}: 没有 <div id="panels" data-board="…"></div>`);
      else if (m[1] !== id) bad.push(`${rel}: data-board="${m[1]}" 与文件名不符`);
    }
  }
  assert.deepEqual(bad, [], bad.join('\n      '));
});

await test('★ 每个面板 id 都有名字（页脚导航是动态拼键 `p.<id>.title`，正则扫不到）', () => {
  // 上面那条"被引用的键都存在"靠正则抓 `L('字面量')`，而页脚导航拼的是
  // `L(`p.${id}.title`)` —— 模板字符串躲过扫描。于是新加一个面板 id 却忘了
  // 加 `p.<id>.title` 时，那一页的标题与导航会上线成键名本身（`p.foo.title`）。
  const bad = [];
  for (const id of BOARD_IDS) {
    for (const locale of LOCALES) {
      const key = `p.${id}.title`;
      if (t(locale, key) === key) bad.push(`${locale} 缺 ${key}`);
    }
  }
  assert.deepEqual(bad, [], bad.join('\n      '));
});

await test('★ 发布集合里的面板页与 BOARD_IDS 完全对齐（少了线上 404，多了构建失败）', () => {
  const expected = [
    ...BOARD_IDS.map((id) => `${id}.html`),
    ...BOARD_IDS.map((id) => `en/${id}.html`),
  ];
  const actual = SITE_FILES.filter((f) => f.endsWith('.html') && f !== 'index.html' && f !== 'en/index.html');
  assert.deepEqual(actual.sort(), expected.sort());
});

await test('★ 每个面板页都有指向它自己的英文版 / 中文版', async () => {
  const bad = [];
  for (const id of BOARD_IDS) {
    if (!(await distRead(`${id}.html`)).includes(`href="en/${id}.html"`)) bad.push(`${id}.html 没有指向 en/${id}.html`);
    if (!(await distRead(`en/${id}.html`)).includes(`href="../${id}.html"`)) bad.push(`en/${id}.html 没有指向 ../${id}.html`);
  }
  assert.deepEqual(bad, [], bad.join('\n      '));
});

await test('语言切换链接带地球图标，与普通导航项有区分的类名', async () => {
  for (const rel of ALL_PAGES) {
    assert.match(
      await distRead(rel),
      /<a class="lang"[^>]*>[\s\S]*?data-icon="globe"/,
      `${rel} 的语言切换链接没有 lang 类或地球图标`
    );
  }
});

/**
 * 页头导航是**构建期**生成的，所以它自己的性质要单独盯住。
 *
 * 它只有两样：左边「首页」（指向本语言的首页），右边语言切换。
 * 上面那条"语言切换指向对应榜单页"already 盯着切换的目标，这里盯它的**组成**：
 * 页头不许再长出别的链接 —— 榜单入口在首页的卡片里，页头多一条就是同一个目录
 * 出现两次，而且按 id 硬推链接的写法（下拉菜单）已经没有调用方了。
 */
await test('★ 页头导航只有「首页」与语言切换两项，且首页指向本语言的首页', async () => {
  const bad = [];
  for (const rel of ALL_PAGES) {
    const html = await distRead(rel);
    // 取**整条页头**（header-inner）而不是 `<nav class="site-nav">`：
    // 「首页」是页头左侧的元素、`<nav>` 的兄弟，只看 nav 会把它整个漏掉。
    const header = html.match(/<div class="wrap header-inner">([\s\S]*?)<\/div>/)?.[1] ?? '';
    if (!header) { bad.push(`${rel}: 没找到页头`); continue; }

    const hrefs = [...header.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    if (hrefs.length !== 2) bad.push(`${rel}: 页头有 ${hrefs.length} 个链接，应为 2（首页 + 语言切换）`);

    // 首页链接指向本语言的首页，不是对方语言的（那是语言切换的活）
    const isEn = rel.startsWith('en/');
    const home = header.match(/<a class="nav-home" href="([^"]+)"/)?.[1];
    const want = isEn ? '../index.html' : 'index.html';
    if (home !== want) bad.push(`${rel}: 首页链接是 ${home}，应为 ${want}`);

    // 首页页面上，首页链接要带 aria-current（读屏器靠它播报"当前页"）；
    // 榜单页上不该带 —— 那是别的页面。
    const isHome = rel === 'index.html' || rel === 'en/index.html';
    const current = /<a class="nav-home"[^>]*aria-current="page"/.test(header);
    if (isHome !== current) bad.push(`${rel}: aria-current ${current ? '多了' : '少了'}`);

    // 下拉菜单是上一版的东西，必须彻底消失（有 .nav-boards 就说明模板还留着）
    if (/nav-boards/.test(html)) bad.push(`${rel}: 还有榜单下拉的痕迹`);
  }
  assert.deepEqual(bad, [], bad.join('\n      '));
});

await test('★ 导航里没有残留的占位符，且语言切换仍是链接', async () => {
  for (const rel of ALL_PAGES) {
    const html = await distRead(rel);
    assert.doesNotMatch(html, /\{\{SITE_NAV\}\}/, `${rel} 的导航占位符没被替换`);
    assert.match(html, /<a class="lang" href="[^"]+"/, `${rel} 的语言切换不是链接`);
  }
});

await test('★ 构建拒绝把产物目录设成仓库根或其祖先（否则会删掉源码）', () => {
  const root = path.resolve('/repo');
  assert.equal(assertSafeOutDir('/repo/dist', root), path.resolve('/repo/dist'));
  assert.throws(() => assertSafeOutDir('/repo', root), /仓库根目录/);
  // 文件系统根是所有路径的祖先，但它不以 `${root}/` 开头 —— 单独这条判据盯着它
  assert.throws(() => assertSafeOutDir('/', root), /文件系统根/);
  // 仓库的祖先目录（例如仓库在 /repo/site，产物目录传成 /repo）
  assert.throws(() => assertSafeOutDir('/repo', path.resolve('/repo/site')), /仓库的祖先目录/);
  assert.throws(() => assertSafeOutDir('/repo/.git', root), /\.git/);
});

/* ---------------- 8. 本地预览服务器 ---------------- */

await test('★ 预览服务器挡住路径穿越，且目录请求回落到 index.html', () => {
  const dist = path.resolve('/srv/dist');
  assert.equal(resolveRequest(dist, '/../../etc/passwd'), null);
  assert.equal(resolveRequest(dist, '/en/'), path.join(dist, 'en', 'index.html'));
  assert.equal(resolveRequest(dist, '/eval.html?x=1'), path.join(dist, 'eval.html'));
  // 不做美化 URL：GitHub Pages 不会把 /eval 映射到 eval.html，
  // 本地也不该映射 —— 否则链接写错了本地还看得见，线上却是 404
  assert.equal(resolveRequest(dist, '/eval'), path.join(dist, 'eval'));
});

await fs.rm(tmp, { recursive: true, force: true });

console.log(`\n  通过 ${pass} 失败 ${process.exitCode ? 1 : 0}\n`);
