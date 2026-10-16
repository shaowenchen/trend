#!/usr/bin/env node
/**
 * 三张新榜的抓取器/摊平器测试（2026-10-16 新增）。
 *
 * 覆盖三处**最容易静默出错**的逻辑，fixture 全部取自当日真实响应（只裁了条数，
 * 字段逐字保留）：
 *   · `fetch-hn-top.mjs` 的 `normalizeHn` —— 自帖（无 url）必须回落讨论页，
 *     而不是产出一个空链接（页面上"看着能点、点了跳回本页"）；
 *   · `fetch-wiki-attention.mjs` 的 `isAiArticle` —— 词根匹配实测撞到过三类误报
 *     （法国歌手 Claude Nougaro、五月风暴 Mai 68、俄文形容词「Искусственный」），
 *     它们都必须被排掉，而真 AI 词条不能被误伤；
 *   · `fetch-google-trends.mjs` 的 `parseTrendsRss` —— 热度在**命名空间标签**
 *     `<ht:approx_traffic>` 里，且是 '2000+' 这种粗粒度字符串（不能解析成数字）。
 *
 * 另有两条门禁：脚本必须有**直跑守卫**（import 不产生网络副作用），
 * 以及 trend.js 侧的两个纯摊平函数。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeHn } from '../../../scripts/fetch-hn-top.mjs';
import { AI_ARTICLES, PROJECTS, isAiArticle, wikiTitle, wikiUrl } from '../../../scripts/fetch-wiki-attention.mjs';
import { REGIONS, parseTrendsRss } from '../../../scripts/fetch-google-trends.mjs';
import { flattenHnTop, flattenWikiAttention, flattenGoogleTrends } from './trend.js';

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

console.log('\n新榜抓取器测试（2026-10-16）');

/* ---------------- HN 首页 ---------------- */

/** 真实响应片段（2026-10-16 取，字段名逐字保留） */
const HN_HIT = {
  title: 'Muse Spark Open', url: 'https://research.meta.ai/blog/muse-spark-open',
  points: 631, num_comments: 360, created_at: '2026-10-15T17:47:39Z', objectID: '50107379', author: 'bigwheels',
};

t('★ normalizeHn：真实命中 —— 外链、分数、评论、作者都取到', () => {
  const rows = normalizeHn({ hits: [HN_HIT] });
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.title, 'Muse Spark Open');
  assert.equal(r.url, 'https://research.meta.ai/blog/muse-spark-open');
  assert.equal(r.points, 631);
  assert.equal(r.comments, 360);
  assert.equal(r.author, 'bigwheels');
  assert.equal(r.rank, 1, '名次从 1 开始');
});

