#!/usr/bin/env node
/**
 * 快照抓取脚本的解析器测试（fetch-ai-news.mjs / fetch-momoyu-hot.mjs）。
 *
 * 为什么单独一个文件：解析器住在 scripts/ 下（页面不解析原始 XML/HTML ——
 * 快照在 CI 侧就解析好了），trend.test.js 只测 web/public/assets 的逻辑。
 * fixture 全部取自 2026-10-01 的真实响应（只裁剪了条数，标记逐字保留）。
 * ★ 两个脚本都有直跑守卫：import 不会触发任何网络请求（有断言盯着）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseRssItems, parseAtomEntries, normalizeHn, normalizeDevTo, normalizeLobsters,
  NEWS_SOURCES,
} from '../../../scripts/fetch-ai-news.mjs';
import { normalizeMomoyu } from '../../../scripts/fetch-momoyu-hot.mjs';

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

console.log('\n快照解析器测试（真实响应 fixture）');

/* ---------------- RSS（TechCrunch / substack 系） ---------------- */

const TC_ITEM = "<item>\n\t\t<title>Google releases Gemini 4 Argon, called its most powerful model yet</title>\n\t\t<link>https://techcrunch.com/2026/09/30/google-releases-gemini-4-argon-called-its-most-powerful-model-yet/</link>\n\t\t\n\t\t<dc:creator><![CDATA[Lucas Ropek]]></dc:creator>\n\t\t<pubDate>Wed, 30 Sep 2026 23:43:07 +0000</pubDate>\n\t\t\t\t<category><![CDATA[AI]]></category>\n\t\t<category><![CDATA[gemini]]></category>\n\t\t<category><![CDATA[Google]]></category>\n\t\t<guid isPermaLink=\"false\">https://techcrunch.com/?p=3172532</guid>\n\n\t\t\t\t\t<description><![CDATA[Google has released its latest Gemini model, marketing it as a workhorse for coding and cybersecurity work. ]]></description>\n\t\t\n\t\t\n\t\t\n\t\t\t</item>";

t('★ parseRssItems：TechCrunch 真实 item —— 标题/链接/日期/作者都取到', () => {
  const rows = parseRssItems(`<rss><channel>${TC_ITEM}</channel></rss>`, 5);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.ok(r.title.length > 10, '标题不该是空的');
  assert.ok(r.url.startsWith('https://techcrunch.com/'), '链接指向 TechCrunch');
  assert.match(r.time, /GMT|\+0000|\d{4}/, '日期存在');
  assert.ok(r.author.length > 0, '作者（dc:creator）存在');
});

