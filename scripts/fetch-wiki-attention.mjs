#!/usr/bin/env node
/**
 * Wikipedia AI 词条关注度快照 —— `web/public/assets/data/wiki-attention.json`。
 *
 * ## 这是什么榜（与站内其它榜都不同）
 * 站内所有榜量的都是**技术圈的热度**：模型下载、评测分、token 用量、GitHub 星标。
 * 这一张量的是**大众注意力** —— 某个 AI 词条今天被多少人真的打开看了。
 * ChatGPT 一条 5.6 万次浏览，与它今天在 HN 上多少分是两件独立的事。
 *
 * ## 为什么必须快照
 * wikimedia 的 pageviews API **有** CORS（实测 `access-control-allow-origin: *`），
 * 但两个原因让它只能走构建期：
 *   1. 它要求一个**带联系方式**的 User-Agent，浏览器发不出自定义 UA
 *      （`User-Agent` 是 forbidden header，fetch 里设不了）；
 *   2. 无 UA 请求实测 **403**，所以浏览器直连这条路是死的。
 *
 * ## 两个端点合起来用
 *   · `.../metrics/pageviews/top/<proj>/all-access/<Y>/<M>/<D>` —— 每个语种
 *     **当日 top1000**（一次请求，约 55KB）。给的是绝对浏览量，但**没有历史**，
 *     所以"涨了多少"得靠下面那个算。
 *   · `.../metrics/pageviews/per-article/<proj>/all-access/user/<article>/daily/<from>/<to>`
 *     —— 单条目按天序列。只对我们的 **AI 词条**（十来个）取，用来算 7 日走势。
 *
 * ## 为什么按语种分别取（而不是只取英文）
 * "AI 的关注度"在不同语言里是不同的事：中文维基看的是 Claude／人工智能，
 * 日文看 Anthropic。只取 en 会把非英语世界的注意力整块丢掉。
 * `PROJECTS` 是那 8 个语种 —— 每个一次请求，合计 9 次（含下面说的重试）。
 *
 * ## 口径（不编数字）
 *   · `views` 是**昨日**（UTC）的绝对浏览量 —— pageviews 数据 T+1 才齐，
 *     当天的取不到（实测 404）；
 *   · `trend` 是"最近 7 日均值 ÷ 前 7 日均值"的比值，只在**两边都有数据**时给，
 *     否则是 null（页面上显示"—"，不是 0，也不编一个 1.0）；
 *   · 词条白名单 `AI_ARTICLES` 是**各语种各写一份**的：维基的条目名不通用
 *     （中文是「人工智能」、日文是「人工知能」、俄文是西里尔字母），
 *     硬去猜跨语言对应关系一定会错，所以逐个列出来。
 *
 * ## 失败语义
 * 某个语种取不到 → 跳过它（其他语种照常）；**全部**取不到才非零退出、不写文件，
 * 旧快照原样保留。部分成功时快照里如实记 `skipped`，页面把缺的语种说出来。
 *
 * ## 手动跑
 *   npm run snap:wiki
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

const OUT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../web/public/assets/data/wiki-attention.json'
);

/**
 * wikimedia 要求带联系方式的 UA —— 这不是客气，是**硬要求**：
 * 不带就 403（实测）。所以这里的联系方式是真的。
 */
const UA = 'trend-snapshot/1.0 (https://github.com/shaowenchen/trend; mail@chenshaowen.com)';

const API = 'https://wikimedia.org/api/rest_v1/metrics/pageviews';

/**
 * 取哪几个语种。顺序 = 快照里的顺序 = 页面分组下拉的顺序（英文在前，因为量最大）。
 * 这 8 个是实测**都有 top1000 且有 AI 词条命中**的（其余语种要么数据少、
 * 要么命中的是无关词）。
 */
