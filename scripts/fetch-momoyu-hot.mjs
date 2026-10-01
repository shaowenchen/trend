#!/usr/bin/env node
/**
 * 摸摸鱼热榜快照 —— momoyu.cc 聚合榜 → `web/public/assets/data/momoyu-hot.json`。
 *
 * ## 来源（2026-10-01 实测）
 * `GET https://momoyu.cc/api/hot/list?type=0`（带浏览器 UA）→ 200 JSON：
 * 13 个来源（知乎热榜 / 微博热搜 / 豆瓣热话 / 虎扑步行街 / …）各带自己的条目
 * （{title, extra, link}）与 **create_time（站方自己的抓取时刻）**。
 * 响应**不带 CORS** → 浏览器直连做不了，只能构建期快照。
 *
 * ## 口径
 *   · 每来源最多保留前 20 条（快照体积可控；热榜头部的信息密度本来就集中在前排）；
 *   · 每个来源块的 fetchedAt 用**站方 create_time**（那是数据真正的抓取时刻，
 *     比我们的抓取时刻更诚实）；
 *   · AI 过滤**不在这一步做**：页面端用词边界关键词（isAiText）过滤，
 *     "全部 / 仅 AI"切换由读者自己选。
 *
 * ## 失败语义
 * 抓不到 / 解析不足 → 非零退出、不写文件，旧快照原样保留（宁可旧，不可错）。
 *
 * ## 手动跑
 *   npm run snap:momoyu
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** 只有"直接运行"才跑主流程 —— 测试 import 解析器时不能触发抓取 */
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

const API_URL = 'https://momoyu.cc/api/hot/list?type=0';
const OUT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../web/public/assets/data/momoyu-hot.json'
);
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 trend-snapshot/1.0';
const PER_SOURCE_LIMIT = 20;
const MIN_SOURCES = 3; // 少于这个数 = 结构变了/半截数据，拒绝产出
const MIN_ITEMS = 1;

/**
 * momoyu 的响应 → 快照结构（导出给测试）。
 * data: [{ id, sort, name, source_key, icon_color, data: [{id, title, extra, link}], create_time }]
 */
export function normalizeMomoyu(json) {
  const blocks = Array.isArray(json?.data) ? json.data : [];
  const sources = [];
  for (const b of blocks) {
    const name = String(b?.name || '').trim();
    if (!name) continue;
    const items = (Array.isArray(b?.data) ? b?.data : []).slice(0, PER_SOURCE_LIMIT)
      .map((x) => ({
        title: String(x?.title || '').trim(),
        url: String(x?.link || ''),
        // extra 是站方给的"热度"文字（'552 万' / '59回复'），保留原文，不当数字解析
        extra: String(x?.extra || '').trim(),
      }))
      .filter((x) => x.title && x.url);
    if (items.length < MIN_ITEMS) continue;
    sources.push({
      key: String(b?.source_key || name),
      name,
      // 站方的抓取时刻（数据的新鲜度以它为准，比"我们什么时候拉的"更接近真相）
      fetchedAt: String(b?.create_time || ''),
      items,
    });
  }
  return sources;
}

async function main() {
const res = await fetch(API_URL, {
  headers: { accept: 'application/json', 'user-agent': UA },
  signal: AbortSignal.timeout(25000),
});
if (!res.ok) {
  console.error(`✗ 抓取失败：HTTP ${res.status}（旧快照保留，不提交）`);
  process.exit(1);
}
const json = await res.json();
if (json?.status !== 100000) {
  console.error(`✗ 站方返回 status=${json?.status}（非成功码）—— 旧快照保留`);
  process.exit(1);
}
const sources = normalizeMomoyu(json);
if (sources.length < MIN_SOURCES) {
  console.error(`✗ 只解析出 ${sources.length} 个来源（< ${MIN_SOURCES}，疑似结构变了）—— 旧快照保留`);
  process.exit(1);
}

const snapshot = {
  source: 'https://momoyu.cc/',
  fetchedAt: new Date().toISOString(), // 本次构建期抓取时刻（各来源另有站方时刻）
  sources,
};
await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
await fs.writeFile(OUT_PATH, JSON.stringify(snapshot, null, 1) + '\n');

const total = sources.reduce((n, s) => n + s.items.length, 0);
console.log(`✓ ${sources.length} 个来源 · 共 ${total} 条 · 写入 ${path.relative(process.cwd(), OUT_PATH)}`);
console.log(`  来源：${sources.map((s) => s.name).join(' · ')}`);
}

if (isMain) await main();
