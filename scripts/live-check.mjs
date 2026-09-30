#!/usr/bin/env node
/**
 * 上游数据源体检 —— **真实网络请求**，不进 `npm test`（测试不该依赖网络）。
 *
 * ## 为什么需要它
 * 本站的关键假设是"浏览器能直接拉这些上游接口"，而这个假设**只由上游的
 * CORS 策略决定**，随时可能被对方改掉。一旦某个源关掉 CORS，页面会静默地
 * 只少一块数据（每个面板独立失败是刻意的设计），从站内看不出来。
 * 所以需要一个能主动跑、并把结论**打印出来**的检查。
 *
 * ## 怎么用
 *   npm run test:live
 * 它做的事：对每个源发一个带 `Origin:` 的请求，报告
 *   状态码 / Content-Type / 字节数 / **是否有 access-control-allow-origin** / 耗时。
 * 末尾给出一个结论行：哪些源今天可用、哪些不可用。
 *
 * ## 关于评测榜
 * 它会真的把全部 46 页拉完（约 9 秒），因为"页数是否还等于 46""字段名有没有变"
 * 恰恰是最需要被发现的漂移。字段解析用 web/public/assets/trend.js 里的**同一份**
 * 实现（normalizeEval），所以这里报"能解析出 N 行"就等于页面能出数。
 */
import {
  normalizeEval, parseFlatYamlList, bestAiderRows,
  rankPapers, rankRepos, flattenModelsDev, rankSweBench, sweBoardNames,
  openrouterBoard, openrouterNames,
  rankClimbing, rankAuthors, rankPerformance, rankAa, rankApps, flattenMedia,
} from '../web/public/assets/trend.js';

/**
 * `ORIGIN` 只影响一件事：请求里的 `Origin:` 头。HF 的多数端点会**回显**它，
 * Aider / models.dev / SWE-bench 那几个是 `*`。所以这个值填什么都行，
 * 它的作用是让体检的输出与"真实站点发出的请求"对齐，便于读日志。
 * 没设就按本机预览地址。
 */
const ORIGIN = process.env.SITE_ORIGIN || 'http://localhost:8788';

const SOURCES = [
  {
    name: 'HF 趋势模型',
    url: 'https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=50',
    kind: 'json',
  },
  { name: 'HF 最受喜欢', url: 'https://huggingface.co/api/models?sort=likes&direction=-1&limit=50', kind: 'json' },
  { name: 'HF 下载最多', url: 'https://huggingface.co/api/models?sort=downloads&direction=-1&limit=50', kind: 'json' },
  {
    name: 'Aider 编程榜',
    url: 'https://raw.githubusercontent.com/Aider-AI/aider/main/aider/website/_data/polyglot_leaderboard.yml',
    kind: 'yml',
  },
];

/* 面板 6-9 的源。GitHub 的匿名搜索限流是 10 次/分钟，所以这里只发 1 个请求。 */
const EXTRA = [
  {
    name: 'HF Spaces 趋势',
    url: 'https://huggingface.co/api/spaces?sort=trendingScore&direction=-1&limit=50',
    check: (d) => `${d.length} 个应用；榜首 ${d[0]?.id}`,
  },
  {
    name: 'HF 数据集趋势',
    url: 'https://huggingface.co/api/datasets?sort=trendingScore&direction=-1&limit=50',
    check: (d) => `${d.length} 个数据集；榜首 ${d[0]?.id}`,
  },
  {
    name: 'HF 每日论文',
    url: 'https://huggingface.co/api/daily_papers?limit=50',
    check: (d) => {
      const rows = rankPapers(d);
      return `${rows.length} 篇；最高赞 ${rows[0]?.votes}（${String(rows[0]?.title).slice(0, 40)}…）`;
    },
  },
  {
    name: 'GitHub 高星项目',
    url: `https://api.github.com/search/repositories?q=${encodeURIComponent(`topic:llm created:>${new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)}`)}&sort=stars&order=desc&per_page=30`,
    check: (d) => {
      const rows = rankRepos(d.items, 'stargazers_count');
      return `${rows.length} 个仓库；榜首 ${rows[0]?.full_name}`;
    },
  },
];

/** 面板 10：models.dev（4.8MB，只验证能否摊平，不打印内容） */
const MODELS_DEV_URL = 'https://models.dev/api.json';