t('parseRssItems：CDATA 标题要剥壳，坏条目（无链接）剔除，空输入不炸', () => {
  const rows = parseRssItems(
    '<rss><channel>' +
    '<item><title><![CDATA[Some &lt;AI&gt; news]]></title><link>https://x.example/1</link><pubDate>Wed, 01 Oct 2026 00:00:00 GMT</pubDate></item>' +
    '<item><title>没有链接的条目</title></item>' +
    '</channel></rss>'
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Some <AI> news', 'CDATA 剥壳 + 不再是转义体');
  assert.equal(parseRssItems('').length, 0);
});

/* ---------------- Atom（arXiv / The Verge） ---------------- */

const VERGE_ENTRY = "<entry>\n\t\t\t\n\t\t\t<author>\n\t\t\t\t<name>Jay Peters</name>\n\t\t\t</author>\n\t\t\t\n\t\t\t<title type=\"html\"><![CDATA[Elon Musk’s Grokipedia has a ‘newly refreshed’ design]]></title>\n\t\t\t<link rel=\"alternate\" type=\"text/html\" href=\"https://www.theverge.com/tech/1003068/elon-musk-grokipedia-v-0-3-spacexai\" />\n\t\t\t<id>https://www.theverge.com/?p=1003068</id>\n\t\t\t<updated>2026-09-30T20:23:45-04:00</updated>\n\t\t\t<published>2026-09-30T20:23:45-04:00</published>\n\t\t\t<category scheme=\"https://www.theverge.com\" term=\"AI\" /><category scheme=\"https://www.theverge.com\" term=\"Elon Musk\" /><category scheme=\"https://www.theverge.com\" term=\"News\" /><category scheme=\"https://www.theverge.com\" term=\"Tech\" />\n\t\t\t\t\t\t\t<summary type=\"html\"><![CDATA[Grokipedia, SpaceXAI's AI-powered competitor to Wikipedia, recently started incorporating edits again, and today, it got some design tweaks as part of a v0.3 update, including a new logo and refreshes to its homepage and live edits page. SpaceXAI head of design Benji Taylor calls it a \"newly refreshed Grokipedia.\" Grokipedia's old homepage was pretty much [&#8230;]]]></summary>\n\t\t\t\n\t\t\t\t\t\t\t<content type=\"html\">\n\t\t\t\t\t\t\t\t\t\t\t<![CDATA[\n\n\t\t\t\t\t\t\n<figure>\n\n<img alt=\"\" data-caption=\"\" data-portal-copyright=\"\" data-has-syndication-rights=\"1\" src=\"https://platform.theverge.com/wp-content/uploads/sites/2/2026/09/Screenshot-2026-09-30-at-5.16.09-PM.png?quality=90&#038;strip=all&#038;crop=0,0,100,100\" />\n\t<figcaption>\n\t\t</figcaption>\n</figure>\n<p class=\"wp-block-paragraph\">Grokipedia, SpaceXAI's AI-powered competitor to Wikipedia, recently started <a href=\"https://www.theverge.com/tech/1002448/elon-musk-grokipedia-ai-updating-again\">incorporating edits again</a>, and today, it got some design tweaks as part of a v0.3 update, including a new logo and refreshes to its homepage and live edits page. SpaceXAI head of design Benji Taylor calls it a <a href=\"https://x.com/benjitaylor/status/2105413789256687696\">\"newly refreshed Grokipedia.\"</a></p>\n<p class=\"wp-block-paragraph\">Grokipedia's old homepage was pretty much just a logo and a search bar, but the updated homepage includes a list of featured articles, a list of the most-read articles, and a tracker showing the \"latest edits.\" The new featured list showcases digital representations of books that you can spin around, and the most read section also …</p>\n<p><a href=\"https://www.theverge.com/tech/1003068/elon-musk-grokipedia-v-0-3-spacexai\">Read the full story at The Verge.</a></p>\n\t\t\t\t\t\t]]>\n\t\t\t\t\t\t\t\t\t</content>\n\t\t\t\n\t\t\t\t\t</entry>";
const ARXIV_ENTRY = "<entry>\n    <id>http://arxiv.org/abs/2609.40360v1</id>\n    <title>Semifactual Credit-Augmented Policy Optimization</title>\n    <updated>2026-09-30T17:59:56Z</updated>\n    <link href=\"https://arxiv.org/abs/2609.40360v1\" rel=\"alternate\" type=\"text/html\"/>\n    <link href=\"https://arxiv.org/pdf/2609.40360v1\" rel=\"related\" type=\"application/pdf\" title=\"pdf\"/>\n    <summary>Reinforcement learning with verifiable rewards (RLVR) has improved the reasoning capabilities of large language models (LLMs), yet their predictions remain sensitive to task-irrelevant prompt features. We investigate this sensitivity through semifactual prompt interventions that preserve the underlying problem and its answer. Our analysis reveals substantial variation in token-level sensitivity and shows that suppressing high-drift token candidates during decoding improves reasoning accuracy without updating model weights. These findings highlight a limitation of Group Relative Policy Optimization (GRPO), which assigns the same outcome-derived advantage to every response token and may reinforce potential spurious dependence alongside useful reasoning. Motivated by this observation, we introduce Semifactual Credit-Augmented Policy Optimization (SCAPO), a causally inspired variant of GRPO that incorporates semifactual stability into token-level credit assignment. SCAPO measures token probability drift for fixed responses under semifactual interventions and uses normalized stability scores to reduce advantages for relatively unstable tokens during early training, while granting no additional credit for stability alone. On Qwen3-4B-Base and Qwen3-1.7B-Base, SCAPO improves AIME 2024-2026 accuracy over GRPO by 5.63 and 4.17 percentage points, respectively. At both model scales, SCAPO achieves the best results on most evaluated mathematics benchmarks and all evaluated out-of-distribution benchmarks among the compared methods. These results suggest that semifactual stability provides an effective training signal for improving reasoning and generalization through finer-grained credit assignment in RLVR. The code is available at https://github.com/DtYXs/SCAPO.</summary>\n    <category term=\"cs.LG\" scheme=\"http://arxiv.org/schemas/atom\"/>\n    <category term=\"cs.AI\" scheme=\"http://arxiv.org/schemas/atom\"/>\n    <category term=\"cs.CL\" scheme=\"http://arxiv.org/schemas/atom\"/>\n    <published>2026-09-30T17:59:56Z</published>\n    <arxiv:primary_category term=\"cs.LG\"/>\n    <author>\n      <name>Junshu Pan</name>\n    </author>\n    <author>\n      <name>Zhizhang Fu</name>\n    </author>\n    <author>\n      <name>Shulin Huang</name>\n    </author>\n    <author>\n      <name>Yiran Ding</name>\n    </author>\n    <author>\n      <name>Zifan Cheng</name>\n    </author>\n    <author>\n      <name>Wenqi Shao</name>\n    </author>\n    <author>\n      <name>Qiaosheng Zhang</name>\n    </author>\n    <author>\n      <name>Yue Zhang</name>\n    </author>\n  </entry>";

t('★ parseAtomEntries：The Verge 真实 entry —— 链接取 link href（id 是 tag: URI）', () => {
  const rows = parseAtomEntries(`<feed>${VERGE_ENTRY}</feed>`, 5);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].url.startsWith('https://www.theverge.com/'), `链接应取 link href，实际：${rows[0].url}`);
  assert.ok(rows[0].title.length > 5);
  assert.ok(rows[0].author.length > 0);
  assert.ok(rows[0].time.length > 0, 'published/updated 至少有一个');
});

