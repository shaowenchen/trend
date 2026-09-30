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
import { BRAND, findUnresolvedPlaceholders } from '../../../src/site/brand.js';
import { buildSite, SITE_FILES, findMissingAssets, findForbidden, assertSafeOutDir } from '../../../scripts/build-site.mjs';
import { resolveRequest } from '../../../scripts/serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PUBLIC = path.join(ROOT, 'web', 'public');

/** 发布集合里的 HTML 页面（中文两个 + 英文两个） */
const PAGES = { zh: ['index.html', 'trend.html'], en: ['en/index.html', 'en/trend.html'] };
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

await test('★ 页面里不写死品牌名，一律用 {{BRAND}} 占位', async () => {
  for (const rel of ALL_PAGES) {
    const html = await read(rel);
    // 页面上应当**有**占位符：构建期才落成真值，这里写死就等于多了一份来源
    assert.match(html, /\{\{BRAND\}\}/, `${rel} 没有 {{BRAND}} 占位符`);

    // 只看**品牌出现的位置** —— `<a class="brand">` 与 <title>。
    // 为什么不扫全页文本：本站的品牌名是 `trend`，而 "trend" 本身是个正常的英文词
    // （英文首页的 "Open the trend board" 就是正文），全页扫描会一直误报，
    // 而误报会训练人忽略门禁。要盯的风险是"有人把品牌名另行写死在页头/标题里"，
    // 这两个位置正好覆盖它。
    const spots = [
      ...html.matchAll(/<a[^>]*class="brand"[^>]*>([\s\S]*?)<\/a>/g),
      ...html.matchAll(/<title>([\s\S]*?)<\/title>/g),
    ];
    assert.ok(spots.length >= 2, `${rel} 没找到页头品牌位与标题`);
    for (const m of spots) {
      assert.match(m[1], /\{\{BRAND\}\}/, `${rel} 的品牌位写死了：${m[1].trim().slice(0, 60)}`);
    }
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
  const expect = { 'index.html': 'en/', 'trend.html': 'en/trend.html', 'en/index.html': '../', 'en/trend.html': '../trend.html' };
  for (const [rel, target] of Object.entries(expect)) {
    assert.match(await read(rel), new RegExp(`href="${target.replace(/[.]/g, '\\.')}"`), `${rel} 没有指向 ${target}`);
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

await test('语言切换链接带地球图标，与普通导航项有区分的类名', async () => {
  for (const rel of ALL_PAGES) {
    assert.match(
      await read(rel),
      /<a class="lang"[^>]*>[\s\S]*?data-icon="globe"/,
      `${rel} 的语言切换链接没有 lang 类或地球图标`
    );
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
  assert.equal(resolveRequest(dist, '/trend.html?x=1'), path.join(dist, 'trend.html'));
  // 不做美化 URL：GitHub Pages 不会把 /trend 映射到 trend.html，
  // 本地也不该映射 —— 否则链接写错了本地还看得见，线上却是 404
  assert.equal(resolveRequest(dist, '/trend'), path.join(dist, 'trend'));
});

await fs.rm(tmp, { recursive: true, force: true });

console.log(`\n  通过 ${pass} 失败 ${process.exitCode ? 1 : 0}\n`);