/** 面板 12：OpenRouter（用量榜 + 模型清单，见下面的体检段） */
const OR_API = 'https://openrouter.ai/api/frontend/v1';
const OPENROUTER_RANKINGS_URL = `${OR_API}/rankings/models`;
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

/** 面板 11：SWE-bench（4MB）。★ 重点验证 resolved 的量纲没被上游改口径。 */
const SWE_BENCH_URL =
  'https://raw.githubusercontent.com/swe-bench/swe-bench.github.io/master/data/leaderboards.json';

const EVAL_ENDPOINT = 'https://datasets-server.huggingface.co/rows';
const EVAL_PAGE = 100;
const EVAL_BATCH = 8;
const evalUrl = (offset) =>
  `${EVAL_ENDPOINT}?dataset=open-llm-leaderboard%2Fcontents&config=default&split=train&offset=${offset}&length=${EVAL_PAGE}`;

let bad = 0;

/** 发一个带 Origin 的请求，回报状态/类型/大小/CORS/耗时 */
async function probe(name, url, { kind = 'json' } = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: { Origin: ORIGIN, accept: kind === 'yml' ? 'text/plain' : 'application/json' },
    });
    const cors = res.headers.get('access-control-allow-origin');
    const buf = Buffer.from(await res.arrayBuffer());
    const ms = Date.now() - t0;
    const corsOk = Boolean(cors);
    if (!res.ok || !corsOk) bad += 1;
    console.log(
      `  ${res.ok && corsOk ? '✅' : '❌'} ${name.padEnd(16)}` +
        `${res.status} · ${(buf.length / 1024).toFixed(0)}KB · ${ms}ms · ` +
        `CORS: ${cors ?? '（无 —— 浏览器会被拦）'}`
    );
    return { res, buf, cors, ms };
  } catch (e) {
    bad += 1;
    console.log(`  ❌ ${name.padEnd(16)}请求失败：${e.message}`);
    return null;
  }
}

console.log(`\n上游数据源体检（Origin: ${ORIGIN}）\n`);

/* ---------------- 三个模型榜 + Aider ---------------- */

for (const s of SOURCES) {
  const r = await probe(s.name, s.url, { kind: s.kind });
  if (!r || !r.res.ok) continue;
  const text = r.buf.toString('utf8');
  try {
    if (s.kind === 'yml') {
      const rows = bestAiderRows(parseFlatYamlList(text));
      console.log(`     └ 解析出 ${rows.length} 个模型；榜首 ${rows[0]?.model} (${rows[0]?.rate}%)`);
    } else {
      const data = JSON.parse(text);
      console.log(`     └ ${data.length} 个模型；榜首 ${data[0]?.id}`);
    }
  } catch (e) {
    bad += 1;
    console.log(`     └ ❌ 解析失败（上游格式可能已变）：${e.message}`);
  }
}

/* ---------------- 面板 6-9 ---------------- */

console.log('');
for (const src of EXTRA) {
  const r = await probe(src.name, src.url);
  if (!r || !r.res.ok) continue;
  try {
    const d = JSON.parse(r.buf.toString('utf8'));
    console.log(`     └ ${src.check(d)}`);
  } catch (e) {
    bad += 1;
    console.log(`     └ ❌ 解析失败：${e.message}`);
  }
}

