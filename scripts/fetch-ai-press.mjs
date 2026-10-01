#!/usr/bin/env node
/**
 * AI 官方要闻快照 —— 8 家一手信源的官方博客 → `web/public/assets/data/ai-press.json`。
 *
 * ## 与 aiNews 面板的分工
 *   · aiNews（fetch-ai-news.mjs）：聚合/社区源（HN、dev.to、substack 系、arXiv…）
 *   · aiPress（本脚本）：**一手信源** —— 厂商与媒体的官方博客原文
 *
 * ## 源清单与实测（2026-10-01，逐个 curl + parseRssItems 验证）
 *   · OpenAI          openai.com/news/rss.xml            200 RSS（全量档案 1240 条，取前 20）
 *   · TechCrunch · AI techcrunch.com/category/…/feed/    200 RSS（19 条）
 *   · Ars Technica    arstechnica.com/ai/feed/           200 RSS（20 条）
 *   · GitHub Blog     github.blog/feed/                  200 RSS（10 条；AI 分类 feed 404）
 *   · DeepMind        deepmind.google/blog/rss.xml       200 RSS（100 条，单行 XML）
 *   · 微软研究院      microsoft.com/en-us/research/feed/ 200 RSS（10 条）
 *   · NVIDIA          blogs.nvidia.com/feed/             200 RSS（18 条）
 *   · The Decoder     thedecoder.com — ❌ **域名已挂牌出售**（停靠页 307 跳
 *     forsale.godaddy.com），全部 feed 路径只回 114B 跳转壳 → **观察项，不硬上**；
 *     快照的 skipped 字段如实记录，页面上可见。
 *
 * ## 失败语义（与 fetch-ai-news.mjs 同一套纪律）
 * 逐源独立回退：某源今天抓不到 → 保留它上次的块与旧 fetchedAt；全部失败
 * 才非零退出（不提交、旧快照原样保留）。
 *
 * ## 手动跑
 *   npm run snap:ai-press
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 解析器与 aiNews 一份（都对着真实响应写的，有 ainews.test.js 盯着）
import { parseRssItems } from './fetch-ai-news.mjs';

/** 只有"直接运行"才跑主流程 —— 测试 import 源清单时不能触发抓取 */
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

const OUT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../web/public/assets/data/ai-press.json'
);
const FETCH_TIMEOUT_MS = 25000;
const PER_SOURCE_GAP_MS = 800; // 一手博客的 RSS 都不小（OpenAI 756KB），逐个来、不赶
const LIMIT = 20; // 每源最多保留条数
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 trend-snapshot/1.0 (+https://github.com/shaowenchen/trend)';

/** 一手信源（全部 RSS 2.0，2026-10-01 逐个实测可解析） */
export const PRESS_SOURCES = [
  { key: 'openai', name: 'OpenAI', url: 'https://openai.com/news/rss.xml' },
  { key: 'techcrunch', name: 'TechCrunch · AI', url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
  { key: 'arstechnica', name: 'Ars Technica · AI', url: 'https://arstechnica.com/ai/feed/' },
  { key: 'github', name: 'GitHub Blog', url: 'https://github.blog/feed/' },
  { key: 'deepmind', name: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml' },
  { key: 'msr', name: 'Microsoft Research', url: 'https://www.microsoft.com/en-us/research/feed/' },
  { key: 'nvidia', name: 'NVIDIA Blog', url: 'https://blogs.nvidia.com/feed/' },
];

/**
 * 观察项 —— 用户点名的源里取不到的，如实记录原因，不硬上。
 * 页面把这份清单显示在快照说明里（"观察项：The Decoder（域名已挂牌出售）"），
 * 哪天它恢复了，把条目从这里挪进 PRESS_SOURCES 即可。
 */
export const PRESS_OBSERVED = [
  {
    key: 'thedecoder',
    name: 'The Decoder',
    reason: '域名已挂牌出售（停靠页 307 → forsale.godaddy.com），全部 feed 路径只回 114B 跳转壳（2026-10-01 实测）',
  },
];

async function fetchOnce(src) {
  const res = await fetch(src.url, {
    headers: { accept: 'application/rss+xml, application/xml, text/xml, */*', 'user-agent': UA },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = parseRssItems(await res.text(), LIMIT);
  if (!items.length) throw new Error('解析出 0 条');
  return items;
}

/** 一次重试：瞬时抖动（连接被掐/限流一闪）占失败的大头 */
async function fetchSource(src) {
  try {
    return await fetchOnce(src);
  } catch (e) {
    await new Promise((r) => setTimeout(r, 2500));
    return await fetchOnce(src);
  }
}

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
  for (const src of PRESS_SOURCES) {
    const prev = oldBlocks.get(src.key);
    try {
      const items = await fetchSource(src);
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
    console.error(`✗ ${PRESS_SOURCES.length} 个来源全部失败 —— 不写文件、不提交，旧快照原样保留`);
    process.exit(1);
  }

  const snapshot = {
    fetchedAt: new Date().toISOString(), // 文件级时间；每源另有自己的 fetchedAt
    // 观察项跟着快照走：页面上"观察项：…"的说明来自这里，不写在代码里硬编码
    skipped: PRESS_OBSERVED,
    sources,
  };
  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(snapshot, null, 1) + '\n');

  const total = sources.reduce((n, s) => n + s.items.length, 0);
  console.log(`✓ ${okCount}/${PRESS_SOURCES.length} 源更新 · 共 ${total} 条 · 写入 ${path.relative(process.cwd(), OUT_PATH)}`);
  if (PRESS_OBSERVED.length) {
    console.log(`  观察项：${PRESS_OBSERVED.map((x) => `${x.name}（${x.reason.slice(0, 24)}…）`).join(' · ')}`);
  }
}

if (isMain) await main();
