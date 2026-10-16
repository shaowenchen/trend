/**
 * 主题切换的纯逻辑测试（`assets/theme.js`）。
 *
 * 本文件不碰真实 DOM，也不碰真实存储：`theme.js` 的读写函数都用
 * "取不到就回落跟随系统"的写法，所以这里直接跑模块级导出即可 ——
 * 与 `ui.test.js` 同一个路数（本站零依赖，不引 jsdom）。
 *
 * ## 为什么值得测（它坏了不会报错）
 * 主题这条链路上有三种"静默坏掉"，页面上都不报错：
 *   ① **循环断了** —— 点一下不换、或三态变成两态，"跟随系统"再也回不去；
 *   ② **键名漂移** —— 内联引导脚本（head 里那段）与 `theme.js` 用的
 *      localStorage 键必须一致；不一致的表现只是"选择记不住"；
 *   ③ **引导脚本不再是同步内联** —— 变成 `type="module"` 或挪到样式表之后，
 *      表现是"选了亮色，每次打开仍先闪一帧深色"。
 * 前两条在这里测；第三条在 `site.test.js` 里对着**发布物**测
 * （那是唯一能看见"脚本摆在样式表前还是后"的地方）。
 */
import assert from 'node:assert/strict';
import {
  THEME_BTN_ID,
  THEME_CYCLE,
  THEME_ICON,
  THEME_KEY,
  THEME_TEXT_KEY,
  bootSnippet,
  nextTheme,
  normalizeTheme,
  readTheme,
  writeTheme,
} from './theme.js';
import { ICONS } from './ui.js';
import { LOCALES, t } from './i18n.js';

let pass = 0;
const test = (name, fn) => {
  try {
    fn();
    pass += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n    ${e.message}`);
    process.exitCode = 1;
  }
};

console.log('\ntheme.js 测试（主题切换）');

/* ---------------- 三态循环 ---------------- */

test('★ 三态：system → light → dark → system 能转回来', () => {
  assert.deepEqual(THEME_CYCLE, ['system', 'light', 'dark']);
  assert.equal(nextTheme('system'), 'light');
  assert.equal(nextTheme('light'), 'dark');
  // ★ 这一条是关键：点三下必须回到原点，否则"跟随系统"就再也回不去了
  assert.equal(nextTheme('dark'), 'system');
  assert.equal(nextTheme(nextTheme(nextTheme('system'))), 'system');
});

test('nextTheme：非法/缺失的当前值一律当作"跟随系统"，而不是死循环或返回 undefined', () => {
  for (const bad of [null, undefined, '', 'Light', 'DARK', 'auto', 0, {}]) {
    assert.equal(nextTheme(bad), 'light', `${JSON.stringify(bad)} 的下一个应是 light`);
  }
});

test('normalizeTheme：只有三个合法值能通过，其余回落跟随系统', () => {
  for (const v of THEME_CYCLE) assert.equal(normalizeTheme(v), v);
  for (const bad of [null, undefined, '', 'light ', 'Light', 'auto', 'darkmode']) {
    assert.equal(normalizeTheme(bad), 'system', `${JSON.stringify(bad)} 应回落 system`);
  }
});

/* ---------------- 每一态都有图标与文案 ---------------- */

test('★ 三态各有图标，且都是 ui.js 里现成的键（未登记的名字会让 icon() 抛错）', () => {
  for (const theme of THEME_CYCLE) {
    const name = THEME_ICON[theme];
    assert.ok(name, `${theme} 缺图标`);
    assert.ok(ICONS[name], `${theme} 的图标 ${name} 不在 ICONS 里`);
  }
  // 三个图标互不相同 —— 相同的话切换时看不出变化（"点了没反应"的观感）
  const used = THEME_CYCLE.map((x) => THEME_ICON[x]);
  assert.equal(new Set(used).size, used.length, '三态用了重复的图标');
});

test('★ 三态各有文案，两种语言都非空且不含未替换的键名', () => {
  for (const theme of THEME_CYCLE) {
    const key = THEME_TEXT_KEY[theme];
    for (const loc of LOCALES) {
      const v = t(loc, key);
      assert.notEqual(v, key, `${loc} 缺 ${key}`);
      assert.ok(String(v).trim().length > 0, `${loc} 的 ${key} 是空的`);
    }
  }
});

test('主题的名称与提示文案在两种语言下都在', () => {
  for (const key of ['theme.name', 'theme.hint']) {
    for (const loc of LOCALES) assert.notEqual(t(loc, key), key, `${loc} 缺 ${key}`);
  }
  // 提示里要能插进"下一个状态"的名字 —— 否则按钮悬停提示说不出点下去会变成什么
  assert.match(t('zh', 'theme.hint', { next: '亮色' }), /亮色/);
  assert.match(t('en', 'theme.hint', { next: 'light' }), /light/);
});

/* ---------------- 存储（Node 下没有 localStorage，正好测"读不了就回落"） ---------------- */

test('★ 存储不可用时读回落"跟随系统"、写不抛错（隐私模式/阻止 Cookie 的浏览器）', () => {
  // Node 里没有 localStorage；若实现把属性访问放在 try 之外，这里会直接抛
  assert.equal(readTheme(), 'system');
  assert.doesNotThrow(() => writeTheme('dark'));
  assert.doesNotThrow(() => writeTheme('system'));
});

/* ---------------- 引导脚本 ---------------- */

test('★ 引导脚本用的键与 theme.js 是同一个（键名漂移会让选择"记不住"）', () => {
  const src = bootSnippet();
  assert.ok(
    src.includes(JSON.stringify(THEME_KEY)),
    `引导脚本里没有 ${JSON.stringify(THEME_KEY)}：${src}`
  );
});

test('★ 引导脚本只认 light/dark —— "跟随系统"就是什么都不写', () => {
  const src = bootSnippet();
  assert.match(src, /'light'/);
  assert.match(src, /'dark'/);
  // 不该出现 'system'：那会往 data-theme 上写一个 CSS 不认识的态，
  // 于是媒体查询被 :not([data-theme]) 挡掉、系统偏好彻底失效
  assert.ok(!src.includes("'system'"), `引导脚本不该处理 system：${src}`);
  assert.ok(!src.includes('data-theme="system"'), '不该写出 data-theme="system"');
});

test('★ 引导脚本整段包 try（存储被拦时静默跳过，而不是让页面脚本报错）', () => {
  const src = bootSnippet();
  assert.match(src, /^try\{/, '开头不是 try{');
  assert.match(src, /catch\(e\)\{\}$/, '结尾不是 catch(e){}');
});

test('★ 引导脚本不含 import/export/await（它必须是同步内联脚本，不能是 module）', () => {
  const src = bootSnippet();
  for (const bad of [/\bimport\b/, /\bexport\b/, /\bawait\b/]) {
    assert.doesNotMatch(src, bad, `引导脚本里出现了 ${bad}`);
  }
});

test('按钮 id 是固定值（构建期落的 HTML 与运行时按 id 找按钮，两边要对上）', () => {
  assert.equal(THEME_BTN_ID, 'theme-toggle');
});

console.log(`\n  通过 ${pass} 失败 ${process.exitCode ? 1 : 0}\n`);
