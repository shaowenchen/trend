#!/usr/bin/env node
/**
 * Google 搜索趋势快照 —— `web/public/assets/data/google-trends.json`。
 *
 * ## 这是什么榜
 * Google 官方的**每日搜索趋势**（Daily Search Trends）。它是站内唯一的
 * **搜索引擎注意力**口径：别的榜量的是"谁在用什么"，这一张量的是
 * **"全世界此刻在搜什么"**。用户点名要的"google 关键字"就是它。
 *
 * ## 为什么必须快照
 * 实测 `trends.google.com/trending/rss` 返回中**没有任何 `access-control-*`
 * 头**（且带 `cross-origin-resource-policy: same-site`）—— 浏览器直连必被拦。
 * 所以与 GitHub Trending 同一条路：构建期抓 → 落 JSON → 页面读快照。
 *
 * ## 端点的三个事实（实测）
 *   · `?geo=<区域码>` 取该区域的日榜，**一次给 10 条**（Google 就只给 10 条）；
 *   · 返回是 RSS 2.0，热度在**命名空间标签** `<ht:approx_traffic>` 里
 *     （形如 `2000+` / `100K+`，是**粗粒度字符串**，不是精确数字）；
 *   · 有 `geo=CN` 会 **400**，中文地区要用 HK / TW（这两个的内容确实是中文的）。
 *
 * ## 相关性过滤：按**区域的语言**过滤，不按 AI 关键词
 * 这张榜的价值是"大众在搜什么"，硬套 AI 关键词会把 90% 的条目筛掉、
 * 剩下的反而不是真实趋势。所以不做 AI 过滤，改为**按区域出面板**：
 * 读者想看哪个地区就切哪个（与 OpenRouter 的子视图同一种交互）。
 * `REGIONS` 里 CN 缺席是事实，不是遗漏 —— 端点上就没有。
 *
 * ## 失败语义
 * 某区域取不到 → 跳过它（其它区域照常）；**全部**取不到才非零退出、不写文件。
 * 部分成功时快照记 `skipped`，页面如实标注缺了哪个区域。
 *
 * ## 手动跑
 *   npm run snap:trends
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

const OUT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../web/public/assets/data/google-trends.json'
);

const UA = 'trend-snapshot/1.0 (https://github.com/shaowenchen/trend; mail@chenshaowen.com)';

/**
 * 取哪几个区域。★ 顺序 = 面板里的切换片顺序：先是科技圈最常看的那几个，
 * 再是中文地区（HK/TW/SG，读者点名要中文内容时看这几个），最后是其它大区。
 *
 * ★ **没有 CN**：`geo=CN` 实测 400 —— Google 趋势没有中国大陆区域。
 * 与其硬凑一个（编不出来），不如在面板说明里写清"中国大陆无此区域"。
 */
export const REGIONS = [
  { code: 'US', label: '美国' },
  { code: 'GB', label: '英国' },
  { code: 'JP', label: '日本' },
  { code: 'HK', label: '中国香港' },
  { code: 'TW', label: '中国台湾' },
  { code: 'SG', label: '新加坡' },
  { code: 'DE', label: '德国' },
  { code: 'FR', label: '法国' },
  { code: 'IN', label: '印度' },
  { code: 'KR', label: '韩国' },
];

const MIN_REGIONS = 3; // 少于这个数 = 结构变了/被限流，拒绝产出
const MIN_ITEMS = 3;   // 单个区域少于这个数就丢掉那个区域