export const PROJECTS = [
  'en.wikipedia',
  'zh.wikipedia',
  'ja.wikipedia',
  'de.wikipedia',
  'fr.wikipedia',
  'es.wikipedia',
  'ru.wikipedia',
  'ko.wikipedia',
];

/**
 * 各语种的 AI 词条白名单 —— **只对这些条目算 7 日走势**（走势要多一次请求，
 * 不能对 top1000 全做）。它们也同时是"哪些算 AI"的判据之一，见 `isAiArticle`。
 *
 * ★ 逐语种手列，不做跨语言映射：维基的条目名不通用，猜映射必错。
 * 若某个语种没有对应条目（例如韩文维基没有独立的大模型条目），就不列 ——
 * 少一条比列一个不存在的条目好（后者会让走势查询空转）。
 */
export const AI_ARTICLES = {
  'en.wikipedia': ['ChatGPT', 'Artificial_intelligence', 'OpenAI', 'Anthropic', 'Claude_(language_model)', 'Gemini_(chatbot)', 'DeepSeek', 'Large_language_model'],
  'zh.wikipedia': ['ChatGPT', '人工智能', 'OpenAI', 'Anthropic', 'Claude_(语言模型)', 'DeepSeek', '大型语言模型', '生成式人工智慧'],
  'ja.wikipedia': ['ChatGPT', '人工知能', 'OpenAI', 'Anthropic', '大規模言語モデル'],
  'de.wikipedia': ['ChatGPT', 'Künstliche_Intelligenz', 'OpenAI', 'Anthropic', 'Großes_Sprachmodell'],
  'fr.wikipedia': ['ChatGPT', 'Intelligence_artificielle', 'OpenAI', 'Anthropic', 'Grand_modèle_de_langage'],
  'es.wikipedia': ['ChatGPT', 'Inteligencia_artificial', 'OpenAI', 'Anthropic', 'Modelo_grande_de_lenguaje'],
  'ru.wikipedia': ['ChatGPT', 'Искусственный_интеллект', 'OpenAI', 'Anthropic', 'Большая_языковая_модель'],
  'ko.wikipedia': ['ChatGPT', '인공지능', 'OpenAI', 'Anthropic', '거대 언어 모델'],
};

/**
 * 非白名单条目里，标题命中这些词根的也算 AI（跨语种各带一份词根）。
 *
 * ★ 为什么用**词根**而不是整词：维基的条目名会把词变形（Intelligence /
 * Inteligencia / Искусственный），整词匹配会漏掉大半。
 * ★ 为什么要**词边界**：`Mai_68`（法国五月风暴）里有 "ai"、`Claude_Nougaro`
 * （法国歌手）是个人名 —— 实测这两个都在 fr 的榜里，且都被朴素子串匹配误判过。
 */
const AI_ROOTS = [
  // 拉丁/英法德西
  'intelligen', 'chatgpt', 'openai', 'anthropic', 'claude_(', 'gemini_(', 'deepseek',
  'llama', 'machine_learning', 'neural_net', 'large_language', 'generative_ai',
  // 中文
  '人工智能', '大模型', '生成式', '深度学习', '大語言模型', '大型語言模型',
  // 日文
  '人工知能', '大規模言語', '生成ai',
  // 俄文 / 韩文
  'искусственн', 'нейронн', '인공지능', '거대언어', '언어모델',
];

/** 已知的**误报**（实测撞到过的）：命中词根但其实不是 AI。逐条排掉。 */
const AI_EXCLUDE = [
  'Claude_Nougaro',       // fr：法国歌手 Claude Nougaro（"claude_(" 之外的 claude）
  'Claude_Monet',         // 画家
  'Claude_Debussy',       // 作曲家
  'Mai_68',               // fr：五月风暴（"ai" 子串）
  // ru：单独的形容词「Искусственный」（"人造的"），没有名词 —— 实测它确实在榜里，
  // 但读者点进去看到的是一个消歧义页，不是 AI 话题。按**精确等于**排掉，
  // 免得连「Искусственный_интеллект」一起排了。
  'Искусственный',
];

