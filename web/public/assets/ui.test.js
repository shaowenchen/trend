/**
 * ui.js 的纯逻辑测试：图标表 + 占位回填。
 *
 * 为什么不测主题：主题切换按钮已于 2026-09-23 按 owner 要求去掉，
 * 配色改为**只跟随系统**（CSS 的 prefers-color-scheme 直接生效，不经 JS）。
 * 所以这里只剩图标这一件事 —— 它是页面所有面板与按钮的图形来源。
 *
 * 本文件不碰真实 DOM：`injectIcons()` 接一个 root 参数，
 * 测试传一个最小桩进去，就能验证"回填"这件事本身，
 * 不必引 jsdom（本站零依赖）。
 */
import assert from 'node:assert/strict';
import { ICONS, icon, injectIcons } from './ui.js';

let pass = 0;
const t = (name, fn) => {
  try {
    fn();
    pass += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n    ${e.message}`);
    process.exitCode = 1;
  }
};

console.log('\nui.js 测试（图标）');

t('每个图标都渲染出成对的 svg 标签与 currentColor', () => {
  for (const name of Object.keys(ICONS)) {
    const svg = icon(name);
    assert.match(svg, /^<svg /, `${name} 不是 svg 开头`);
    assert.match(svg, /<\/svg>$/, `${name} 没有闭合`);
    // 跟随主题色：换配色时不需要为每个图标再写一套
    assert.match(svg, /stroke="currentColor"/, `${name} 没跟随主题色`);
    // 描边风格要求 fill=none，否则会变成一个实心黑块盖住背景
    assert.match(svg, /fill="none"/, `${name} 缺 fill=none`);
    assert.ok(!svg.includes('undefined'), `${name} 里有 undefined`);
  }
});

t('每个图标都有无障碍标签（读屏器要念得出名字）', () => {
  for (const [name, it] of Object.entries(ICONS)) {
    assert.ok(it.label && it.label.length > 0, `${name} 缺 label`);
  }
});

t('未知图标名应当抛错，而不是静默渲染空白', () => {
  assert.throws(() => icon('no-such-icon'), /未知图标/);
});

t('图标名唯一可查（表里没有重复键，count 与实际条目一致）', () => {
  const names = Object.keys(ICONS);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.length >= 11, `图标太少（${names.length}）—— 面板图标是否被误删？`);
});

/* ---------------- 占位回填 ---------------- */

/** 最小 DOM 桩：只实现 injectIcons 用到的两个方法 */
const stub = (name, extra = {}) => ({
  attrs: { 'data-icon': name },
  html: '',
  getAttribute(k) { return this.attrs[k]; },
  insertAdjacentHTML(_pos, h) { this.html = h; },
  ...extra,
});

t('injectIcons：把 [data-icon] 占位换成真实 svg，并返回替换数', () => {
  const el = stub('trophy');
  const n = injectIcons({ querySelectorAll: () => [el] });
  assert.equal(n, 1);
  assert.match(el.html, /<svg/);
  assert.match(el.html, /<svg/, '没产出 svg');
});

t('injectIcons：未知图标名跳过，不抛错也不产空白 svg', () => {
  const el = stub('no-such-icon');
  const n = injectIcons({ querySelectorAll: () => [el] });
  assert.equal(n, 0, '未知图标不该被计入');
  assert.equal(el.html, '', '未知图标不该产出任何东西');
});

t('injectIcons：没有占位时是 0，不报错（首页之外也可能调用）', () => {
  assert.equal(injectIcons({ querySelectorAll: () => [] }), 0);
});

console.log(`\n  通过 ${pass} 失败 ${process.exitCode ? 1 : 0}\n`);