/** RSS 实体还原（Google 的 title 里会出现 &amp; / &#39;） */
function unescapeXml(s) {
  return String(s)
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

/**
 * 解析 Google Trends 的 RSS。
 *
 * ★ 手写正则而不是引 XML 库：本站零依赖，而这份 feed 的形态极简单
 * （item 扁平、没有嵌套、CDATA 都不一定用）。`ainews.test.js` 里已有一份
 * 同路的 RSS/Atom 解析器；这里是它在**这个** feed 上的最小子集。
 * 上游若改版，`MIN_ITEMS` / `MIN_REGIONS` 两道门会让脚本非零退出，
 * 而不是静默产出一个空快照。
 */
export function parseTrendsRss(xml, region) {
  const items = [];
  for (const m of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const body = m[1];
    const pick = (re) => {
      const mm = body.match(re);
      return mm ? unescapeXml(mm[1].trim()) : '';
    };
    const title = pick(/<title>([\s\S]*?)<\/title>/);
    if (!title) continue;
    // 热度：'2000+' / '100K+' —— 上游只给这个粒度，**保留原文**，
    // 解析成数字会假装精确（我们只知道"至少 2000"）
    const traffic = pick(/<ht:approx_traffic>([\s\S]*?)<\/ht:approx_traffic>/);
    const pubDate = pick(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const picture = pick(/<ht:picture>([\s\S]*?)<\/ht:picture>/);
    // 相关新闻：取第一条，给条目一个"点进去看什么"的落点
    const newsTitle = pick(/<ht:news_item_title>([\s\S]*?)<\/ht:news_item_title>/);
    const newsUrl = pick(/<ht:news_item_url>([\s\S]*?)<\/ht:news_item_url>/);
    const newsSource = pick(/<ht:news_item_source>([\s\S]*?)<\/ht:news_item_source>/);
    items.push({
      title,
      traffic,
      pubDate,
      picture,
      newsTitle,
      newsUrl,
      newsSource,
      region,
      rank: items.length + 1,
    });
  }
  return items;
}

async function fetchRegion(region) {
  const url = `https://trends.google.com/trending/rss?geo=${encodeURIComponent(region)}`;
  const res = await fetch(url, {
    headers: { accept: 'application/rss+xml, application/xml, text/xml', 'user-agent': UA },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = parseTrendsRss(await res.text(), region);
  if (items.length < MIN_ITEMS) throw new Error(`只解析出 ${items.length} 条`);
  return items;
}

async function main() {
  const blocks = [];
  const skipped = [];
  for (const { code, label } of REGIONS) {
    try {
      const items = await fetchRegion(code);
      blocks.push({ region: code, label, items });
      console.log(`  ✓ ${code} ${label}  ${items.length} 条 · 榜首「${items[0].title.slice(0, 30)}」`);
    } catch (e) {
      skipped.push({ region: code, label, reason: String(e.message).slice(0, 80) });
      console.warn(`  ✗ ${code} ${label}  ${e.message}`);
    }
  }

  if (blocks.length < MIN_REGIONS) {
    console.error(`✗ 只取到 ${blocks.length} 个区域（< ${MIN_REGIONS}）—— 旧快照保留，不写文件`);
    process.exit(1);
  }

  const snapshot = {
    fetchedAt: new Date().toISOString(),
    skipped,
    // 与其它快照同形（sources/items），页面可以用同一套摊平逻辑
    sources: blocks.map((b) => ({
      key: b.region,
      name: b.label,
      fetchedAt: b.items[0]?.pubDate ? new Date(b.items[0].pubDate).toISOString() : new Date().toISOString(),
      items: b.items.map((it) => ({
        title: it.title,
        // 没有条目级 URL（feed 的 <link> 是这份 feed 自己）—— 用"搜这个词"当落点，
        // 那是读者点进去真正想做的事
        url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(it.title)}&geo=${encodeURIComponent(b.region)}`,
        extra: it.traffic,
        newsTitle: it.newsTitle,
        newsUrl: it.newsUrl,
        newsSource: it.newsSource,
      })),
    })),
  };
  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(snapshot, null, 1) + '\n');
  const total = blocks.reduce((n, b) => n + b.items.length, 0);
  console.log(`✓ ${blocks.length} 个区域 · 共 ${total} 条 · 写入 ${path.relative(process.cwd(), OUT_PATH)}`);
  if (skipped.length) console.log(`  跳过：${skipped.map((s) => s.region).join(' · ')}`);
}

if (isMain) await main();
