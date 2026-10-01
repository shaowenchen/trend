#!/usr/bin/env node
/**
 * AI 新闻快照 —— 8 个来源 → `web/public/assets/data/ai-news.json`。
 *
 * ## 来源与形状（全部 2026-10-01 实测）
 *   · Hacker News · AI   hn.algolia.com/api/v1/search（query=AI OR LLM OR GPT，
 *                        points>50，近 7 天；CORS 其实通，但为统一节奏一并快照）
 *   · dev.to · AI        dev.to/api/articles?tag=ai&top=7（近 7 天高热）
 *   · TechCrunch · AI    RSS（无 CORS → 只能构建期抓）
 *   · The Verge · AI     RSS（同上）
 *   · Latent Space       substack RSS（同上）
 *   · Interconnects      substack RSS（同上）
 *   · arXiv · cs.AI      Atom（最新提交）
 *   · lobste.rs · AI     /t/ai.json（ai 标签订阅；最热榜里 ai 标签稀疏，订阅才稳）
 *
 * ## 失败语义（与 ghTrending 同一套纪律）
 * **逐源独立**：某源今天抓不到/解析不出 → 保留该源**上一次**的块（旧 fetchedAt
 * 如实保留），其余源照常更新。全部源都失败才非零退出（不提交、旧文件原样保留）。
 * 页面标注"最老来源抓取于 …"，读者能看到最旧的块有多旧 —— 不装新。
 *
 * ## 手动跑
 *   npm run snap:ai-news
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** 只有"直接运行"才跑主流程 —— 测试 import 解析器时不能触发抓取 */
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

const OUT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../web/public/assets/data/ai-news.json'
);
const FETCH_TIMEOUT_MS = 25000;
const PER_SOURCE_GAP_MS = 600; // 不同主机也逐个来：快照是每天一次的事，不赶这几百毫秒
const LIMIT = 20; // 每源最多保留条数（快照体积可控，页面信息量也够）

/* ---------------- 解析器（导出给测试，全部对着真实响应写的） ---------------- */

const stripCdata = (s) => String(s ?? '').replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim();

/**
 * 还原 XML 实体（&amp; 必须放最后，否则会把 &amp;lt; 错拆成 &lt;）。
 * 不还原的话，页面标题会显示成字面的 "&amp;" —— 快照测试里那条 CDATA
 * 断言盯的就是这件事。
 */
const unescapeXml = (s) =>
  String(s ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
/** 折叠标题里的换行与连续空白（arXiv 标题是折行写的） */
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** RSS 2.0（TechCrunch / The Verge / substack 系）→ [{title, url, time, author}] */
export function parseRssItems(xml, limit = LIMIT) {
  const out = [];
  const items = String(xml || '').match(/<item[\s>][\s\S]*?<\/item>/g) || [];
  for (const it of items.slice(0, limit)) {
    const title = oneLine(unescapeXml(stripCdata(/<title>([\s\S]*?)<\/title>/.exec(it)?.[1])));
    const url = stripCdata(/<link>([\s\S]*?)<\/link>/.exec(it)?.[1]);
    if (!title || !url) continue;
    out.push({
      title,
      url,
      time: stripCdata(/<pubDate>([\s\S]*?)<\/pubDate>/.exec(it)?.[1]) || '',
      author: oneLine(unescapeXml(stripCdata(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/.exec(it)?.[1] || ''))),
    });
  }
  return out;
}

/**
 * Atom（arXiv / The Verge）→ [{title, url, time, author}]。
 * 链接优先 `<link href>`（Verge 的 `<id>` 是 `tag:theverge.com,…` 这种 tag URI，
 * 不是可打开的地址）；没有 link 再回落 `<id>`（arXiv 的 id 恰好就是 abs 页）。
 */
export function parseAtomEntries(xml, limit = LIMIT) {
  const out = [];
  const entries = String(xml || '').match(/<entry>([\s\S]*?)<\/entry>/g) || [];
  for (const e of entries.slice(0, limit)) {
    const title = oneLine(unescapeXml(stripCdata(/<title[^>]*>([\s\S]*?)<\/title>/.exec(e)?.[1])));
    const url =
      stripCdata(/<link[^>]*href="([^"]+)"[^>]*\/>?/.exec(e)?.[1]) ||
      stripCdata(/<id>([\s\S]*?)<\/id>/.exec(e)?.[1]);
    if (!title || !url) continue;
    out.push({
      title,
      url,
      time:
        stripCdata(/<published>([\s\S]*?)<\/published>/.exec(e)?.[1]) ||
        stripCdata(/<updated>([\s\S]*?)<\/updated>/.exec(e)?.[1]) ||
        '',
      author: oneLine(unescapeXml(stripCdata(/<name>([\s\S]*?)<\/name>/.exec(e)?.[1] || ''))),
    });
  }
  return out;
}

/** HN Algolia 命中 → 标准条目（链接指到 HN 讨论页，那里才有评论与语境） */
export function normalizeHn(json, limit = LIMIT) {
  return (json?.hits || []).slice(0, limit).map((h) => ({
    title: String(h.title || ''),
    url: h.objectID ? `https://news.ycombinator.com/item?id=${h.objectID}` : '',
    time: String(h.created_at || ''),
    score: Number.isFinite(Number(h.points)) ? Number(h.points) : null,
    author: String(h.author || ''),
  })).filter((x) => x.title && x.url);
}

/** dev.to 文章 → 标准条目（分数用 positive_reactions_count） */
export function normalizeDevTo(json, limit = LIMIT) {
  return (Array.isArray(json) ? json : []).slice(0, limit).map((a) => ({
    title: String(a.title || ''),
    url: String(a.url || ''),
    time: String(a.published_at || ''),
    score: Number.isFinite(Number(a.positive_reactions_count)) ? Number(a.positive_reactions_count) : null,
    author: String(a.user?.username || ''),
  })).filter((x) => x.title && x.url);
}

