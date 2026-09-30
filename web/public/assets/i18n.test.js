/**
 * 字典自检 —— 这个文件存在的唯一理由是**在提交前抓住漏翻译**。
 *
 * 双语站最容易出现的坏法不是崩溃，而是"英文页里掺着中文行"：
 * 页面看起来正常，只有英文用户会发现。而且它一旦上线就没人再回头查。
 * 所以这里逐键断言两侧都有值、且英文侧确实不是中文。
 */
import assert from 'node:assert/strict';
import { LOCALES, DEFAULT_LOCALE, DICT, t, keysOf } from './i18n.js';

let pass = 0;
const t_ = (name, fn) => {
  try {
    fn();
    pass += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n    ${e.message}`);
    process.exitCode = 1;
  }
};

console.log('\ni18n 字典测试');

const zhKeys = keysOf('zh');
const enKeys = keysOf('en');

t_('★ 两种语言的键完全一致（缺一个键就是一处漏翻译）', () => {
  const missingEn = zhKeys.filter((k) => !enKeys.includes(k));
  const missingZh = enKeys.filter((k) => !zhKeys.includes(k));
  assert.deepEqual(missingEn, [], `en 缺这些键：${missingEn}`);
  assert.deepEqual(missingZh, [], `zh 缺这些键：${missingZh}`);
});

t_('★ 每个键在两种语言下都非空', () => {
  for (const locale of LOCALES) {
    for (const k of keysOf(locale)) {
      const v = t(locale, k);
      assert.ok(v && v.length > 0, `${locale} 的 ${k} 是空的`);
      assert.notEqual(v, k, `${locale} 的 ${k} 取不到值（返回了键名本身）`);
    }
  }
});

t_('★ 英文侧不得含中日韩字符（漏译会在这里现形）', () => {
  // 这一版没有例外：原来放行的 nav.langSwitch（英文页上的「中文」链接）
  // 已经写进页面骨架，不再经过字典 —— 所以英文侧应当**一个汉字都没有**。
  const bad = [];
  for (const k of enKeys) {
    const v = t('en', k);
    if (/[一-鿿぀-ヿ]/.test(v)) bad.push(`${k} = ${v}`);
  }
  assert.deepEqual(bad, [], `英文里混进了中文：\n      ${bad.join('\n      ')}`);
});

t_('语言切换标签已移出字典：双语链接现在写在页面骨架里', () => {
  // 不是"随便删了个键"，而是这个键**不该**再回来：它一旦回来，就说明
  // 页面骨架又开始依赖运行时的文案注入，而本站是纯静态、没有这一层。
  assert.equal(t('zh', 'nav.langSwitch'), 'nav.langSwitch');
  assert.equal(t('en', 'nav.langSwitch'), 'nav.langSwitch');
});

t_('LOCALES 恰好是 zh/en，默认语言是 zh', () => {
  assert.deepEqual(LOCALES, ['zh', 'en']);
  assert.equal(DEFAULT_LOCALE, 'zh');
  // 这里原来还断言 HREFLANG 有 zh/en 两个键。本站没有 hreflang（纯静态、
  // 没有绝对地址可用），那个常量已随注释一并删除 —— 见 i18n.js 里的说明。
});

t_('t()：插值替换，未提供的占位符原样保留（便于发现问题）', () => {
  assert.equal(t('zh', 'st.progress', { got: 1, done: 2, total: 3 }), '已取 1 行 · 2/3 页');
  assert.equal(t('en', 'st.progress', { got: 1, done: 2, total: 3 }), '1 rows · 2/3 pages');
  // 漏传变量时保留 {name}，而不是变成 "undefined"
  assert.match(t('zh', 'st.progress', { got: 1 }), /\{done\}/);
});

t_('t()：未知语言回落到默认语言；未知键返回键名', () => {
  assert.equal(t('fr', 'nav.home'), t('zh', 'nav.home'));
  assert.equal(t('en', 'no.such.key'), 'no.such.key');
});

t_('全部插值占位符在两种语言下**同名同数**（不然替换会漏）', () => {
  const vars = (s) => [...new Set((s.match(/\{(\w+)\}/g) || []))].sort();
  const bad = [];
  for (const k of zhKeys) {
    const a = vars(t('zh', k));
    const b = vars(t('en', k));
    if (a.length !== b.length || a.some((x, i) => x !== b[i])) {
      bad.push(`${k}: zh${JSON.stringify(a)} vs en${JSON.stringify(b)}`);
    }
  }
  assert.deepEqual(bad, [], `占位符不一致：\n      ${bad.join('\n      ')}`);
});

t_('字典里没有不再被引用的骨架键（服务端注入那一层已经不存在）', () => {
  // site.* / nav.* / hero.* / home.* 只服务于服务端渲染的页面骨架；
  // 本站的骨架是手写静态文件，这些键没有调用方，留着就是死键。
  // hero.refreshing / hero.refreshed 是**例外**：它们由 trend.js 在客户端用。
  const ORPHAN_PREFIXES = ['site.', 'nav.', 'home.'];
  const CLIENT_HERO_KEYS = ['hero.refreshing', 'hero.refreshed'];
  const dead = zhKeys.filter(
    (k) =>
      (ORPHAN_PREFIXES.some((p) => k.startsWith(p)) ||
        (k.startsWith('hero.') && !CLIENT_HERO_KEYS.includes(k)))
  );
  assert.deepEqual(dead, [], `页面已不存在却仍有这些键：${dead}`);
});

console.log(`\n  通过 ${pass} 失败 ${process.exitCode ? 1 : 0}\n`);