t('★ parseAtomEntries：arXiv 真实 entry —— 链接回落 <id>（abs 页），标题折行要压平', () => {
  const rows = parseAtomEntries(`<feed>${ARXIV_ENTRY}</feed>`, 5);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.ok(/arxiv\.org\/abs\//.test(r.url), `arXiv id 应是 abs 页，实际：${r.url}`);
  assert.ok(!r.title.includes('  ') && !r.title.includes('\n'), '标题不应残留折行/连续空白');
  assert.match(r.time, /^\d{4}-\d{2}-\d{2}T/, 'published 是 ISO 时间');
});

t('parseAtomEntries：title 带属性（type="html"）也要认；空输入不炸', () => {
  const rows = parseAtomEntries(
    '<feed><entry><title type="html"><![CDATA[A &amp; B]]></title>' +
    '<link rel="alternate" type="text/html" href="https://x.example/a"/>' +
    '<published>2026-10-01T00:00:00Z</published></entry></feed>'
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'A & B');
  assert.equal(parseAtomEntries('').length, 0);
});

/* ---------------- JSON 源（HN / dev.to / lobste.rs） ---------------- */

const HN_HIT = {"_highlightResult": {"author": {"matchLevel": "none", "matchedWords": [], "value": "theanonymousone"}, "story_text": {"matchLevel": "none", "matchedWords": [], "value": "See also: <i>Gemini 4 Argon</i> - <a href=\"https://news.ycombinator.com/item?id=49913571\">https://news.ycombinator.com/item?id=49913571</a>"}, "title": {"matchLevel": "none", "matchedWords": [], "value": "Gemini 4 Argon (High): Intelligence, Performance and Price Analysis"}, "url": {"fullyHighlighted": false, "matchLevel": "full", "matchedWords": ["ai"], "value": "https://artificialanalysis.<em>ai</em>/models/gemini-4-argon"}}, "_tags": ["story", "author_theanonymousone", "story_49914236"], "author": "theanonymousone", "children": [49914901, 49917145, 49916271, 49914865, 49914958, 49916538, 49914898, 49915345, 49914813, 49916081, 49914961, 49914864, 49914497, 49914663], "created_at": "2026-09-30T20:50:28Z", "created_at_i": 1790801428, "num_comments": 48, "objectID": "49914236", "points": 92, "story_id": 49914236, "story_text": "See also: <i>Gemini 4 Argon</i> - <a href=\"https:&#x2F;&#x2F;news.ycombinator.com&#x2F;item?id=49913571\">https:&#x2F;&#x2F;news.ycombinator.com&#x2F;item?id=49913571</a>", "title": "Gemini 4 Argon (High): Intelligence, Performance and Price Analysis", "updated_at": "2026-10-01T03:57:58Z", "url": "https://artificialanalysis.ai/models/gemini-4-argon"};
const DEVTO_ARTICLE = {"type_of": "article", "id": 4754094, "title": "Prompt Injection Is the New SQL Injection (and We're Not Ready)", "description": "In March 2026, a financial services company discovered that their customer-facing AI agent had been...", "readable_publish_date": "Sep 27", "slug": "prompt-injection-is-the-new-sql-injection-and-were-not-ready-4ea4", "path": "/james_anderson_h/prompt-injection-is-the-new-sql-injection-and-were-not-ready-4ea4", "url": "https://dev.to/james_anderson_h/prompt-injection-is-the-new-sql-injection-and-were-not-ready-4ea4", "comments_count": 90, "public_reactions_count": 99, "collection_id": null, "published_timestamp": "2026-09-27T05:32:50Z", "language": "en", "subforem_id": 1, "ai_disclosure_level": "not_disclosed", "ai_disclosure_label": "Not Disclosed", "positive_reactions_count": 99, "cover_image": "https://media2.dev.to/dynamic/image/width=1000,height=420,fit=cover,gravity=auto,format=auto/https%3A%2F%2Fdev-to-uploads.s3.us-east-2.amazonaws.com%2Fuploads%2Farticles%2Fs3naos2gu55mg9na6jui.png", "social_image": "https://media2.dev.to/dynamic/image/width=1200,height=627,fit=cover,gravity=auto,format=auto/https%3A%2F%2Fdev-to-uploads.s3.us-east-2.amazonaws.com%2Fuploads%2Farticles%2Fs3naos2gu55mg9na6jui.png", "canonical_url": "https://dev.to/james_anderson_h/prompt-injection-is-the-new-sql-injection-and-were-not-ready-4ea4", "created_at": "2026-09-27T05:32:50Z", "edited_at": null, "crossposted_at": null, "published_at": "2026-09-27T05:32:50Z", "last_comment_at": "2026-09-30T20:09:41Z", "reading_time_minutes": 7, "tag_list": ["ai", "security", "agents", "webdev"], "tags": "ai, security, agents, webdev", "user": {"name": "James Anderson", "username": "james_anderson_h", "twitter_username": null, "github_username": null, "user_id": 3968038, "website_url": null, "profile_image": "https://media2.dev.to/dynamic/image/width=640,height=640,fit=cover,gravity=auto,format=auto/https%3A%2F%2Fdev-to-uploads.s3.us-east-2.amazonaws.com%2Fuploads%2Fuser%2Fprofile_image%2F3968038%2F98bc34c8-0955-4e0c-8b23-182806d4b0d6.png", "profile_image_90": "https://media2.dev.to/dynamic/image/width=90,height=90,fit=cover,gravity=auto,format=auto/https%3A%2F%2Fdev-to-uploads.s3.us-east-2.amazonaws.com%2Fuploads%2Fuser%2Fprofile_image%2F3968038%2F98bc34c8-0955-4e0c-8b23-182806d4b0d6.png"}};
const LOBSTER_ITEM = {"short_id": "1xr8zc", "created_at": "2026-09-29T11:51:35.804-05:00", "title": "Text-to-meowdio models", "url": "https://www.kmjn.org/notes/text_to_meowdio_models.html", "score": 2, "flags": 0, "comment_count": 2, "description": "", "description_plain": "", "submitter_user": "mjn", "user_is_author": true, "tags": ["ai", "visualization"], "short_id_url": "https://lobste.rs/s/1xr8zc", "comments_url": "https://lobste.rs/s/1xr8zc/text_meowdio_models"};

t('★ normalizeHn：真实命中 —— 链接指到 HN 讨论页，分数/时间/作者齐全', () => {
  const rows = normalizeHn({ hits: [HN_HIT] });
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.ok(r.url.startsWith('https://news.ycombinator.com/item?id='), '链接指向 HN 讨论页');
  assert.equal(r.score, HN_HIT.points);
  assert.equal(r.time, HN_HIT.created_at);
  assert.equal(r.author, HN_HIT.author);
});

t('normalizeHn：没有 objectID 的命中被剔除（没有讨论页可指）', () => {
  assert.equal(normalizeHn({ hits: [{ title: 'x', points: 5 }] }).length, 0);
});

t('★ normalizeDevTo：真实文章 —— 反应数当热度，作者取 user.username', () => {
  const rows = normalizeDevTo([DEVTO_ARTICLE]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, DEVTO_ARTICLE.url);
  assert.equal(rows[0].score, DEVTO_ARTICLE.positive_reactions_count);
  assert.equal(rows[0].author, DEVTO_ARTICLE.user.username);
  assert.equal(normalizeDevTo(null).length, 0);
});

t('★ normalizeLobsters：真实条目 —— 外链优先，缺外链回落站内页', () => {
  const rows = normalizeLobsters([LOBSTER_ITEM]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].score, LOBSTER_ITEM.score);
  const noext = normalizeLobsters([{ ...LOBSTER_ITEM, url: null }]);
  assert.equal(noext[0].url, LOBSTER_ITEM.short_id_url, '缺外链时用 short_id_url');
});