/** lobste.rs（/t/ai.json）→ 标准条目（外链缺失时回落到站内页） */
export function normalizeLobsters(json, limit = LIMIT) {
  return (Array.isArray(json) ? json : []).slice(0, limit).map((x) => ({
    title: String(x.title || ''),
    url: String(x.url || x.short_id_url || ''),
    time: String(x.created_at || ''),
    score: Number.isFinite(Number(x.score)) ? Number(x.score) : null,
    author: String(x.submitter_user?.username || ''),
  })).filter((x) => x.title && x.url);
}

/* ---------------- 源清单 ---------------- */

/**
 * HN 查询：按**时间倒序** + points>10。
 * 为什么不用"近 7 天 + points>50"：实测特定一周可能一条都没有（AI 命中率
 * ~1 条/周·50 分）—— 空窗会让源整天缺席。按时间序取 + 10 分质量线，
 * 结果永远新鲜且不空。
 */
const HN_URL = () => {
  const q = encodeURIComponent('AI OR LLM OR GPT');
  return `https://hn.algolia.com/api/v1/search_by_date?query=${q}&tags=story&numericFilters=points%3E10&hitsPerPage=${LIMIT}`;
};

export const NEWS_SOURCES = [
  { key: 'hn', name: 'Hacker News · AI', url: HN_URL(), kind: 'hn' },
  { key: 'devto', name: 'dev.to · AI', url: `https://dev.to/api/articles?tag=ai&top=7&per_page=${LIMIT}`, kind: 'devto' },
  { key: 'techcrunch', name: 'TechCrunch · AI', url: 'https://techcrunch.com/category/artificial-intelligence/feed/', kind: 'rss' },
  { key: 'theverge', name: 'The Verge · AI', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', kind: 'atom' },
  { key: 'latentspace', name: 'Latent Space', url: 'https://www.latent.space/feed', kind: 'rss' },
  { key: 'interconnects', name: 'Interconnects', url: 'https://www.interconnects.ai/feed', kind: 'rss' },
  {
    key: 'arxiv',
    name: 'arXiv · cs.AI',
    url: `https://export.arxiv.org/api/query?search_query=cat:cs.AI&sortBy=submittedDate&sortOrder=descending&max_results=${LIMIT}`,
    kind: 'atom',
  },
  { key: 'lobsters', name: 'lobste.rs · AI', url: 'https://lobste.rs/t/ai.json', kind: 'lobsters' },
];

async function fetchOnce(src) {
  const res = await fetch(src.url, {
    headers: { accept: src.kind === 'rss' || src.kind === 'atom' ? 'application/xml, application/rss+xml, text/xml, */*' : 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  switch (src.kind) {
    case 'hn':
      return normalizeHn(JSON.parse(text));
    case 'devto':
      return normalizeDevTo(JSON.parse(text));
    case 'lobsters':
      return normalizeLobsters(JSON.parse(text));
    case 'rss':
      return parseRssItems(text);
    case 'atom':
      return parseAtomEntries(text);
    default:
      throw new Error(`unknown kind ${src.kind}`);
  }
}

/** 一次重试：瞬时抖动（连接被掐/限流一闪）占失败的大头，等 2s 再来一次 */
async function fetchSource(src) {
  try {
    return await fetchOnce(src);
  } catch (e) {
    await new Promise((r) => setTimeout(r, 2000));
    return await fetchOnce(src);
  }
}

/* ---------------- 主流程：逐源更新 + 失败保旧 ---------------- */

async function readOldSnapshot() {
  try {
    return JSON.parse(await fs.readFile(OUT_PATH, 'utf8'));
  } catch {
    return null; // 首跑：没有旧快照
  }
}

async function main() {
  const old = await readOldSnapshot();
  const oldBlocks = new Map((old?.sources || []).map((s) => [s.key, s]));

  const sources = [];
  let okCount = 0;
  for (const src of NEWS_SOURCES) {
    const prev = oldBlocks.get(src.key);
    try {
      const items = await fetchSource(src);
      if (!items.length) throw new Error('解析出 0 条');
      sources.push({ key: src.key, name: src.name, fetchedAt: new Date().toISOString(), items });
      okCount += 1;
      console.log(`  ✓ ${src.name.padEnd(18)} ${items.length} 条`);
    } catch (e) {
      if (prev?.items?.length) {
        // 逐源回退：今天抓不到的源，保留上次的块与它的旧时间 —— 绝不拿空块顶上
        sources.push(prev);
        console.log(`  ⚠ ${src.name.padEnd(18)} 抓取失败（${e.message}）→ 保留 ${prev.items.length} 条旧快照（${prev.fetchedAt}）`);
      } else {
        console.log(`  ✗ ${src.name.padEnd(18)} 抓取失败且无旧快照可回退：${e.message}`);
      }
    }
    await new Promise((r) => setTimeout(r, PER_SOURCE_GAP_MS));
  }

  if (okCount === 0) {
    console.error('✗ 8 个来源全部失败 —— 不写文件、不提交，旧快照原样保留');
    process.exit(1);
  }

  const snapshot = {
    // 文件级时间 = 本次构建期抓取时刻；每源另有自己的 fetchedAt（页面按"最老来源"标注）
    fetchedAt: new Date().toISOString(),
    sources,
  };
  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(snapshot, null, 1) + '\n');

  const total = sources.reduce((n, s) => n + s.items.length, 0);
  console.log(`✓ ${okCount}/${NEWS_SOURCES.length} 源更新 · 共 ${total} 条 · 写入 ${path.relative(process.cwd(), OUT_PATH)}`);
}

if (isMain) await main();
