#!/usr/bin/env node
/**
 * 构建：把**该发布的文件**从 `web/public/` 复制到 `dist/`，落掉 `{{…}}` 占位符。
 *
 * ## 为什么这一步存在（GitHub Pages 明明可以直接发仓库目录）
 * 有两个理由，都不是"想加构建步骤"：
 *
 *  1. **占位符必须落成真值。** 品牌名（`src/site/brand.js`）与 GTM 容器 ID
 *     （`src/site/gtm.js`）各自只有一处来源，页面里写 `{{BRAND}}` / `{{GTM}}`。
 *     站点是纯静态的，没有"响应时"，所以替换只能发生在构建这一步。
 *     发布出去的 HTML 里出现 `{{BRAND}}` 就是缺陷（访客直接看到这串字面量），
 *     构建会为此失败。
 *
 *  2. **发布集合必须是白名单。** `web/public/assets/` 下同时住着运行时脚本与
 *     `*.test.js`。用"排除"式规则（复制一切、排除测试）的话，将来加一个
 *     `foo.local.js`、`.DS_Store`、草稿页，它会**静默上线**。
 *     白名单的失效方式是"新文件不发布"（看得见），排除式的失效方式
 *     是"不该发布的发布了"（看不见）。这里选前者。
 *
 * ## 为什么写 `.nojekyll`
 * GitHub Pages 默认跑 Jekyll。本站不需要它，也不希望它：页面是**手写**的，
 * 多一层我们控制不了的变换，会让"本地打开 dist 看到的"与"线上真正跑的"出现差别。
 * 空的 `.nojekyll` 让 Pages 原样发布 dist/。
 * （Actions 那条路（upload-pages-artifact）本来就是原样打包，这个文件是给
 *  "从分支直接发布"那条路兜底的 —— 两条路都别让 Jekyll 插手。）
 *
 * ## 校验（不通过就非零退出，别把坏产物发上去）
 *   · 任何发布文件里残留 `{{…}}` 占位符 → 失败；
 *   · 页面里引用的相对资源（css / js）不在发布集合里 → 失败
 *     （这是静态站最典型的"白屏"成因：路径写错、文件没复制进去，本地看还好，
 *      线上 404，而页面上什么都不会说）；
 *   · 发布出去的脚本里 `import` 了不在发布集合里的文件 → 失败
 *     （同上，只是另一个解析链：HTML 的 `href`/`src` 之外，ES module 还会
 *      顺着 import 继续取文件。这条曾漏过一次，见 `findMissingImports`）；
 *   · 发布集合里出现 `*.test.js` → 失败。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BRAND, findUnresolvedPlaceholders, injectBrand } from '../src/site/brand.js';
import { injectGtm } from '../src/site/gtm.js';
// 面板 id 的真值住在 `web/public/assets/` 下 —— 浏览器只能拿到发布集合里的文件，
// 所以它必须在浏览器够得着的地方，Node 这边隔着目录引它没问题（见该文件顶部）。
import { BOARD_IDS } from '../web/public/assets/boards.js';
import { injectNav, NAV_PLACEHOLDER } from '../src/site/nav.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 发布集合 —— **白名单**，相对 `web/public/`。
 *
 * 面板页是"一个面板一页"：每个 `assets/boards.js` 里 `BOARD_IDS` 列出的 id
 * 对应一个中文页与一个 `en/` 下的英文页。这份清单必须与它**完全对齐** ——
 * 少登记一页，那一页本地能点、线上 404；多登记一个不存在的 id，构建会因为
 * 读不到文件而失败（`site.test.js` 另有一条断言比对两者）。
 */
const BOARD_PAGES = BOARD_IDS;

export const SITE_FILES = [
  'index.html',
  'site.css',
  'en/index.html',
  'assets/trend.js',
  'assets/boards.js',
  'assets/ui.js',
  'assets/i18n.js',
  ...BOARD_PAGES.map((id) => `${id}.html`),
  ...BOARD_PAGES.map((id) => `en/${id}.html`),
];

/* ================================================================== */
/* 校验                                                                */
/* ================================================================== */

/** 找出残留的占位符标记。返回 `[文件名, 标记]` 列表。 */
export function findPlaceholders(files) {
  const bad = [];
  for (const [rel, text] of Object.entries(files)) {
    for (const marker of findUnresolvedPlaceholders(text)) bad.push([rel, marker]);
  }
  return bad;
}