/* ---------------- momoyu ---------------- */

const MOMOYU_BLOCK = {"id": 3, "sort": 1, "name": "微博热搜", "source_key": "weibo", "icon_color": "#E30E24", "create_time": "2026-10-01T02:00:07.000Z", "data": [{"id": 255964328, "title": "12306回应买不到票被迫买长乘短", "extra": "117.6万", "link": "https://s.weibo.com/weibo?q=%2312306回应买不到票被迫买长乘短%23"}, {"id": 255961375, "title": "天安门放飞10000多只和平鸽", "extra": "87.2万", "link": "https://s.weibo.com/weibo?q=%23天安门放飞10000多只和平鸽%23"}]};

t('★ normalizeMomoyu：真实块 —— 来源名/条目/站方 create_time', () => {
  const rows = normalizeMomoyu({ status: 100000, data: [MOMOYU_BLOCK] });
  assert.equal(rows.length, 1);
  const b = rows[0];
  assert.equal(b.key, 'weibo');
  assert.equal(b.name, MOMOYU_BLOCK.name);
  assert.equal(b.fetchedAt, MOMOYU_BLOCK.create_time, 'fetchedAt 用站方时刻，不是我们的抓取时刻');
  assert.equal(b.items.length, 2, 'fixture 只带 2 条');
  assert.ok(b.items[0].title.length > 0 && b.items[0].url.startsWith('https://'));
  assert.equal(typeof b.items[0].extra, 'string', 'extra 是文字热度（如 552 万），不解析成数字');
});

