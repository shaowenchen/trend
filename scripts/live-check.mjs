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

/* ---------------- 面板 10：models.dev（体量大，单独量一次） ---------------- */

{
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