t('★ normalizeHn：自帖（url 为 null）回落到 HN 讨论页，不产出空链接', () => {
  const ask = { title: 'Ask HN: how do you test this?', url: null, points: null, num_comments: 12, objectID: '50100000', author: 'someone' };
  const rows = normalizeHn({ hits: [ask] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, 'https://news.ycombinator.com/item?id=50100000');
  assert.equal(rows[0].external, '', 'external 是空的（页面据此标"讨论"）');
  // ★ points 为 null 要保留 null —— 0 分与"还没统计"是两件事
  assert.equal(rows[0].points, null, '缺失的分数不能被当成 0');
});

t('normalizeHn：没有标题的条目剔除；连讨论页地址都凑不出的也剔除', () => {
  const rows = normalizeHn({ hits: [
    { title: null, url: 'https://x.example/1', objectID: '1' },
    { title: '有标题但什么都没有', url: null, objectID: null },
  ] });
  assert.equal(rows.length, 0);
});

t('normalizeHn：坏输入不炸（null / 非数组 hits）', () => {
  assert.deepEqual(normalizeHn(null), []);
  assert.deepEqual(normalizeHn({ hits: 'nope' }), []);
});

t('★ flattenHnTop（trend.js 侧）：按 HN 名次排，不依赖数组顺序', () => {
  const snap = { items: [
    { title: 'B', url: 'https://b.example', rank: 2, points: 5, comments: 1, external: 'https://b.example', hnUrl: 'https://news.ycombinator.com/item?id=2' },
    { title: 'A', url: 'https://a.example', rank: 1, points: 9, comments: 2, external: 'https://a.example', hnUrl: 'https://news.ycombinator.com/item?id=1' },
  ] };
  assert.deepEqual(flattenHnTop(snap).map((r) => r.title), ['A', 'B']);
  assert.deepEqual(flattenHnTop(null), []);
});

/* ---------------- 维基关注度 ---------------- */

t('★ isAiArticle：真 AI 词条命中（含各语种）', () => {
  const cases = [
    ['ChatGPT', 'en.wikipedia'], ['Artificial_intelligence', 'en.wikipedia'],
    ['人工智能', 'zh.wikipedia'], ['大型语言模型', 'zh.wikipedia'],
    ['人工知能', 'ja.wikipedia'], ['Künstliche_Intelligenz', 'de.wikipedia'],
    ['Intelligence_artificielle', 'fr.wikipedia'], ['Искусственный_интеллект', 'ru.wikipedia'],
    ['인공지능', 'ko.wikipedia'], ['Anthropic', 'zh.wikipedia'],
  ];
  for (const [title, proj] of cases) {
    assert.ok(isAiArticle(title, proj), `${proj} 的「${title}」应判为 AI`);
  }
});

t('★ isAiArticle：实测撞到过的三类误报必须排掉', () => {
  // ① 人名（fr 榜里真有 Claude Nougaro 这个歌手）
  assert.equal(isAiArticle('Claude_Nougaro', 'fr.wikipedia'), false);
  assert.equal(isAiArticle('Claude_Monet', 'fr.wikipedia'), false);
  // ② 子串误伤（Mai_68 里有 "ai"）
  assert.equal(isAiArticle('Mai_68', 'fr.wikipedia'), false);
  // ③ 俄文的**形容词**「Искусственный」（"人造的"，正是消歧义页）
  assert.equal(isAiArticle('Искусственный', 'ru.wikipedia'), false);
  // ④ 逗号后的限定从句：主题是色情内容，不是 AI
  assert.equal(isAiArticle('Порнография,_сгенерированная_искусственным_интеллектом', 'ru.wikipedia'), false);
});

t('★ isAiArticle：③④ 排掉的同时，白名单与"主角在开头"的条目不能被误伤', () => {
  // Искусственный интеллект 的形容词在**开头且后面跟名词** —— 必须仍然通过
  assert.ok(isAiArticle('Искусственный_интеллект', 'ru.wikipedia'));
  // 白名单里的条目永远通过（哪怕形态特殊）
  for (const [proj, arts] of Object.entries(AI_ARTICLES)) {
    for (const a of arts) assert.ok(isAiArticle(a, proj), `${proj} 白名单条目「${a}」被误伤`);
  }
});

t('isAiArticle：空标题 / 非 AI 词条返回 false，不炸', () => {
  assert.equal(isAiArticle('', 'en.wikipedia'), false);
  assert.equal(isAiArticle(null, 'en.wikipedia'), false);
  assert.equal(isAiArticle('Sydney_Sweeney', 'en.wikipedia'), false);
  assert.equal(isAiArticle('何詩蓓', 'zh.wikipedia'), false);
});

t('wikiTitle / wikiUrl：下划线换空格、去掉消歧义后缀、地址按语种拼', () => {
  assert.equal(wikiTitle('Claude_(语言模型)'), 'Claude');
  assert.equal(wikiTitle('Artificial_intelligence'), 'Artificial intelligence');
  assert.equal(wikiUrl('zh.wikipedia', 'Claude_(语言模型)'), 'https://zh.wikipedia.org/wiki/Claude_(%E8%AF%AD%E8%A8%80%E6%A8%A1%E5%9E%8B)');
  assert.equal(wikiUrl('en.wikipedia', 'ChatGPT'), 'https://en.wikipedia.org/wiki/ChatGPT');
});

t('★ PROJECTS：8 个语种、不重复，且每个都有白名单（没有白名单就只靠词根，容易误判）', () => {
  assert.equal(new Set(PROJECTS).size, PROJECTS.length, '语种重复');
  assert.ok(PROJECTS.length >= 5, `语种太少（${PROJECTS.length}）`);
  for (const p of PROJECTS) assert.ok(Array.isArray(AI_ARTICLES[p]) && AI_ARTICLES[p].length, `${p} 缺白名单`);
});

t('★ flattenWikiAttention（trend.js 侧）：按浏览量降序，trend 缺失保留 null', () => {
  const snap = { sources: [
    { key: 'en', name: 'en', fetchedAt: '2026-10-14', items: [
      { title: 'ChatGPT', url: 'https://en.wikipedia.org/wiki/ChatGPT', views: 56162, trend: 0.95 },
      { title: 'OpenAI', url: 'u2', views: 8941, trend: null },
    ] },
    { key: 'zh', name: 'zh', fetchedAt: '2026-10-14', items: [
      { title: '人工智能', url: 'u3', views: 670, trend: 1.002 },
    ] },
  ] };
  const rows = flattenWikiAttention(snap);
  assert.deepEqual(rows.map((r) => r.views), [56162, 8941, 670]);
  assert.equal(rows[1].trend, null, '没有走势就是 null，不是 1.0');
  // 展示标题去掉了消歧义后缀
  const withParen = flattenWikiAttention({ sources: [{ key: 'zh', name: 'zh', items: [{ title: 'Claude_(语言模型)', url: 'u', views: 775 }] }] });
  assert.equal(withParen[0].label, 'Claude');
});

/* ---------------- Google 趋势 ---------------- */

/** 真实 feed 片段（2026-10-16 取的 US 首条，命名空间标签逐字保留） */
const GT_ITEM = `
		<title>sydney sweeney</title>
		<ht:approx_traffic>2000+</ht:approx_traffic>
		<description/>
		<link>https://trends.google.com/trending/rss?geo=US</link>
		<pubDate>Thu, 15 Oct 2026 19:10:00 -0700</pubDate>
		<ht:picture>https://encrypted-tbn3.gstatic.com/images?q=tbn:abc</ht:picture>
		<ht:picture_source>Fox News</ht:picture_source>
		<ht:news_item>
			<ht:news_item_title>Sydney Sweeney ditches signature blonde locks</ht:news_item_title>
			<ht:news_item_url>https://www.foxnews.com/entertainment/sydney-sweeney</ht:news_item_url>
			<ht:news_item_source>Fox News</ht:news_item_source>
		</ht:news_item>`;

t('★ parseTrendsRss：命名空间标签里的热度要取到，且保留原文（"2000+" 不解析成 2000）', () => {
  const rows = parseTrendsRss(`<rss><channel><item>${GT_ITEM}</item></channel></rss>`, 'US');
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.title, 'sydney sweeney');
  assert.equal(r.traffic, '2000+', '粗粒度热度必须保留原文');
  assert.equal(r.region, 'US');
  assert.equal(r.rank, 1);
  assert.ok(r.newsTitle.length > 0 && r.newsUrl.startsWith('https://'), '相关新闻取到');
  assert.match(r.pubDate, /2026/);
});