t('normalizeMomoyu：无名来源/空条目剔除；坏输入不炸', () => {
  assert.equal(normalizeMomoyu({ data: [{ name: '', data: [{ title: 'x', link: 'y' }] }] }).length, 0);
  assert.equal(normalizeMomoyu({ data: [{ name: '空榜', data: [] }] }).length, 0);
  assert.equal(normalizeMomoyu(null).length, 0);
});

/* ---------------- 源清单与守卫 ---------------- */

t('★ NEWS_SOURCES：8 个源、key 唯一、URL 都成型（少一个源就是面板少一组）', () => {
  assert.equal(NEWS_SOURCES.length, 8);
  assert.equal(new Set(NEWS_SOURCES.map((s) => s.key)).size, 8, 'key 不得重复');
  for (const s of NEWS_SOURCES) assert.ok(/^https:\/\//.test(s.url), `${s.key} 的 URL 异常`);
  assert.equal(new Set(NEWS_SOURCES.map((s) => s.kind)).size, 5, 'kind 覆盖 hn/devto/rss/atom/lobsters');
});

t('★ 脚本有直跑守卫：import 不产生任何网络副作用（主流程只在直接运行时走）', () => {
  assert.match(
    readFileSync(new URL('../../../scripts/fetch-ai-news.mjs', import.meta.url), 'utf8'),
    /if \(isMain\)/,
    'fetch-ai-news.mjs 缺直跑守卫'
  );
  assert.match(
    readFileSync(new URL('../../../scripts/fetch-momoyu-hot.mjs', import.meta.url), 'utf8'),
    /if \(isMain\)/,
    'fetch-momoyu-hot.mjs 缺直跑守卫'
  );
});

console.log(`\n  通过 ${pass} 失败 ${process.exitCode ? 1 : 0}\n`);