/**
 * 找出页面里引用的、**不在发布集合里**的相对资源。
 *
 * 跳过这些（它们不是"要存在的文件"）：
 *   · 绝对 URL、协议相对、锚点、`mailto:` 之类的协议链接；
 *   · `<base href>` —— 它指的是**目录**，不是资源；
 *   · 模板占位（`{{…}}`，构建期才落成真值）。
 *
 * 指向**目录**的引用（`./`、`../`、`en/`）按静态托管的目录语义解析成该目录的
 * `index.html` —— 也就是"点这个链接会打开哪个文件"。这正是语言切换链接
 * （`en/index.html` 里的 `../`）能被校验到的原因：它写错一个层级就是 404。
 */
export function findMissingAssets(files) {
  const have = new Set(Object.keys(files));
  const missing = [];
  for (const [rel, text] of Object.entries(files)) {
    if (!rel.endsWith('.html')) continue;
    const dir = path.posix.dirname(rel);
    // <base href> 指目录，不参与"资源是否存在"的校验
    const html = String(text).replace(/<base\b[^>]*>/gi, '');
    for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const raw = m[1].trim();
      if (!raw || /^(https?:)?\/\//.test(raw) || raw.startsWith('#') || /^[a-z]+:/i.test(raw)) continue;
      if (raw.includes('{{')) continue;
      const clean = raw.split(/[?#]/)[0];
      if (!clean) continue;
      const target = resolvePage(dir, clean);
      if (target === null) continue; // 越出站点根：由服务器那条规则处理，这里不管
      if (have.has(target)) continue;
      missing.push(`${rel} → ${raw}`);
    }
  }
  return missing;
}

/**
 * `dir` 目录下的一个相对引用，最终会打开哪个文件。
 * 目录引用补 `index.html`；越出站点根（`../../x`）返回 null。
 */
function resolvePage(dir, ref) {
  const joined = path.posix.normalize(path.posix.join(dir === '.' ? '' : dir, ref));
  if (joined.startsWith('..')) return null;
  const isDirRef = ref.endsWith('/') || joined === '.' || joined === '';
  const file = isDirRef ? path.posix.join(joined, 'index.html') : joined;
  const norm = path.posix.normalize(file).replace(/^\.\//, '');
  return norm === '.' ? 'index.html' : norm;
}

/** 发布集合里不该出现的东西 */
export function findForbidden(files) {
  return Object.keys(files).filter((f) => f.endsWith('.test.js') || path.basename(f).startsWith('.'));
}

/**
 * 找出发布出去的**客户端脚本**里，import/export 指向了非发布文件的那些。
 *
 * ## 为什么这条必须单独有（它漏过一次，整站白屏）
 * 上面 `findMissingAssets` 只看 HTML 的 `href` / `src`。而 ES module 的
 * `import` 是**另一个**解析链：浏览器拿到一个 `assets/*.js`，会按里面的
 * 说明符继续去取它依赖的文件 —— 那个文件不在发布集合里，就 404。
 *
 * 现实里踩到的样子：`assets/trend.js` 曾经写着
 * `import { BOARD_IDS } from '../../../src/site/boards.js'`。
 * `src/site/` 从来不在发布集合里，于是浏览器请求
 * `https://<域名>/src/site/boards.js` → 404 → **整个模块不执行**，
 * 所有榜单页都是一片空白。而本地怎么跑都成功：构建、测试、CI 全都按
 * **文件系统路径** import 那个文件，它就在那儿。
 *
 * 所以这里按**发布物**的视角重算一遍：说明符必须相对本文件解析、且落在
 * 发布集合内。越出站点根（`../../..`）一律算错 —— 那是本地能解析、
 * 线上必然 404 的写法。
 *
 * 只认行首的 import/export 语句（本项目的 import 都是单行，写在行首）。
 * 注释里出现的示例不会被误判：JSDoc 的行首是 `*`。
 */
export function findMissingImports(files) {
  const have = new Set(Object.keys(files));
  const missing = [];
  for (const [rel, text] of Object.entries(files)) {
    if (!rel.endsWith('.js')) continue;
    const dir = path.posix.dirname(rel);
    for (const m of String(text).matchAll(/^[ \t]*(?:import|export)\s[^\n]*?['"]([^'"]+)['"]/gm)) {
      const raw = m[1];
      if (!raw.startsWith('.')) continue; // 裸标识符：无依赖站里不该出现，但也不归这条管
      const target = path.posix.normalize(path.posix.join(dir === '.' ? '' : dir, raw));
      if (target.startsWith('..')) {
        missing.push(`${rel} → ${raw}（越出站点根，浏览器取不到）`);
      } else if (!have.has(target)) {
        missing.push(`${rel} → ${raw}`);
      }
    }
  }
  return missing;
}

/* ================================================================== */
/* 构建                                                                */
/* ================================================================== */

/**
 * 构建前的一道保险：产物目录必须是**一个可以安全清空的子目录**。
 *
 * 为什么值得写：下面有一句 `fs.rm(outDir, {recursive:true})` ——
 * 把 outDir 传成仓库根（或仓库的祖先目录）时，那行会**删掉源码**，
 * 而且是跑完才发现的。这类脚本通常由 CI 或别人传参调用，
 * 不能让一个参数失误造成不可逆的破坏。
 */
export function assertSafeOutDir(outDir, repoRoot) {
  const out = path.resolve(outDir);
  const root = path.resolve(repoRoot);
  if (out === root) throw new Error(`拒绝构建：产物目录不能是仓库根目录（${out}）`);
  // 文件系统根（`/`）是**所有**路径的祖先，但它不以 `${root}/` 开头 ——
  // 单独判一次，否则 `outDir='/'` 会一路走到 fs.rm 把整块盘删掉。
  // （判据是"自己的父目录还是自己"，`/` 与 Windows 的 `C:\` 都成立）
  if (path.dirname(out) === out) throw new Error(`拒绝构建：产物目录不能是文件系统根（${out}）`);
  if (root.startsWith(out + path.sep)) throw new Error(`拒绝构建：产物目录不能是仓库的祖先目录（${out}）`);
  if (path.basename(out) === '.git') throw new Error('拒绝构建：产物目录不能是 .git');
  return out;
}

/**
 * 读发布集合 → 落占位符 → 校验 → 写进 outDir。
 *
 * 顺序是 brand 再 gtm：两者互不引用，但 GTM 那一步会校验容器 ID 形状，
 * 放在后面可以让"品牌名漏替换"这类更常见的问题先报出来。
 * @returns {Promise<{outDir:string, files:string[]}>}
 */
export async function buildSite({ srcDir = path.join(ROOT, 'web', 'public'), outDir = path.join(ROOT, 'dist'), repoRoot = ROOT } = {}) {
  const safeOut = assertSafeOutDir(outDir, repoRoot);
  const files = {};
  for (const rel of SITE_FILES) {
    const buf = await fs.readFile(path.join(srcDir, rel), 'utf8');
    // 页头导航按文件的语言、层级与所属榜单落值：中文页在根、英文页在 `en/` 下，
    // 于是同一份导航要落成两套相对路径；而语言切换要指向**对应的那一页**，
    // 所以还要知道本页是哪个榜单（首页为 null）。见 `src/site/nav.js`。
    const isEn = rel === 'en/index.html' || rel.startsWith('en/');
    const id = path.basename(rel, '.html');
    const boardId = id === 'index' ? null : id;
    const nav = injectNav(buf, isEn ? 'en' : 'zh', isEn ? '../' : '', boardId);
    files[rel] = injectGtm(injectBrand(nav, BRAND));
  }

  const problems = [];
  for (const [rel, marker] of findPlaceholders(files)) {
    problems.push(`${rel} 残留占位符 ${marker}`);
  }
  for (const f of findForbidden(files)) problems.push(`${f} 不该被发布（测试文件 / 隐藏文件）`);
  for (const m of findMissingAssets(files)) problems.push(`引用的资源不在发布集合里：${m}`);
  for (const m of findMissingImports(files)) problems.push(`脚本 import 的文件不在发布集合里：${m}`);
  if (problems.length) {
    throw new Error(`构建校验未通过：\n  · ${problems.join('\n  · ')}`);
  }

  await fs.rm(safeOut, { recursive: true, force: true });
  for (const [rel, text] of Object.entries(files)) {
    const target = path.join(safeOut, rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, text);
  }
  // 见文件头：别让 Jekyll 插手产物
  await fs.writeFile(path.join(safeOut, '.nojekyll'), '');

  return { outDir: safeOut, files: Object.keys(files) };
}

/* CLI */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { outDir, files } = await buildSite();
    const rel = path.relative(ROOT, outDir) || outDir;
    console.log(`\n  构建完成 · ${BRAND} · ${files.length} 个文件 → ${rel}/`);
    for (const f of files) console.log(`    ${f}`);
    console.log('  （+ .nojekyll）\n');
  } catch (e) {
    console.error(`\n  ✗ ${e.message}\n`);
    process.exitCode = 1;
  }
}