/* ---------------- 面板 12：OpenRouter 用量榜 ----------------
 * 两个端点都要查，而且要点是**它们之间的关系**：
 *   · 用量榜（rankings）—— 主数据，按天的模型用量；
 *   · 模型清单（/api/v1/models）—— 只为拿显示名。
 * 名字连接率是这里最值得打印的数：清单只有对话模型，用量里却含音频/视频/
 * embedding，所以覆盖率是"这个面板好不好看"的实际指标。掉下去就说明
 * 上游改了 slug 或缩了清单，而页面上只会表现为"某些行显示 slug"。
 */
{
  const r = await probe('OpenRouter 用量', OPENROUTER_RANKINGS_URL);
  const rm = await probe('OpenRouter 模型', OPENROUTER_MODELS_URL);
  if (r?.res.ok) {
    try {
      const { rows, date, total } = openrouterBoard(JSON.parse(r.buf.toString('utf8')).data);
      const nameOf = openrouterNames(rm?.res.ok ? JSON.parse(rm.buf.toString('utf8')).data : []);
      // 覆盖率按**用量**加权，不按条数：读者关心的是"榜上大头的名字对不对"
      const tok = (rr) => (nameOf(rr.key) ? rr.tokens : 0);
      const named = rows.reduce((a, rr) => a + tok(rr), 0);
      console.log(
        `     └ ${date.slice(0, 10)} · ${rows.length} 个模型（已合并变体）· 总 ${(total / 1e12).toFixed(0)}T tokens；` +
          `榜首 ${nameOf(rows[0]?.key) ?? rows[0]?.key} (${rows[0]?.share.toFixed(1)}%)`
      );
      console.log(`     └ 名字覆盖率（按用量）：${((named / (total || 1)) * 100).toFixed(1)}%`);
    } catch (e) {
      bad += 1;
      console.log(`     └ ❌ 解析失败（上游格式可能已变）：${e.message}`);
    }
  }
}

/* ---------------- 面板 12-16：OpenRouter 的四张榜 ----------------
 * 都是 api/frontend 那一路，且**形状互不相同**（见 docs/trend-sources.md §4）。
 * 这里逐条打印"能解析出几行、榜首是谁"，因为这几张榜最容易出的错是
 * "形状变了但解析器还在按老形状取值" —— 页面上只表现为行数变少，不报错。
 */
{
  const eps = [
    ['上升榜 climbing', 'discovery', (d) => rankClimbing(d.data.climbing, 'climbing'), (r) => `${r.slug} +${r.growth.toFixed(1)}%`],
    ['突破榜 breakouts', 'discovery', (d) => rankClimbing(d.data.breakouts, 'breakouts'), (r) => `${r.slug} +${r.growth.toFixed(1)}%`],
    ['厂商份额', 'discovery', (d) => rankAuthors(d.data.authors), (r) => `${r.author} ${r.share.toFixed(1)}%`],
    ['性能（延迟）', 'performance', (d) => rankPerformance(d.data, 'latency'), (r) => `${r.name} ${r.latency}ms`],
    ['性能（吞吐）', 'performance', (d) => rankPerformance(d.data, 'throughput'), (r) => `${r.name} ${r.throughput}tok/s`],
    ['AA 综合智能', 'benchmarks', (d) => rankAa(d.data.aaData.intelligence), (r) => `${r.name.slice(0, 30)} ${r.score}`],
    ['AA 编程', 'benchmarks', (d) => rankAa(d.data.aaData.coding), (r) => `${r.name.slice(0, 30)} ${r.score}`],
    ['AA 智能体', 'benchmarks', (d) => rankAa(d.data.aaData.agentic), (r) => `${r.name.slice(0, 30)} ${r.score}`],
    ['应用（本日）', 'apps', (d) => rankApps(d.data.day), (r) => `${r.title} ${(r.tokens / 1e9).toFixed(0)}B`],
    ['图像模型', 'image-output', (d) => flattenMedia(d), (r) => r.slug],
    ['视频模型', 'video-output-hours', (d) => flattenMedia(d), (r) => r.slug],
    ['语音模型', 'stt-transcript-characters', (d) => flattenMedia(d), (r) => r.slug],
  ];
  // discovery / performance / benchmarks / apps 各取一次，避免重复请求
  const cache = new Map();
  for (const [name, ep, pick, fmt] of eps) {
    if (!cache.has(ep)) cache.set(ep, await probe(`OR ${name}`, `${OR_API}/rankings/${ep}`));
    const r = cache.get(ep);
    if (!r?.res.ok) continue;
    try {
      const rows = pick(JSON.parse(r.buf.toString('utf8')));
      const flag = rows.length ? '✅' : '❌';
      if (!rows.length) bad += 1;
      console.log(`     ${flag} ${name.padEnd(16)} ${rows.length} 行；榜首 ${rows[0] ? fmt(rows[0]) : '—'}`);
    } catch (e) {
      bad += 1;
      console.log(`     ❌ ${name} 解析失败（上游形状可能已变）：${e.message}`);
    }
  }
}

/* ---------------- 面板 10：models.dev（体量大，单独量一次） ---------------- */