/**
 * 标题是不是 AI 相关。
 *
 * 三步，顺序有讲究：
 *   1. **白名单精确命中** → 是（这是我们认定一定相关的条目）；
 *   2. **已知误报** → 否（实测撞到过的：歌手、画家、五月风暴…）；
 *   3. **词根匹配，但只看第一个逗号之前那段** → 维基的描述性标题形如
 *      「Порнография, сгенерированная искусственным интеллектом」（由 AI 生成的
 *      色情内容）—— AI 词根出现在**逗号之后的限定从句**里，主题其实是「色情内容」。
 *      这类衍生/提及型条目不进榜；而「Искусственный интеллект」「Artificial
 *      intelligence」的主角就在开头，天然通过。
 */
export function isAiArticle(title, project) {
  const t = String(title || '');
  if (!t) return false;
  if ((AI_ARTICLES[project] || []).includes(t)) return true;
  if (AI_EXCLUDE.includes(t)) return false;
  if (AI_EXCLUDE.some((x) => x.endsWith('_') && t.startsWith(x))) return false;
  // 只看第一个逗号之前 —— 逗号后面是限定/说明从句，不是条目的主题
  const head = t.split(',')[0];
  const low = head.toLowerCase().replace(/-/g, '_');
  return AI_ROOTS.some((r) => low.includes(r));
}

/** 把项目名变成显示名（`zh.wikipedia` → `zh`）—— 页面按它分组 */
export function projectLabel(project) {
  return String(project || '').replace(/\.wikipedia$/, '') || '?';
}

/** YYYY/MM/DD */
const ymd = (d) => `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
/** YYYYMMDD（per-article 端点要这个格式） */
const ymdCompact = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;

const daysAgo = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d; };

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

/**
 * 取一个语种的**昨日 top1000**，筛出 AI 条目。
 * 找不到昨日的就往前退一天（数据 T+1 补齐，跨时区/上游延迟时昨天可能还没齐）。
 */
export async function fetchTop(project, { backDays = 3 } = {}) {
  let lastErr = null;
  for (let back = 1; back <= backDays; back += 1) {
    const day = daysAgo(back);
    try {
      const j = await getJson(`${API}/top/${project}/all-access/${ymd(day)}`);
      const arts = j?.items?.[0]?.articles;
      if (!Array.isArray(arts) || !arts.length) throw new Error('top 里没有 articles');
      return { date: ymd(day).replaceAll('/', '-'), articles: arts };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('top 取不到');
}

/**
 * 单个条目的 7 日走势：最近 7 日均值 ÷ 前 7 日均值。
 * 两边都得有数据才给值 —— 新条目（前半段没有）返回 null，而不是拿 0 当分母编一个 ∞。
 */
export async function fetchTrend(project, article) {
  const from = ymdCompact(daysAgo(15));
  const to = ymdCompact(daysAgo(1));
  try {
    const j = await getJson(`${API}/per-article/${project}/all-access/user/${encodeURIComponent(article)}/daily/${from}/${to}`);
    const items = (j?.items || []).map((x) => ({ ts: String(x.timestamp).slice(0, 8), views: Number(x.views) || 0 }));
    if (items.length < 10) return null; // 不够 14 天：算不出两个 7 日窗口
    items.sort((a, b) => a.ts.localeCompare(b.ts));
    const recent = items.slice(-7);
    const prev = items.slice(-14, -7);
    const avg = (xs) => xs.reduce((s, x) => s + x.views, 0) / (xs.length || 1);
    const a = avg(recent);
    const b = avg(prev);
    if (!(b > 0)) return null; // 前一周没有数据 → 不给比值
    return { recentAvg: Math.round(a), prevAvg: Math.round(b), ratio: a / b };
  } catch {
    return null; // 单条走势拿不到不影响这张榜（views 仍是真实值）
  }
}

/**
 * 把各语种的 top 结果摊平成行。
 * `trends` 是 `{ '<project>|<article>': {ratio, recentAvg, prevAvg} }`，
 * 只对白名单条目查过，所以缺键是常态（那些行 trend 为 null）。
 */
export function flattenWiki(blocks, trends = {}) {
  const out = [];
  for (const b of blocks) {
    for (const a of b.articles || []) {
      if (!isAiArticle(a.article, b.project)) continue;
      const t = trends[`${b.project}|${a.article}`] || null;
      out.push({
        project: projectLabel(b.project),
        article: String(a.article || ''),
        views: Number(a.views) || 0,
        // 榜单日期（各语种可能落到不同的日子：某个语种昨天没数据就退了一天）
        date: b.date,
        trend: t ? Number(t.ratio.toFixed(3)) : null,
        recentAvg: t ? t.recentAvg : null,
        prevAvg: t ? t.prevAvg : null,
      });
    }
  }
  return out;
}

/** 条目的可读标题：把下划线换成空格、去掉消歧义括号 */
export function wikiTitle(article) {
  return String(article || '').replaceAll('_', ' ').replace(/\s*\([^)]*\)\s*$/, '').trim();
}

/** 条目地址（维基的 URL 形式：下划线变空格 + encodeURI） */
export function wikiUrl(project, article) {
  const proj = String(project || '').replace(/\.wikipedia$/, '');
  const lang = proj.includes('.') ? proj.split('.')[0] : proj;
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(article || '').replaceAll(' ', '_'))}`;
}

