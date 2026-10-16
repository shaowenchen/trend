#!/usr/bin/env node
/**
 * Hacker News 首页快照 —— `web/public/assets/data/hn-top.json`。
 *
 * ## 这是什么榜（与站内 aiNews 的 HN 源不同）
 * `aiNews` 面板里已经有一个 HN 源，但它是**按 AI 关键词搜**出来的
 * （`search_by_date?query=AI OR LLM OR GPT`）。这一张是 `tags=front_page`
 * —— HN 此刻**整个首页**在顶什么。两者会重叠，但不是同一件事：
 * 前者回答"AI 圈在聊什么"，后者回答"技术社区今天在聊什么"（里头常常有
 * 与 AI 无关但很值得看的东西，那正是它的价值）。
 *
 * ## 为什么走快照（明明有 CORS）
 * `hn.algolia.com` 实测 `access-control-allow-origin` 回显 Origin，浏览器**能**直连。
 * 之所以仍然快照，是为了与站内其它"社区热度"面板统一口径：
 *   · 一次构建期请求，对 Algolia 最友好（这是他们的公开测试端点，不该被每个访客打）；
 *   · "抓取于 …"的标注与其它快照一致；
 *   · 首页排名本身变化慢（几十分钟量级），≤24h 的时效损失如实标注即可。
 * 若将来想改成直连，删掉这个脚本、让 `trend.js` 直接 fetch 那个 URL 即可 ——
 * 端点是同一个，CORS 已实测通。
 *
 * ## 失败语义
 * 抓不到 / 命中数 < 5 → 非零退出、**不写文件**，旧快照原样保留。
 *
 * ## 手动跑
 *   npm run snap:hn
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

const OUT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../web/public/assets/data/hn-top.json'
);

/** 一次取满 50 条首页 —— 首页本身约 30 条，多取的余量用来兜住"有些条目被剔除" */
const API_URL = 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=50';

const UA = 'trend-snapshot/1.0 (https://github.com/shaowenchen/trend; mail@chenshaowen.com)';

const MIN_ITEMS = 5; // 少于这个数 = 结构变了/半截数据，拒绝产出

/**
 * Algolia 的命中 → 快照条目。
 *
 * ★ 三个必须处理的地方（都从真实响应里核出来的）：
 *   1. `url` 可能是 null（Ask HN / Show HN 这类**自帖**没有外部链接）——
 *      这类条目的正确地址是 HN 的讨论页，不是空串。页面上也不该出现一个
 *      "看着能点、点了跳回本页"的空链接。
 *   2. `title` 可能是 null（极少数条目只有 `story_title`）—— 没有标题的条目直接丢。
 *   3. `points` / `num_comments` 可能是 null（新条目还没算出来）——
 *      保留为 null，不拿 0 冒充（0 分与"还没统计"在榜上是两件事）。
 */
export function normalizeHn(json) {
  const hits = Array.isArray(json?.hits) ? json.hits : [];
  const out = [];
  for (const h of hits) {
    const title = String(h?.title || h?.story_title || '').trim();
    if (!title) continue;
    const objectID = String(h?.objectID || '').trim();
    // 自帖（没有 url）→ 指向 HN 讨论页；两者都没有的条目没有可去的地方，丢掉
    const external = String(h?.url || '').trim();
    const hnUrl = objectID ? `https://news.ycombinator.com/item?id=${objectID}` : '';
    const url = external || hnUrl;
    if (!url) continue;
    const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
    const points = num(h?.points);
    const comments = num(h?.num_comments);
    out.push({
      title,
      url,
      // 原文地址（自帖时为空）—— 页面用它区分"外链"与"讨论"
      external,
      hnUrl,
      points: Number.isFinite(points) ? points : null,
      comments: Number.isFinite(comments) ? comments : null,
      author: String(h?.author || ''),
      time: String(h?.created_at || ''),
      // Algolia 的默认顺序**就是**首页排名，显式带上下标比依赖数组顺序稳
      rank: out.length + 1,
    });
  }
  return out;
}

async function main() {
  const res = await fetch(API_URL, {
    headers: { accept: 'application/json', 'user-agent': UA },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) {
    console.error(`✗ 抓取失败：HTTP ${res.status}（旧快照保留，不写文件）`);
    process.exit(1);
  }
  const json = await res.json();
  const items = normalizeHn(json);
  if (items.length < MIN_ITEMS) {
    console.error(`✗ 只解析出 ${items.length} 条（< ${MIN_ITEMS}，疑似结构变了）—— 旧快照保留`);
    process.exit(1);
  }
  const snapshot = { fetchedAt: new Date().toISOString(), items };
  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(snapshot, null, 1) + '\n');
  console.log(`✓ ${items.length} 条 · 榜首「${items[0].title.slice(0, 40)}」(${items[0].points} 分) · 写入 ${path.relative(process.cwd(), OUT_PATH)}`);
}

if (isMain) await main();