t('parseTrendsRss：条数即名次（1,2,3…），无标题的条目剔除，空输入不炸', () => {
  const xml = `<rss><channel>
    <item><title>a</title><ht:approx_traffic>100+</ht:approx_traffic></item>
    <item><ht:approx_traffic>100+</ht:approx_traffic></item>
    <item><title>b</title><ht:approx_traffic>200+</ht:approx_traffic></item>
  </channel></rss>`;
  const rows = parseTrendsRss(xml, 'HK');
  assert.deepEqual(rows.map((r) => r.title), ['a', 'b']);
  assert.deepEqual(rows.map((r) => r.rank), [1, 2]);
  assert.deepEqual(parseTrendsRss('', 'US'), []);
});

t('parseTrendsRss：XML 实体要还原（Google 的标题里有 &amp; / &#39;）', () => {
  const rows = parseTrendsRss('<rss><channel><item><title>AT&amp;T &#39;down&#39;</title><ht:approx_traffic>100+</ht:approx_traffic></item></channel></rss>', 'US');
  assert.equal(rows[0].title, "AT&T 'down'");
});

t('★ REGIONS：不含 CN（端点对 geo=CN 返回 400，这是事实不是遗漏）', () => {
  const codes = REGIONS.map((r) => r.code);
  assert.ok(!codes.includes('CN'), '不该列 CN：Google 趋势没有中国大陆区域');
  assert.equal(new Set(codes).size, codes.length, '区域码重复');
  // 用户点名的中文内容：HK / TW 必须在
  assert.ok(codes.includes('HK') && codes.includes('TW'), '缺中文区域（HK/TW）');
  for (const r of REGIONS) assert.ok(r.label, `${r.code} 缺显示名`);
});

t('★ flattenGoogleTrends（trend.js 侧）：只取选中区域的块；地区不存在时返回空', () => {
  const snap = { sources: [
    { key: 'US', name: '美国', items: [{ title: 'x', url: 'u', extra: '2000+' }] },
    { key: 'HK', name: '中国香港', items: [{ title: '何詩蓓', url: 'u2', extra: '100+' }, { title: 'y', url: 'u3', extra: '' }] },
  ] };
  assert.deepEqual(flattenGoogleTrends(snap, 'HK').map((r) => r.title), ['何詩蓓', 'y']);
  assert.deepEqual(flattenGoogleTrends(snap, 'US').map((r) => r.rank), [1]);
  assert.deepEqual(flattenGoogleTrends(snap, 'CN'), [], '没有的区块返回空（不炸）');
  assert.deepEqual(flattenGoogleTrends(null, 'US'), []);
});

/* ---------------- 门禁 ---------------- */

t('★ 三个新抓取脚本都有直跑守卫（import 不产生网络副作用）', () => {
  for (const f of ['fetch-hn-top.mjs', 'fetch-wiki-attention.mjs', 'fetch-google-trends.mjs']) {
    assert.match(
      readFileSync(new URL(`../../../scripts/${f}`, import.meta.url), 'utf8'),
      /if \(isMain\)/,
      `${f} 缺直跑守卫`
    );
  }
});

console.log(`\n  通过 ${pass} 失败 ${process.exitCode ? 1 : 0}\n`);