async function main() {
  const blocks = [];
  const skipped = [];
  for (const project of PROJECTS) {
    try {
      const top = await fetchTop(project);
      blocks.push({ project, ...top });
      console.log(`  ✓ ${project}  ${top.date}  top${top.articles.length}`);
    } catch (e) {
      skipped.push({ project: projectLabel(project), reason: String(e.message).slice(0, 120) });
      console.warn(`  ✗ ${project}  ${e.message}`);
    }
  }

  if (!blocks.length) {
    console.error('✗ 所有语种都取不到 —— 旧快照保留，不写文件');
    process.exit(1);
  }

  // 只对**白名单条目**算走势（每个一次请求）。上界是 8 语种 × 8 条 = 64 次，
  // 但实际远小于此（很多条目不在当日 top1000 里，先过滤再查）。
  const trends = {};
  for (const b of blocks) {
    const want = (AI_ARTICLES[b.project] || []).filter((a) => (b.articles || []).some((x) => x.article === a));
    for (const article of want) {
      const t = await fetchTrend(b.project, article);
      if (t) trends[`${b.project}|${article}`] = t;
    }
  }

  const rows = flattenWiki(blocks, trends);
  if (!rows.length) {
    console.error('✗ 一个 AI 条目都没解析出来（疑似判据失效）—— 旧快照保留');
    process.exit(1);
  }

  const snapshot = {
    fetchedAt: new Date().toISOString(),
    // 各语种各自的数据日期（可能不同）—— 页面按它标注，不假装是同一个"今天"
    dates: [...new Set(rows.map((r) => r.date))].sort(),
    skipped,
    sources: blocks.map((b) => ({ key: projectLabel(b.project), name: projectLabel(b.project), fetchedAt: b.date, items: rows.filter((r) => r.project === projectLabel(b.project)).map((r) => ({ title: r.article, extra: '', url: wikiUrl(b.project, r.article), views: r.views, trend: r.trend })) })),
  };
  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(snapshot, null, 1) + '\n');
  console.log(`✓ ${blocks.length} 个语种 · 共 ${rows.length} 条 AI 词条 · 写入 ${path.relative(process.cwd(), OUT_PATH)}`);
  if (skipped.length) console.log(`  跳过：${skipped.map((s) => s.project).join(' · ')}`);
}

if (isMain) await main();