{
  // ★ 这两条现在都是**首屏**成本（进页面即加载），所以耗时值得盯着
  const r = await probe('models.dev 模型库', MODELS_DEV_URL);
  if (r && r.res.ok) {
    try {
      const rows = flattenModelsDev(JSON.parse(r.buf.toString('utf8')));
      const dated = rows.filter((x) => x.release);
      console.log(`     └ ${rows.length} 个模型（${dated.length} 个有发布日期）；最新 ${dated[0]?.name} (${dated[0]?.release})`);
    } catch (e) {
      bad += 1;
      console.log(`     └ ❌ 摊平失败：${e.message}`);
    }
  }
}

/* ---------------- 面板 11：SWE-bench ---------------- */

{
  const r = await probe('SWE-bench 官方榜', SWE_BENCH_URL);
  if (r && r.res.ok) {
    try {
      const boards = JSON.parse(r.buf.toString('utf8')).leaderboards;
      const names = sweBoardNames(boards);
      const rows = rankSweBench(boards, 'Verified');
      // 量纲守卫：官方 resolved 是 0–100 的百分数。若哪天变成 0–1，这里会立刻报出来。
      const outOfRange = rows.filter((x) => x.score < 0 || x.score > 100);
      console.log(`     └ 子榜 ${names.join('/')}；Verified 去重后 ${rows.length} 个模型；榜首 ${rows[0]?.model} ${rows[0]?.score}%`);
      if (outOfRange.length) {
        bad += 1;
        console.log(`     └ ❌ resolved 量纲异常（超出 0-100）：${JSON.stringify(outOfRange.slice(0, 3))}`);
      }
    } catch (e) {
      bad += 1;
      console.log(`     └ ❌ 解析失败：${e.message}`);
    }
  }
}

/* ---------------- 评测榜（全量分页） ---------------- */

console.log('');
const t0 = Date.now();
let total = null;
let rows = [];
let failed = 0;

try {
  const first = await probe('评测榜 首页', evalUrl(0));
  if (first?.res.ok) {
    const j = JSON.parse(first.buf.toString('utf8'));
    total = j.num_rows_total;
    rows = j.rows.map((x) => x.row);
    const pageCount = Math.ceil(total / EVAL_PAGE);
    const offsets = [];
    for (let o = EVAL_PAGE; o < pageCount * EVAL_PAGE; o += EVAL_PAGE) offsets.push(o);

    for (let i = 0; i < offsets.length; i += EVAL_BATCH) {
      const batch = offsets.slice(i, i + EVAL_BATCH);
      const got = await Promise.all(
        batch.map(async (o) => {
          try {
            const res = await fetch(evalUrl(o), { headers: { Origin: ORIGIN, accept: 'application/json' } });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
          } catch {
            failed += 1;
            return null;
          }
        })
      );
      for (const g of got) if (g) rows.push(...g.rows.map((x) => x.row));
    }

    const ok = rows.map(normalizeEval).filter(Boolean);
    const seen = new Map();
    for (const x of ok) {
      const p = seen.get(x.model);
      if (!p || x.score > p.score) seen.set(x.model, x);
    }
    const ranked = [...seen.values()].sort((a, b) => b.score - a.score);
    if (failed) bad += 1;
    console.log(
      `  ${failed ? '⚠️' : '✅'} 评测榜 全量     ${total} 行 / ${pageCount} 页 · ` +
        `${rows.length} 行到手 · ${failed} 页失败 · ${((Date.now() - t0) / 1000).toFixed(1)}s`
    );
    console.log(`     └ 可解析 ${ok.length} 行 / ${ranked.length} 个模型；榜首 ${ranked[0]?.model} (平均 ${ranked[0]?.score.toFixed(1)})`);
  }
} catch (e) {
  bad += 1;
  console.log(`  ❌ 评测榜 失败：${e.message}`);
}

/* ---------------- 结论 ---------------- */

console.log(
  bad === 0
    ? '\n✅ 全部源今天可用（以上耗时即访客的实测等待）。\n'
    : `\n❌ 有 ${bad} 项异常：页面会对应地少一块数据（每个面板独立失败，不影响其它面板）。\n`
);
process.exitCode = bad === 0 ? 0 : 1;
