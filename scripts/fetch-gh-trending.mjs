#!/usr/bin/env node
/**
 * GitHub Trending 快照抓取 —— 抓 `github.com/trending`（每日榜）→ 解析 → 落
 * `web/public/assets/data/gh-trending.json`。
 *
 * ## 为什么是"构建期快照"而不是浏览器直连
 *   · github.com 的页面响应**不带 CORS**（2026-09-30 实测），浏览器直连必被拦；
 *   · 页面是 ~650KB 的 HTML，也不该让每个访客都拖一遍。
 * 所以由 GitHub Actions 每日跑一次这个脚本，把解析结果提交进仓库
 * （`.github/workflows/gh-trending-snapshot.yml`），构建原样发布。
 *
 * ## 失败语义（这是设计，不是兜底）
 * 抓不到 / 解析不出 ≥5 条 → **非零退出、不写文件**。工作流侧"失败不提交"，
 * 仓库里的旧快照原样保留 —— 线上继续显示旧快照与它的旧抓取时刻，
 * 绝不拿残缺数据顶上，也不让页面白板。
 *
 * ## 解析器与页面同一份
 * 解析逻辑 `parseGhTrending` 从 `web/public/assets/trend.js` import ——
 * 面面板与抓取脚本不会各养一份正则，GitHub 改版只需要修一处。
 *
 * ## 怎么手动跑
 *   npm run snap:gh-trending
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseGhTrending } from '../web/public/assets/trend.js';

const TRENDING_URL = 'https://github.com/trending';
const OUT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../web/public/assets/data/gh-trending.json'
);
/** 少于这个数就认定"GitHub 改版了 / 页面结构变了"，拒绝产出坏快照 */
const MIN_ENTRIES = 5;

const res = await fetch(TRENDING_URL, {
  headers: {
    accept: 'text/html',
    // 表明身份：抓取方是开源站的每日快照，不是匿名爬虫
    'user-agent': 'trend-site-snapshot/1.0 (+https://github.com/shaowenchen/trend)',
  },
});
if (!res.ok) {
  console.error(`✗ 抓取失败：HTTP ${res.status}（旧快照保留，不提交）`);
  process.exit(1);
}
const html = await res.text();
const entries = parseGhTrending(html);
if (entries.length < MIN_ENTRIES) {
  console.error(`✗ 只解析出 ${entries.length} 条（< ${MIN_ENTRIES}，疑似页面结构变了）—— 旧快照保留，不提交`);
  process.exit(1);
}

const snapshot = {
  source: TRENDING_URL,
  // 抓取时刻：页面上"构建期快照 · 抓取于 …"与回退判断都靠它，必须是真的
  fetchedAt: new Date().toISOString(),
  entries,
};

await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
await fs.writeFile(OUT_PATH, JSON.stringify(snapshot, null, 1) + '\n');

const aiCount = entries.filter((e) => /ai|llm|gpt|agent/i.test(`${e.repo} ${e.desc}`)).length;
console.log(`✓ ${entries.length} 条仓库 · 写入 ${path.relative(process.cwd(), OUT_PATH)} · fetchedAt ${snapshot.fetchedAt}`);
console.log(`  （粗略含 AI 字样的约 ${aiCount} 条；精确过滤由页面按词边界做）`);
