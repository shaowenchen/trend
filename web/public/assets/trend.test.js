/**
 * trend.js 的纯逻辑测试。
 *
 * 为什么只测这几个函数：trend.js 其余部分是"取数据 + 塞进 DOM"，
 * 真正会**静默出错值**的是这两段 ——
 *   1. 手写的 YAML 子集解析（上游格式一变就可能解析出错值而不是报错）
 *   2. 评测行的字段提取与"同一模型取最高分"的合并规则
 * 所以测试集中打在这两处，并用**上游真实响应片段**做 fixture（不是编的样例）。
 *
 * 用真实的 polyglot_leaderboard.yml 片段：前 3 个元素（含缩进与类型混合）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseFlatYamlList, bestAiderRows, normalizeEval, compact, num, table, esc, rankBadge, bar,
  normalizePaper, rankPapers, rankRepos, flattenModelsDev, fmtCost,
  rankSweBench, sweBoardNames, applyBoardState, groupOptions, controlsHtml,
  cardGrid, detailFromCols, detailRow,
  openrouterBoard, openrouterNames, openrouterLabel, attachPanel,
  growthPct, rankClimbing, rankAuthors, rankPerformance, rankAa, rankApps, flattenMedia,
  fetchAllEvalPages, evalBackoffMs, evalRetryWaitMs, EVAL_FETCH,
  parseGhTrending, isAiRepo, isAiText, flattenGhTrending, flattenOrCatalog,
  flattenAiNews, flattenMomoyu, MOMOYU_TECH_KEYS, MOMOYU_CN_KEYS,
} from './trend.js';

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

/** 异步版 t()：取数节奏（退避/重试）必须真实 await 才能验，计数与报告同一条路 */
const ta = async (name, fn) => {
  try {
    await fn();
    pass += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n    ${e.message}`);
    process.exitCode = 1;
  }
};

console.log('\ntrend.js 纯逻辑测试');

/* ---------------- YAML 子集解析 ---------------- */

// 取自 https://raw.githubusercontent.com/Aider-AI/aider/main/aider/website/_data/polyglot_leaderboard.yml
// 的真实片段（2026-09 实测），保留原始缩进与值形态。
const REAL_YAML = `- dirname: 2025-02-25-20-23-07--gemini-pro
  test_cases: 225
  model: Gemini 2.0 Pro exp-02-05
  edit_format: whole
  commit_hash: 2fccd47
  pass_rate_1: 20.4
  pass_rate_2: 35.6
  pass_num_1: 46
  pass_num_2: 80
  percent_cases_well_formed: 100.0
  error_outputs: 430
  num_malformed_responses: 0
  user_asks: 13
  lazy_comments: 0
  total_tests: 225
  total_cost: 0.0000
  date: 2025-02-25
- dirname: 2025-02-25-20-23-07--o3-mini
  test_cases: 225
  model: o3-mini (high)
  edit_format: diff
  pass_rate_1: 15.1
  pass_rate_2: 61.2
  total_cost: 0.8300
  date: 2025-02-25
# 注释行应被忽略
- dirname: 2025-02-25-20-23-07--deepseek
  model: DeepSeek R1 (via openrouter)
  pass_rate_2: 41.5
  date: 2025-02-26`;

t('解析出正确的元素个数（忽略注释与空行）', () => {
  const items = parseFlatYamlList(REAL_YAML);
  assert.equal(items.length, 3);
});

t('解析出正确的键值（字符串 / 数字 / 带括号与空格的模型名）', () => {
  const [a] = parseFlatYamlList(REAL_YAML);
  assert.equal(a.model, 'Gemini 2.0 Pro exp-02-05');
  assert.equal(a.pass_rate_2, 35.6);
  assert.equal(a.edit_format, 'whole');
  assert.equal(a.date, '2025-02-25'); // 日期保持字符串，**不做** Date 解析
  assert.equal(a.total_cost, 0);
});

t('去掉引号、识别 null / 布尔', () => {
  const items = parseFlatYamlList(`- a: "带: 冒号的值"\n  b: 'single'\n  c: ~\n  d: null\n  e: true\n  f: 42`);
  assert.deepEqual(items[0], { a: '带: 冒号的值', b: 'single', c: null, d: null, e: true, f: 42 });
});

t('空文本 → 空数组（不是抛错）', () => {
  assert.deepEqual(parseFlatYamlList(''), []);
  assert.deepEqual(parseFlatYamlList('\n# 只有注释\n'), []);
});

t('★ 超出子集的嵌套写法必须抛错，而不是猜一个错值', () => {
  assert.throws(() => parseFlatYamlList('- a:\n    b: 1\n'), /超出最小 YAML 子集/);
});

t('顶层不是 "- " 开头的行 → 抛错', () => {
  assert.throws(() => parseFlatYamlList('model: x\n'), /超出最小 YAML 子集/);
});

/* ---------------- Aider 榜单合并规则 ---------------- */

t('同一模型的多行取最高 pass_rate_2，并按分数降序', () => {
  const rows = bestAiderRows([
    { model: 'A', pass_rate_2: 10 },
    { model: 'B', pass_rate_2: 50 },
    { model: 'A', pass_rate_2: 30 }, // 更高 → 应取代 10
    { model: 'A', pass_rate_2: 20 }, // 更低 → 应被忽略
  ]);
  assert.deepEqual(
    rows.map((r) => [r.model, r.rate]),
    [['B', 50], ['A', 30]]
  );
});

t('缺 model 或缺 pass_rate_2 的行被丢弃（不让 undefined 参与排序）', () => {
  const rows = bestAiderRows([
    { model: '', pass_rate_2: 99 },
    { model: 'C' },
    { model: 'D', pass_rate_2: 'not-a-number' },
    { model: 'E', pass_rate_2: 12 },
  ]);
  assert.deepEqual(rows.map((r) => r.model), ['E']);
});

/* ---------------- 评测行规范化 ---------------- */

// 字段名与形态取自 datasets-server 对 open-llm-leaderboard/contents 的真实响应
const EVAL_ROW = {
  eval_name: '01-ai_Yi-1.5-34B_bfloat16',
  fullname: '01-ai/Yi-1.5-34B',
  'Average ⬆️': 25.64649419429311,
  IFEval: 28.411725333226947,
  BBH: 30.1,
  'MATH Lvl 5': 12.3,
  GPQA: 4.5,
  'MMLU-PRO': 40.732121749408975,
  '#Params (B)': 34.389,
  // Model 字段是重 HTML，**不应**被使用
  Model: '<a target="_blank" href="https://huggingface.co/01-ai/Yi-1.5-34B">…</a>',
};

t('从真实行里取出干净模型名（用 fullname，不用含 HTML 的 Model）', () => {
  const m = normalizeEval(EVAL_ROW);
  assert.equal(m.model, '01-ai/Yi-1.5-34B');
  assert.ok(!m.model.includes('<a'), '模型名里不该带 HTML');
  assert.equal(m.score, EVAL_ROW['Average ⬆️']);
  assert.equal(m.params, 34.389);
});

t('分数缺失的行返回 null（空值不参与排名）', () => {
  assert.equal(normalizeEval({ fullname: 'x/y' }), null);
  assert.equal(normalizeEval({ fullname: '', 'Average ⬆️': 50 }), null);
  assert.equal(normalizeEval({ fullname: 'x/y', 'Average ⬆️': 'abc' }), null);
});

t('某项子分数缺失时是 null，不是 NaN/0（避免把缺失画成 0 分）', () => {
  const m = normalizeEval({ fullname: 'x/y', 'Average ⬆️': 10, IFEval: 20 });
  assert.equal(m.ifeval, 20);
  assert.equal(m.bbh, null);
  assert.equal(m.gpqa, null);
});

/* ---------------- 展示工具 ---------------- */

t('compact：千/百万缩写，边界正确', () => {
  assert.equal(compact(999), '999');
  assert.equal(compact(1500), '1.5k');
  assert.equal(compact(12345), '12k');
  assert.equal(compact(2500000), '2.5M');
  assert.equal(compact('abc'), null);
});

t('num：非数字返回 null（调用方据此显示 —）', () => {
  assert.equal(num('abc'), null);
  assert.equal(num(undefined), null);
  assert.equal(num(1.2345, 1), '1.2');
});

t('esc：上游文本里的尖括号/引号必须转义（模型名可能带奇怪字符）', () => {
  const out = esc('<img src=x onerror=alert(1)>');
  assert.ok(!out.includes('<img'), '未转义 —— 会把上游文本当 HTML 执行');
  assert.ok(out.includes('&lt;img'));
  assert.equal(esc(`a"b'c`), 'a&quot;b&#39;c');
});

t('table：单元格渲染结果原样保留（转义责任在单元格渲染函数，不在表格）', () => {
  const html = table([{ label: 'M', cell: (r) => esc(r.id) }], [{ id: '<b>x</b>' }]);
  assert.ok(!html.includes('<b>x</b>'), '单元格内容未按约定先转义');
  assert.ok(html.includes('&lt;b&gt;'));
});

/* ---------------- 名次徽章与条形图 ---------------- */

t('rankBadge：前三名带奖牌 class，其余只有序号', () => {
  assert.equal(rankBadge(1), '<span class="rank r1">1</span>');
  assert.equal(rankBadge(3), '<span class="rank r3">3</span>');
  assert.equal(rankBadge(4), '<span class="rank">4</span>');
});

t('bar：宽度相对本批最大值，且缺失/零值不会算成 NaN%', () => {
  assert.match(bar(50, 100), /--w:50\.0%/);
  assert.match(bar(100, 100), /--w:100\.0%/);
  // 最大值缺失或为 0 时不该画（否则会算出 Infinity/NaN 宽度）
  assert.equal(bar(5, 0), '');
  assert.equal(bar(5, null), '');
  assert.equal(bar('abc', 10), '');
  // 极小的值也要看得见那一条，所以有 2% 下限
  assert.match(bar(0.1, 100), /--w:2\.0%/);
});

t('table：列可带额外 class（窄屏按列收起），表头可放 HTML 图标', () => {
  const html = table(
    [
      { label: 'A', cell: () => 'a' },
      { html: '<svg>x</svg>', num: true, cls: 'col-2', cell: () => '1' },
    ],
    [{}]
  );
  // 表头现在还会带 sortable（可点排序），所以断言用「包含」而不是全等
  assert.match(html, /<th class="num col-2 sortable"/, '表头的 class/HTML 没生效');
  assert.match(html, /<svg>x<\/svg>/, '表头 HTML 图标没生效');
  assert.match(html, /<td class="num col-2">1<\/td>/, '单元格的 class 没生效');
});

t('table：可排序表头带 data-sort 与 aria-sort，且可被 sortable:false 关掉', () => {
  const html = table(
    [
      { label: '#', sortable: false, cell: () => '1' },
      { label: '分值', field: 'v', num: true, cell: () => 'x' },
    ],
    [{ v: 1 }],
    { index: 1, dir: 'desc' }
  );
  // 第一列不可排序
  assert.ok(!/data-sort="0"/.test(html), '标了 sortable:false 的列不该可排序');
  // 第二列可排序且处于降序
  assert.match(html, /data-sort="1"/);
  assert.match(html, /aria-sort="descending"/);
  assert.match(html, /▼/, '当前排序列没有箭头');
});

/* ---------------- 过滤 / 排序（applyBoardState） ---------------- */

const BS_ROWS = [
  { name: 'B', task: 'text', score: 10 },
  { name: 'A', task: 'image', score: 30 },
  { name: 'C', task: 'text', score: null }, // 空值
  { name: 'D', task: 'image', score: 20 },
];
const BS_COLS = [
  { label: '名', field: 'name', cell: (r) => r.name },
  { label: '任务', field: 'task', cell: (r) => r.task },
  { label: '分', field: 'score', num: true, cell: (r) => r.score },
];

t('applyBoardState：按数值降序', () => {
  const out = applyBoardState(BS_ROWS, BS_COLS, { sort: { index: 2, dir: 'desc' } });
  assert.deepEqual(out.map((r) => r.name), ['A', 'D', 'B', 'C']);
});

t('★ applyBoardState：空值恒排最后，**升序也不例外**', () => {
  // 升序时如果不管空值，C(空)会跑到最前面，读者看到的是一个由空值组成的假榜
  const asc = applyBoardState(BS_ROWS, BS_COLS, { sort: { index: 2, dir: 'asc' } });
  assert.deepEqual(asc.map((r) => r.name), ['B', 'D', 'A', 'C'], '升序时空值没有排在最后');
  const desc = applyBoardState(BS_ROWS, BS_COLS, { sort: { index: 2, dir: 'desc' } });
  assert.equal(desc[desc.length - 1].name, 'C', '降序时空值没有排在最后');
});

t('applyBoardState：分组过滤', () => {
  const out = applyBoardState(BS_ROWS, BS_COLS, { group: 'image' }, { groupField: 'task' });
  assert.deepEqual(out.map((r) => r.name).sort(), ['A', 'D']);
  // '*' 表示不过滤
  assert.equal(applyBoardState(BS_ROWS, BS_COLS, { group: '*' }, { groupField: 'task' }).length, 4);
});

t('applyBoardState：文本搜索（大小写不敏感，只看指定字段）', () => {
  const out = applyBoardState(BS_ROWS, BS_COLS, { q: 'a' }, { searchFields: ['name'] });
  assert.deepEqual(out.map((r) => r.name), ['A']);
  const none = applyBoardState(BS_ROWS, BS_COLS, { q: 'text' }, { searchFields: ['name'] });
  assert.equal(none.length, 0, '搜索不该越过 searchFields 去看别的字段');
});

t('applyBoardState：分组 + 搜索 + 排序可叠加', () => {
  const out = applyBoardState(BS_ROWS, BS_COLS, { group: 'image', q: 'd', sort: { index: 2, dir: 'asc' } }, { groupField: 'task', searchFields: ['name'] });
  assert.deepEqual(out.map((r) => r.name), ['D']);
});

t('applyBoardState：不改原数组（排序是拷贝）', () => {
  const before = BS_ROWS.map((r) => r.name);
  applyBoardState(BS_ROWS, BS_COLS, { sort: { index: 2, dir: 'desc' } });
  assert.deepEqual(BS_ROWS.map((r) => r.name), before, '原数组被排序污染了');
});

t('applyBoardState：空输入与无效 sort 不炸', () => {
  assert.deepEqual(applyBoardState(null, BS_COLS, {}), []);
  assert.deepEqual(applyBoardState([], BS_COLS, { sort: { index: 9, dir: 'desc' } }), []);
  assert.equal(applyBoardState(BS_ROWS, BS_COLS, {}).length, 4);
});

t('groupOptions：按出现次数降序，忽略空值', () => {
  const g = groupOptions([{ t: 'a' }, { t: 'b' }, { t: 'a' }, { t: '' }, {}], 't');
  assert.deepEqual(g, [
    { value: 'a', count: 2, label: 'a' },
    { value: 'b', count: 1, label: 'b' },
  ]);
});

t('controlsHtml：搜索框 + 分组下拉，且转义分组名', () => {
  const html = controlsHtml({ q: 'x', groups: [{ value: '<b>', count: 2, label: '<b>' }] });
  assert.match(html, /data-q value="x"/);
  assert.match(html, /data-group/);
  assert.ok(!html.includes('<b>'), '分组名没被转义');
});

t('controlsHtml：没有分组时不出下拉', () => {
  assert.ok(!controlsHtml({}).includes('<select'));
});

/* ---------------- 每日论文 ---------------- */

t('normalizePaper：从 {paper:{…}} 里取出标题/点赞/日期', () => {
  const r = normalizePaper({
    paper: { id: '2609.12345', title: 'A Paper', upvotes: 42, publishedAt: '2026-09-21T00:00:00.000Z' },
    publishedAt: '2026-09-21T00:00:00.000Z',
  });
  assert.equal(r.title, 'A Paper');
  assert.equal(r.votes, 42);
  assert.equal(r.date, '2026-09-21'); // 只留到日
  assert.equal(normalizePaper({ paper: {} }), null); // 没标题就丢掉
});

t('rankPapers：按点赞降序，同一标题去重', () => {
  const rows = rankPapers([
    { paper: { title: 'B', upvotes: 5 } },
    { paper: { title: 'A', upvotes: 9 } },
    { paper: { title: 'B', upvotes: 1 } }, // 重复标题
  ]);
  assert.deepEqual(rows.map((r) => r.title), ['A', 'B']);
});

/* ---------------- GitHub 仓库榜 ---------------- */

t('rankRepos：有当期增量就按增量排，否则退回总星标', () => {
  const withGain = rankRepos(
    [
      { full_name: 'a/x', stargazers_count: 90000, html_url: 'u', description: '' },
      { full_name: 'b/y', stargazers_count: 100, html_url: 'u', description: '' },
    ],
    'stargazers_count'
  );
  // 这个测试的 key 就是总星标，所以按总星标排
  assert.deepEqual(withGain.map((r) => r.full_name), ['a/x', 'b/y']);
});

t('rankRepos：缺 full_name 的条目被丢弃（不让 undefined 进榜）', () => {
  const rows = rankRepos([{ stargazers_count: 5 }, { full_name: 'ok/r', stargazers_count: 1, html_url: 'u' }], 'stargazers_count');
  assert.deepEqual(rows.map((r) => r.full_name), ['ok/r']);
});

/* ---------------- models.dev 摊平 ---------------- */

t('flattenModelsDev：把 provider→models 嵌套摊平，并按发布日期降序', () => {
  const rows = flattenModelsDev({
    prov1: { name: 'Prov One', models: { 'x/old': { id: 'x/old', name: 'Old', release_date: '2024-01-01' } } },
    prov2: { name: 'Prov Two', models: { 'y/new': { id: 'y/new', name: 'New', release_date: '2026-05-01', limit: { context: 1000000 }, cost: { input: 1.4, output: 4.4 } } } },
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'New'); // 新的在前
  assert.equal(rows[0].provider, 'Prov Two');
  assert.equal(rows[0].context, 1000000);
  assert.equal(rows[0].costIn, 1.4);
});

t('flattenModelsDev：没有发布日期的排到最后（不是被当成 1970 排到最前）', () => {
  const rows = flattenModelsDev({
    p: { name: 'P', models: {
      a: { id: 'a', name: 'NoDate' },
      b: { id: 'b', name: 'Dated', release_date: '2025-01-01' },
    } },
  });
  assert.deepEqual(rows.map((r) => r.name), ['Dated', 'NoDate']);
});

t('flattenModelsDev：空输入不炸', () => {
  assert.deepEqual(flattenModelsDev({}), []);
  assert.deepEqual(flattenModelsDev(null), []);
});

t('fmtCost：免费写"免费"，缺失写 —，不堆小数', () => {
  assert.equal(fmtCost(0), '免费');
  assert.equal(fmtCost(NaN), '—');
  assert.equal(fmtCost(0.26), '$0.26');
  assert.equal(fmtCost(4.44), '$4.4');
});

/* ---------------- SWE-bench ---------------- */

// 形态取自 swe-bench.github.io/data/leaderboards.json 的真实响应（2026-09 实测）
const SWE_REAL = [
  {
    name: 'Verified',
    results: [
      { model_display: 'Claude 4.5 Opus', resolved: 79.2, date: '2025-12-05', model_org: 'Anthropic', cost: null },
      { model_display: 'Claude 4.5 Opus', resolved: 75.0, date: '2025-11-01', model_org: 'Anthropic' }, // 同模型更早更低的提交
      { model_display: 'Doubao-Seed-Code', resolved: 78.8, date: '2025-09-28', model_org: 'ByteDance' },
      { model_display: 'No Score Model', resolved: null }, // 无成绩 → 丢弃
      { model_display: 'Claude 4 Sonnet', resolved: 76.8, date: '2025-08-04', model_org: 'Anthropic', cost: 120.5 },
      { agent: 'Only Agent No Model', resolved: 50.0, date: '2025-07-01' }, // 没 model_display → 用 agent 兜底
    ],
  },
  { name: 'Lite', results: [{ model_display: 'X', resolved: 60.33, date: '2025-01-01' }] },
];

t('★ SWE-bench 的 resolved 直接当百分数用，**不乘 100**', () => {
  // 实测官方的 resolved 最大是 79.2（不是 0.792），所以这里绝不能 ×100
  const rows = rankSweBench(SWE_REAL, 'Verified');
  assert.equal(rows[0].score, 79.2, 'resolved 被换算过了');
  assert.ok(rows.every((r) => r.score >= 0 && r.score <= 100), '有超出 0-100 的解决率');
  // 页面上写的是 `num(r.score,1)+'%'`，即 79.2% 而不是 7920%
  assert.equal(`${rows[0].score}%`, '79.2%');
});

t('rankSweBench：同模型取最高分，并按解决率降序', () => {
  const rows = rankSweBench(SWE_REAL, 'Verified');
  const opus = rows.find((r) => r.model === 'Claude 4.5 Opus');
  assert.equal(opus.score, 79.2, '没有取到该模型的最高分（去重逻辑错）');
  assert.deepEqual(
    rows.map((r) => r.model),
    ['Claude 4.5 Opus', 'Doubao-Seed-Code', 'Claude 4 Sonnet', 'Only Agent No Model']
  );
});

t('rankSweBench：无成绩的条目被丢弃（不参与排名）', () => {
  const rows = rankSweBench(SWE_REAL, 'Verified');
  assert.ok(!rows.some((r) => r.model === 'No Score Model'));
});

t('★ rankSweBench：cost 为 null 时是 null，不是 0（同类强制转换坑）', () => {
  const rows = rankSweBench(
    [{ name: 'V', results: [{ model_display: 'A', resolved: 10, cost: null }, { model_display: 'B', resolved: 5, cost: 120.5 }] }],
    'V'
  );
  assert.equal(rows.find((r) => r.model === 'A').cost, null, 'null 的 cost 被转成了 0');
  assert.equal(rows.find((r) => r.model === 'B').cost, 120.5);
});

t('rankSweBench：没有 model_display 时用 agent 兜底', () => {
  const rows = rankSweBench(SWE_REAL, 'Verified');
  assert.ok(rows.some((r) => r.model === 'Only Agent No Model'));
});

t('rankSweBench：指定不存在的子榜时回落到第一个（不返回空）', () => {
  const rows = rankSweBench(SWE_REAL, 'NoSuchBoard');
  assert.ok(rows.length > 0);
});

t('rankSweBench：空输入不炸', () => {
  assert.deepEqual(rankSweBench([], 'Verified'), []);
  assert.deepEqual(rankSweBench(null), []);
  assert.deepEqual(rankSweBench([{ name: 'X' }], 'X'), []); // 没有 results
});

t('sweBoardNames：只取名字，过滤空值', () => {
  assert.deepEqual(sweBoardNames(SWE_REAL), ['Verified', 'Lite']);
  assert.deepEqual(sweBoardNames(null), []);
});

/* ---------------- 卡片与详情 ---------------- */

const CARD_ROWS = [
  { __rank: 1, model: 'A/big', score: 79.2 },
  { __rank: 2, model: '<img src=x>', score: 50 },
];

t('cardGrid：每张卡片是一颗 <button>（键盘可用），带名次与序号', () => {
  const html = cardGrid(CARD_ROWS, {
    title: (r) => esc(r.model),
    value: (r) => `${r.score}%`,
    meta: (r) => `<span class="tag">x</span>`,
  });
  assert.equal((html.match(/<button class="card"/g) || []).length, 2);
  // data-card 是索引，点击时用它回查数据行
  assert.match(html, /data-card="0"/);
  assert.match(html, /data-card="1"/);
  assert.match(html, /class="rank r1"/, '名次徽章没进卡片');
});

t('★ cardGrid：标题必须由调用方转义 —— 不转义的 HTML 会被当结构执行', () => {
  // 第二行的 model 是 <img src=x>，调用方规范用 esc() 包一层
  const html = cardGrid(CARD_ROWS, { title: (r) => esc(r.model), value: () => '', meta: () => '' });
  assert.ok(!html.includes('<img'), '卡片里出现了未转义的 HTML');
  assert.ok(html.includes('&lt;img'));
});

t('cardGrid：空数据给一句空态，不是空白', () => {
  assert.match(cardGrid([], { title: () => '', value: () => '', meta: () => '' }), /没有数据/);
});

t('detailRow：空值不产出空行（免得详情里一排"—/无"）', () => {
  assert.equal(detailRow('参数', null), '');
  assert.equal(detailRow('参数', undefined), '');
  assert.equal(detailRow('参数', ''), '');
  assert.match(detailRow('参数', '7.2B'), /7\.2B/);
  assert.match(detailRow('参数', '7.2B'), /<dt>参数<\/dt>/);
});

t('★ detailFromCols：详情字段与表格列同源，且跳过名次列', () => {
  const cols = [
    { label: '#', cell: (r) => r.rank },
    { label: '模型', cell: (r) => esc(r.model) },
    { label: '分数', num: true, cell: (r) => r.score },
  ];
  const body = detailFromCols(cols, { rank: 1, model: 'A', score: 9 });
  assert.ok(!body.includes('<dt>#</dt>'), '详情里不该有名次那一行');
  assert.match(body, /<dt>模型<\/dt>/);
  assert.match(body, /<dt>分数<\/dt>/);
});

/* ---------------- OpenRouter 用量榜 ---------------- */

/**
 * fixture 照抄真实的行形态（字段名与实测一致，见 docs/trend-sources.md）：
 * 同一模型的 standard / batch / free 是**三行**，日期是 `YYYY-MM-DD 00:00:00`。
 */
const OR_ROWS = [
  // 最新一天 D2
  { date: '2026-09-29 00:00:00', model_permaslug: 'openai/gpt-5-20260901', variant: 'standard', rankingMetricValue: 1000, count: 10 },
  { date: '2026-09-29 00:00:00', model_permaslug: 'openai/gpt-5-20260901', variant: 'batch', rankingMetricValue: 500, count: 5 },
  { date: '2026-09-29 00:00:00', model_permaslug: 'openai/gpt-5-20260901', variant: 'free', rankingMetricValue: 100, count: 3 },
  { date: '2026-09-29 00:00:00', model_permaslug: 'z-ai/glm-5-20260801', variant: 'standard', rankingMetricValue: 800, count: 7 },
  { date: '2026-09-29 00:00:00', model_permaslug: '', variant: 'standard', rankingMetricValue: 999, count: 1 }, // 实测存在的空 slug
  // 前一天 D1：不该进入榜单
  { date: '2026-09-28 00:00:00', model_permaslug: 'openai/gpt-5-20260901', variant: 'standard', rankingMetricValue: 77777, count: 999 },
];

t('★ openrouterBoard：只用最新一天的数据（旧日期不能混进来）', () => {
  const { rows, date, total } = openrouterBoard(OR_ROWS);
  assert.equal(date, '2026-09-29 00:00:00');
  assert.equal(total, 2400, `总量应为 1000+500+100+800，实得 ${total}`);
  assert.equal(rows.length, 2, '应当是 2 个模型（空 slug 那行不算）');
  // 77777 属于前一天：出现在任何一行上都说明窗口没卡住
  assert.ok(!rows.some((r) => r.tokens === 77777), '混进了旧日期的用量');
});

t('★ openrouterBoard：同一模型的 standard/batch/free 合并成一行（否则榜上会出现带 (batch) 的三份）', () => {
  const { rows } = openrouterBoard(OR_ROWS);
  const gpt = rows.find((r) => r.key === 'openai/gpt-5-20260901');
  assert.ok(gpt, '没找到合并后的模型');
  assert.equal(gpt.tokens, 1000 + 500 + 100, '三个变体的 tokens 应当相加');
  assert.equal(gpt.requests, 10 + 5 + 3, '请求数也应当相加');
  assert.equal(rows.length, 2, '合并后不该有三行同模型的条目');
});

t('★ openrouterBoard：占比按合并后的总量算，且降序', () => {
  const { rows, total } = openrouterBoard(OR_ROWS);
  assert.equal(rows[0].key, 'openai/gpt-5-20260901', '用量最高的排最前');
  assert.ok(Math.abs(rows[0].share - (1600 / total) * 100) < 1e-9, "GPT-5 那一行占 1600/2400");
  const sum = rows.reduce((a, r) => a + r.share, 0);
  assert.ok(Math.abs(sum - 100) < 1e-9, `占比之和应为 100，实得 ${sum}`);
});

t('openrouterBoard：空输入 / 非数组都抛错，不静默返回空榜', () => {
  assert.throws(() => openrouterBoard([]), /没有解析出/);
  assert.throws(() => openrouterBoard(null), /没有解析出/);
  assert.throws(() => openrouterBoard([{ date: '2026-01-01', model_permaslug: '' }]), /没有解析出/);
});

const OR_MODELS = {
  data: [
    { id: 'openai/gpt-5-20260901', name: 'OpenAI: GPT-5', canonical_slug: 'openai/gpt-5-20260901' },
    { id: 'z-ai/glm-5', name: 'Z.ai: GLM 5 (batch)', canonical_slug: 'z-ai/glm-5-20260801' },
    { id: 'qwen/qwen3-8b', name: 'Qwen: Qwen3 8B', canonical_slug: 'qwen/qwen3-8b-20260101' },
  ],
};

t('★ openrouterNames：id 精确命中优先，其次 canonical_slug', () => {
  const nameOf = openrouterNames(OR_MODELS.data);
  assert.equal(nameOf('openai/gpt-5-20260901'), 'OpenAI: GPT-5');
  // 用量行给的是 z-ai/glm-5-20260801，清单 id 是 z-ai/glm-5、canonical 才是长的那串
  assert.equal(nameOf('z-ai/glm-5-20260801'), 'Z.ai: GLM 5 (batch)');
});

t('★ openrouterNames：取不到就返回 null（不编名字）', () => {
  const nameOf = openrouterNames(OR_MODELS.data);
  assert.equal(nameOf('typesafe/jev-1.13-20260917'), null);
  assert.equal(nameOf(''), null);
  assert.equal(openrouterNames(undefined)('anything'), null);
});

t('★ openrouterNames：去日期后缀匹配时优先取非 (batch) 的名字', () => {
  // 真实数据里同一个 canonical 可能只有 (batch) 那条在清单里；
  // 但若两条都在，应当给读者基座名而不是 batch 名
  const both = [
    { id: 'x/m-1', name: 'X: M (batch)', canonical_slug: 'x/m-1-20260101' },
    { id: 'x/m-2', name: 'X: M', canonical_slug: 'x/m-20260101' },
  ];
  assert.equal(openrouterNames(both)('x/m-20260101'), 'X: M');
});

t('★ openrouterLabel：有名字用名字，没名字回落成去日期去厂商的 slug', () => {
  const nameOf = openrouterNames(OR_MODELS.data);
  assert.equal(openrouterLabel('openai/gpt-5-20260901', nameOf), 'OpenAI: GPT-5');
  // 取不到名字时，至少不要把 `vendor/` 前缀和日期一起甩给读者
  assert.equal(openrouterLabel('typesafe/jev-1.13-20260917', nameOf), 'jev-1.13');
});


/* ---------------- OpenRouter 的四张榜 ---------------- */

t('★ growthPct：climbing 是百分数、breakouts 是比率（同一接口里两种单位）', () => {
  // 实测：climbing 给 359.85（= +359.85%），breakouts 给 3.57（= +357%）。
  // 不区分就会把突破榜整条压到上升榜末尾，而页面上不会报错。
  assert.equal(growthPct(359.85, 'climbing'), 359.85);
  assert.equal(growthPct(3.57, 'breakouts'), 357);
  assert.ok(Math.abs(growthPct(0.65, 'breakouts') - 65) < 1e-9);
  assert.equal(growthPct(null, 'climbing'), null);
  assert.equal(growthPct('abc', 'breakouts'), null);
});

t('★ rankClimbing：按增幅降序（上游给的数组不是排好的）', () => {
  const rows = rankClimbing(
    [
      { variantPermaslug: 'a/x', weeklyTokens: 100, prevWeeklyTokens: 10, changePercent: 10 },
      { variantPermaslug: 'b/y', weeklyTokens: 200, prevWeeklyTokens: 1, changePercent: 50 },
    ],
    'climbing'
  );
  assert.deepEqual(rows.map((r) => r.slug), ['b/y', 'a/x']);
  assert.equal(rows[0].growth, 50);
});

t('rankClimbing：空 slug / 无用量 / 无增幅的行被丢掉', () => {
  const rows = rankClimbing(
    [
      { variantPermaslug: '', weeklyTokens: 100, changePercent: 9 },
      { variantPermaslug: 'a/x', weeklyTokens: 0, changePercent: 9 },
      { variantPermaslug: 'b/y', weeklyTokens: 5, changePercent: null },
      { variantPermaslug: 'c/z', weeklyTokens: 5, changePercent: 1 },
    ],
    'climbing'
  );
  assert.deepEqual(rows.map((r) => r.slug), ['c/z']);
  assert.deepEqual(rankClimbing(null, 'climbing'), []);
});

t('★ rankAuthors：share 是比例、changePercent 是比率（与 climbing 又不同）', () => {
  const rows = rankAuthors([
    { author: 'deepseek', weeklyTokens: 100, share: 0.2272, changePercent: 0.0289 },
    { author: 'openai', weeklyTokens: 50, share: 0.1, changePercent: -0.5 },
  ]);
  assert.equal(rows[0].author, 'deepseek', '按用量降序');
  assert.ok(Math.abs(rows[0].share - 22.72) < 1e-9, 'share 要转成百分数');
  assert.ok(Math.abs(rows[0].growth - 2.89) < 1e-9, 'changePercent 是比率 → 2.89%');
  assert.ok(rows[1].growth < 0);
});

t('★ rankPerformance：延迟越小越前、吞吐越大越前（两个视角方向相反）', () => {
  const data = [
    { slug: 'a', name: 'A', request_count: 10, p50_latency: 900, p50_throughput: 20 },
    { slug: 'b', name: 'B', request_count: 20, p50_latency: 200, p50_throughput: 80 },
  ];
  assert.deepEqual(rankPerformance(data, 'latency').map((r) => r.slug), ['b', 'a']);
  assert.deepEqual(rankPerformance(data, 'throughput').map((r) => r.slug), ['b', 'a']);
  // 反过来构造：延迟高但吞吐也高，两个视角就应当给出不同顺序
  const data2 = [
    { slug: 'fast', p50_latency: 100, p50_throughput: 10 },
    { slug: 'big', p50_latency: 5000, p50_throughput: 900 },
  ];
  assert.equal(rankPerformance(data2, 'latency')[0].slug, 'fast');
  assert.equal(rankPerformance(data2, 'throughput')[0].slug, 'big');
});

t('rankPerformance：缺失的延迟/吞吐是 null，不是 0（否则会排到榜首）', () => {
  const rows = rankPerformance([{ slug: 'a', p50_latency: null, p50_throughput: undefined }], 'latency');
  assert.equal(rows[0].latency, null);
  assert.equal(rows[0].throughput, null);
});

t('★ rankAa：用 score 排，不用 percentilesBySlug', () => {
  const rows = rankAa([
    { permaslug: 'a', aa_name: 'A', score: 10 },
    { permaslug: 'b', aa_name: 'B', score: 50 },
    { permaslug: 'c', aa_name: 'C' }, // 无分 → 丢
  ]);
  assert.deepEqual(rows.map((r) => r.slug), ['b', 'a']);
});

t('rankApps：按 token 降序，取 app.title 与链接', () => {
  const rows = rankApps([
    { app: { title: 'X', slug: 'x', origin_url: 'https://x' }, total_tokens: '100', total_requests: 5 },
    { app: { title: 'Y', slug: 'y' }, total_tokens: '900', total_requests: 1 },
  ]);
  assert.deepEqual(rows.map((r) => r.title), ['Y', 'X']);
  assert.equal(rows[1].url, 'https://x');
});

t('★ flattenMedia：video/stt 多套一层 data.data（按同一种形状解析只会出一行）', () => {
  const inner = { data: [{ x: '2026-09-28', ys: { 'a/one': 5, 'b/two': 9, Others: 100 } }] };
  // 图像是 {data:[…]}，视频/语音是 {data:{data:[…]}}
  assert.deepEqual(flattenMedia({ data: inner.data }).map((r) => r.slug), ['b/two', 'a/one']);
  assert.deepEqual(flattenMedia(inner).map((r) => r.slug), ['b/two', 'a/one']);
});

t('flattenMedia：Others 是合计桶、不是模型，且取最后一个时间点', () => {
  const rows = flattenMedia({
    data: [
      { x: 'd1', ys: { 'a/one': 1 } },
      { x: 'd2', ys: { 'a/one': 7, Others: 99 } },
    ],
  });
  assert.deepEqual(rows.map((r) => r.slug), ['a/one']);
  assert.equal(rows[0].value, 7, '应当取最后一个点');
  assert.equal(rows[0].at, 'd2');
});

t('flattenMedia：空输入不炸', () => {
  assert.deepEqual(flattenMedia(null), []);
  assert.deepEqual(flattenMedia({}), []);
  assert.deepEqual(flattenMedia({ data: [] }), []);
});

/* ---------------- cardGrid 的可选字段（真实故障复现） ---------------- */

/**
 * ★ 这一组对着一次真实故障：`cfg.meta` 没给的榜单（aaBench）在渲染卡片时
 * 抛 `cfg.meta is not a function`，整块面板变成"读取失败"。
 *
 * 成因是一个看着像判空、其实先调用了的写法：`cfg.value(r) ? … : ''`
 * —— `cfg.meta(r)` 在 `?` 之前就执行了。而 mountBoard 的详情路径用的是
 * `cfg.card.meta ? … : ''`（先判存在），两处语义不一致，于是"省略 meta"
 * 在详情里没事、在卡片上崩。
 */
t('★ cardGrid：没有 meta 时不能抛错（它就是那个真实故障）', () => {
  const html = cardGrid([{ __rank: 1, name: 'X' }], {
    title: (r) => esc(r.name),
    value: (r) => r.name,
    // 故意不给 meta —— 这正是 aaBench 原来的样子
  });
  assert.ok(html.includes('X'), '卡片没渲染出来');
  assert.ok(!html.includes('card-meta'), '没有 meta 就不该产出那块 DOM');
});

t('★ cardGrid：没有 value 时也不能抛错', () => {
  const html = cardGrid([{ __rank: 1, name: 'X' }], { title: (r) => esc(r.name) });
  assert.ok(html.includes('X'));
  assert.ok(!html.includes('card-value'));
});

t('cardGrid：title 是必需的（缺了就该炸，而不是渲染一张空卡）', () => {
  assert.throws(() => cardGrid([{ name: 'X' }], {}), /is not a function/);
});

t('cardGrid：meta 返回空串时不产出那块 DOM（空标签会占位但没内容）', () => {
  const html = cardGrid([{ __rank: 1, name: 'X' }], { title: (r) => esc(r.name), meta: () => '' });
  assert.ok(!html.includes('card-meta'));
});

/* ---------------- 面板挂载：同 id 必须原地替换 ---------------- */

/**
 * 一个够真的假容器 —— 只实现 attachPanel 用到的那几个方法。
 *
 * 为什么值得写这十几行：那个 bug（切子榜变成"追加"）**只有真的走一遍 DOM 行为
 * 才会暴露**，而本站的测试不跑浏览器。这个假容器把 `querySelector` /
 * `appendChild` / `replaceWith` / `children` 按真实语义实现，于是
 * "点击后容器里应当只有 1 个面板"这件事可以被断言。
 */
function fakeRoot() {
  // 只实现 attachPanel 用到的那几个方法，语义与真 DOM 一致：
  // `replaceWith` = **新元素占据旧元素的位置**（旧元素被移出）。
  const root = {
    _children: [],
    get children() { return this._children; },
    querySelector(sel) {
      const m = /^#(.+)$/.exec(sel);
      return m ? this._children.find((c) => c.id === m[1]) || null : null;
    },
    appendChild(el) { this._children.push(el); return el; },
  };
  // ★ 元素的 id 必须是 `panel-<id>`（与 panel() 里 `el.id = \`panel-${id}\`` 一致），
  // 否则 attachPanel 的 `#panel-<id>` 查不到，测试会"永远走追加分支"而假装通过。
  root.newPanel = (id, content = `panel:${id}`) => ({
    id: `panel-${id}`,
    className: 'panel',
    datasetBoard: id,
    innerHTML: content,
    replaceWith(next) {
      const i = root._children.indexOf(this);
      if (i >= 0) root._children[i] = next; // 新元素留在旧元素的位置上
    },
  });
  return root;
}

t('★ attachPanel：同 id 再挂一次是**替换**，不是追加（切子榜曾因此看起来没反应）', () => {
  const root = fakeRoot();
  attachPanel(root, root.newPanel('orApps'), 'orApps');
  assert.equal(root.children.length, 1, '第一次挂载后面板数应为 1');

  // 模拟"点击子榜 chip"：loader 被重新调用，又挂一个同 id 的面板
  const next = root.newPanel('orApps');
  next.innerHTML = 'panel:orApps:week';
  attachPanel(root, next, 'orApps');

  assert.equal(root.children.length, 1, '不该出现两个同 id 的面板（旧的那个会留在页面上）');
  assert.equal(root.children[0].innerHTML, 'panel:orApps:week', '应当是新的那份内容');
});

t('★ attachPanel：不同 id 是**追加**（一个页面上可以并排多个面板）', () => {
  const root = fakeRoot();
  attachPanel(root, root.newPanel('a'), 'a');
  attachPanel(root, root.newPanel('b'), 'b');
  assert.equal(root.children.length, 2);
});

t('attachPanel：替换时**保持原来的位置**（否则面板会被挪到列表末尾）', () => {
  const root = fakeRoot();
  attachPanel(root, root.newPanel('a'), 'a');
  attachPanel(root, root.newPanel('b'), 'b');
  attachPanel(root, root.newPanel('a'), 'a'); // 重挂 a
  assert.deepEqual(root.children.map((c) => c.datasetBoard), ['a', 'b'], 'a 不该被挪到 b 后面');
});

/* ---------------- 源码级门禁：面板挂载的唯一入口 ---------------- */

/*
 * `panel()` 曾经无条件 `panelsRoot.appendChild(el)`，而**切换子榜**的路径是
 * "重新调用 loader"（chip 点击 → loadOrApps('week')），于是每次切换都往
 * `#panels` 里**再塞一个同 id 的面板**：旧的仍在 DOM 里显示老数据，
 * 新的排在下面。页面上不报错、也不抛异常，读者只觉得"点了没反应"。
 *
 * 上面三条 attachPanel 测试盯的是那个函数本身；这一条盯的是**唯一的调用方**——
 * 只要有人把 `panel()` 改回 `appendChild`，整条修复就失效，而函数测试照样全绿。
 * 所以这里直接读源码，钉住"panel() 必须经由 attachPanel 挂载"。
 */
t('★ panel() 只能经由 attachPanel 挂载（改回 appendChild 会让切子榜重新变成追加）', () => {
  const src = readFileSync(new URL('./trend.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('function panel({'));
  const end = body.indexOf('\n}\n', body.indexOf('attachPanel(panelsRoot'));
  assert.ok(end > 0, '没找到 panel() 的函数体 —— 上面的切片定位已失效，请同步本条');
  const fn = body.slice(0, end);
  assert.match(fn, /attachPanel\(panelsRoot, el, id\)/, 'panel() 不再调用 attachPanel');
  // 反证：函数体里不该再出现直接往 panelsRoot 里塞元素/HTML 的写法
  assert.doesNotMatch(
    fn,
    /panelsRoot\.(appendChild|insertAdjacent|innerHTML)/,
    'panel() 里出现了绕过 attachPanel 的直接挂载'
  );
});

/* ---------------- 评测榜取数节奏（退避 / 重试 / 限速，fetch 用桩） ---------------- */

/*
 * 2026-09-30 实测：datasets-server 对匿名请求限"每秒请求数"。旧实现 8 并发连发
 * 46 页会撞 429（本机 46 连发 44×200 + 2×429；无头加载真实页面还见过 13/46 页
 * 失败、以及连第一页都没拿到 → 整块面板报错）。
 * 取数层因此改成"低并发 + 批间错峰 + 指数退避"。这一节盯三件事：
 *   1. 退避序列本身（evalBackoffMs）；
 *   2. 线上参数没被悄悄改回"高并发连发"（EVAL_FETCH）；
 *   3. 重试行为：首页一次 429 能救回、救不回的页计入 failed 且不拖垮整榜。
 * fetch 用桩、延迟注入为 0 —— 测试不联网也不真等退避（见 FAST 策略）。
 */

t('evalBackoffMs：指数放大且封顶 5s（800ms → 1.6s → 3.2s → 5s）', () => {
  assert.equal(evalBackoffMs(1), 800);
  assert.equal(evalBackoffMs(2), 1600);
  assert.equal(evalBackoffMs(3), 3200);
  assert.equal(evalBackoffMs(4), 5000, '封顶 5s：再失败的页不值得让访客等更久');
  assert.equal(evalBackoffMs(5), 5000);
  assert.equal(evalBackoffMs(9), 5000);
  assert.equal(evalBackoffMs(2, 100), 200, '基数可注入（测试与 live-check 用）');
});

t('★ evalRetryWaitMs：429 走长退避（等桶回填），其它失败走短退避', () => {
  // 429 是"桶被打空"，实测要 60–70s 才回填 —— 秒级重试只会连环再撞
  assert.equal(evalRetryWaitMs(429, null, 1), 25000);
  assert.equal(evalRetryWaitMs(429, null, 2), 50000);
  assert.equal(evalRetryWaitMs(429, null, 3), 60000, '封顶 60s');
  // 上游明说 Retry-After 就听上游的，无论什么状态码
  assert.equal(evalRetryWaitMs(429, 8000, 1), 8000);
  assert.equal(evalRetryWaitMs(503, 12000, 2), 12000);
  // 普通失败（5xx/网络层 status=null）：短退避就够
  assert.equal(evalRetryWaitMs(503, null, 1), 800);
  assert.equal(evalRetryWaitMs(503, null, 2), 1600);
  assert.equal(evalRetryWaitMs(null, null, 2), 1600, '网络层错误（Failed to fetch）同短退避');
  // 基数可注入：测试与 live-check 用零等待跑得快
  assert.equal(evalRetryWaitMs(429, null, 1, { rateLimitUnitMs: 0, backoffMs: 0 }), 0);
});

t('★ EVAL_FETCH：线上策略钉在"低并发 + 批间错峰 + 429 长退避"（改回连发就会再撞限流）', () => {
  assert.ok(EVAL_FETCH.batch >= 1 && EVAL_FETCH.batch <= 3, `batch=${EVAL_FETCH.batch}，并发不得超过 3（datasets-server 实测限流）`);
  assert.ok(EVAL_FETCH.batchGapMs >= 500, `batchGapMs=${EVAL_FETCH.batchGapMs}，批间错峰不得低于 500ms`);
  assert.ok(EVAL_FETCH.attempts >= 2, '单页至少重试一次');
  assert.ok(EVAL_FETCH.firstAttempts >= EVAL_FETCH.attempts, '首页尝试次数 ≥ 普通页（它决定总页数）');
  assert.ok(EVAL_FETCH.rateLimitUnitMs >= 20000, `rateLimitUnitMs=${EVAL_FETCH.rateLimitUnitMs}，429 的退避单位不得低于 20s（实测桶回填要 60–70s）`);
});

/** datasets-server /rows 的响应桩：total 行、每页 rowsPerPage 行，模型名带页 offset */
const evalPageStub = (offset, { total = 250, rowsPerPage = 2 } = {}) => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({
    num_rows_total: total,
    rows: Array.from({ length: rowsPerPage }, (_, i) => ({
      row: { fullname: `org/m${offset}-${i}`, 'Average ⬆️': String(50 + i) },
    })),
  }),
});

const http429 = { ok: false, status: 429, headers: { get: () => null }, json: async () => ({}) };

/** 临时换掉全局 fetch，跑完即还原（测试不联网） */
const withFetchStub = async (stub, fn) => {
  const orig = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await fn();
  } finally {
    globalThis.fetch = orig;
  }
};

const offsetOf = (url) => Number(new URL(url).searchParams.get('offset'));

// 零延迟策略：真实节奏（350ms 批间隔 / 600ms 退避）不该让测试干等
const FAST = { batch: 2, batchGapMs: 0, attempts: 3, firstAttempts: 3, backoffMs: 0, rateLimitUnitMs: 0 };

await ta('fetchAllEvalPages：按页取全量（offset 0/100/200，行全到手、零失败）', async () => {
  const calls = [];
  await withFetchStub(async (url) => {
    const off = offsetOf(url);
    calls.push(off);
    return evalPageStub(off);
  }, async () => {
    const { rows, failed, pageCount, total } = await fetchAllEvalPages(null, FAST);
    assert.equal(total, 250);
    assert.equal(pageCount, 3);
    assert.equal(failed, 0);
    assert.equal(rows.length, 6, '3 页 × 每页 2 行');
    assert.deepEqual([...new Set(calls)].sort((a, b) => a - b), [0, 100, 200], '每页恰好取一次');
  });
});

await ta('fetchAllEvalPages：第一页 429 一次 → 听 Retry-After 退避后救回（首页决定总页数）', async () => {
  let firstCalls = 0;
  await withFetchStub(async (url) => {
    const off = offsetOf(url);
    if (off === 0 && firstCalls++ === 0) {
      // Retry-After 以秒计；给个极小值只为走"听上游"的分支，不真等 1 秒
      return { ...http429, headers: { get: () => '0.05' } };
    }
    return evalPageStub(off);
  }, async () => {
    const { rows, failed } = await fetchAllEvalPages(null, FAST);
    assert.equal(failed, 0);
    assert.equal(rows.length, 6);
    assert.equal(firstCalls, 2, '第一页恰好试了两次');
  });
});

await ta('fetchAllEvalPages：一页始终 429 → 计入 failed，其余页照常到手', async () => {
  await withFetchStub(async (url) => {
    const off = offsetOf(url);
    if (off === 100) return http429;
    return evalPageStub(off);
  }, async () => {
    const { rows, failed } = await fetchAllEvalPages(null, FAST);
    assert.equal(failed, 1);
    assert.equal(rows.length, 4, '丢的那页算失败，另外两页的 4 行还在');
  });
});

await ta('fetchAllEvalPages：第一页重试耗尽 → 抛"第一页就没取到"（没总数宁可明说）', async () => {
  await withFetchStub(async () => http429, async () => {
    await assert.rejects(() => fetchAllEvalPages(null, FAST), /第一页/);
  });
});

await ta('fetchAllEvalPages：onProgress 逐批推进（done 单调不减、末批收口）', async () => {
  const events = [];
  await withFetchStub(async (url) => evalPageStub(offsetOf(url), { total: 450 }), async () => {
    await fetchAllEvalPages((e) => events.push(e), FAST);
    assert.deepEqual(events.map((e) => e.done), [1, 3, 5], '首页 1 页 + 每批 2 页，共 5 页');
    assert.ok(events.every((e) => e.total === 5));
  });
});


/* ---------------- GitHub Trending（构建期快照 + AI 过滤） ---------------- */

/*
 * fixture 取自 2026-10-01 的真实 github.com/trending 页面（两条 article 原文）。
 * 为了不让测试文件塞满 10KB 的图标，只做了三处**不影响解析**的省略：
 * octicon 的 <svg>…</svg> 整体、data-hydro-click 的 JSON 载荷、语言色块的 style。
 * 解析器读的标记（h2 链接 / p.col-9 描述 / stargazers·forks 链接后的数字 /
 * "N stars today" / programmingLanguage）全部逐字保留。
 */
const GH_ARTICLE_VOICESTUDIO = `<article class="Box-row"> <div class="float-right d-flex"> <div data-view-component="true" class="BtnGroup d-flex"> <a href="/login?return_to=%2Fdebpalash%2FVoiceStudio" rel="nofollow" data-hydro-click="{…}" data-hydro-click-hmac="…" aria-label="You must be signed in to star a repository" data-view-component="true" class="tooltipped tooltipped-sw btn-sm btn"> <svg>…</svg><svg>…</svg> <span data-view-component="true" class="d-none d-md-inline"> Star </span> </a></div> </div> <h2 class="h3 lh-condensed"> <a data-hydro-click="{…}" data-hydro-click-hmac="…" href="/debpalash/VoiceStudio" data-view-component="true" class="Link"><svg>…</svg> <span data-view-component="true" class="text-normal"> debpalash / </span> VoiceStudio</a> </h2> <p class="col-9 color-fg-muted my-1 tmp-pr-4"> VoiceStudio is the open-source, fully-local ElevenLabs alternative — voice cloning, voice design, video dubbing, dictation, transcription &amp; audiobook creation in 646 languages. </p> <div class="f6 color-fg-muted mt-2"> <span class="tmp-mr-3 d-inline-block ml-0 tmp-ml-0"> <span class="repo-language-color"></span> <span itemprop="programmingLanguage">Python</span> </span> <a href="/debpalash/VoiceStudio/stargazers" data-view-component="true" class="tmp-mr-3 Link Link--muted d-inline-block"><svg>…</svg> 50,428</a> <a href="/debpalash/VoiceStudio/forks" data-view-component="true" class="tmp-mr-3 Link Link--muted d-inline-block"><svg>…</svg> 5,597</a> <span data-view-component="true" class="tmp-mr-3 d-inline-block"> Built by <a class="d-inline-block" data-hydro-click="{…}" data-hydro-click-hmac="…" data-hovercard-type="user" data-hovercard-url="/users/debpalash/hovercard" data-octo-click="hovercard-link-click" data-octo-dimensions="link_type:self" href="/debpalash"><img class="avatar mb-1 avatar-user" src="https://avatars.githubusercontent.com/u/4178343?s=40&amp;v=4" width="20" height="20" alt="@debpalash" /></a> <a class="d-inline-block" data-hydro-click="{…}" data-hydro-click-hmac="…" data-hovercard-type="user" data-hovercard-url="/users/claude/hovercard" data-octo-click="hovercard-link-click" data-octo-dimensions="link_type:self" href="/claude"><img class="avatar mb-1 avatar-user" src="https://avatars.githubusercontent.com/u/81847?s=40&amp;v=4" width="20" height="20" alt="@claude" /></a> <a class="d-inline-block" data-hydro-click="{…}" data-hydro-click-hmac="…" data-hovercard-type="user" data-hovercard-url="/users/kevin9327/hovercard" data-octo-click="hovercard-link-click" data-octo-dimensions="link_type:self" href="/kevin9327"><img class="avatar mb-1 avatar-user" src="https://avatars.githubusercontent.com/u/5299031?s=40&amp;v=4" width="20" height="20" alt="@kevin9327" /></a> <a class="d-inline-block" data-hydro-click="{…}" data-hydro-click-hmac="…" data-hovercard-type="user" data-hovercard-url="/users/jaketame/hovercard" data-octo-click="hovercard-link-click" data-octo-dimensions="link_type:self" href="/jaketame"><img class="avatar mb-1 avatar-user" src="https://avatars.githubusercontent.com/u/1787973?s=40&amp;v=4" width="20" height="20" alt="@jaketame" /></a> <a class="d-inline-block" data-hydro-click="{…}" data-hydro-click-hmac="…" data-hovercard-type="user" data-hovercard-url="/users/velixio/hovercard" data-octo-click="hovercard-link-click" data-octo-dimensions="link_type:self" href="/velixio"><img class="avatar mb-1 avatar-user" src="https://avatars.githubusercontent.com/u/270455167?s=40&amp;v=4" width="20" height="20" alt="@velixio" /></a> </span> <span data-view-component="true" class="d-inline-block float-sm-right"> <svg>…</svg> 3,483 stars today </span> </div> </article>`;
const GH_ARTICLE_CLAUDE_SKILLS = `<article class="Box-row"> <div class="float-right d-flex"> <div data-view-component="true" class="BtnGroup d-flex"> <a href="/login?return_to=%2FComposioHQ%2Fawesome-claude-skills" rel="nofollow" data-hydro-click="{…}" data-hydro-click-hmac="…" aria-label="You must be signed in to star a repository" data-view-component="true" class="tooltipped tooltipped-sw btn-sm btn"> <svg>…</svg><svg>…</svg> <span data-view-component="true" class="d-none d-md-inline"> Star </span> </a></div> </div> <h2 class="h3 lh-condensed"> <a data-hydro-click="{…}" data-hydro-click-hmac="…" href="/ComposioHQ/awesome-claude-skills" data-view-component="true" class="Link"><svg>…</svg> <span data-view-component="true" class="text-normal"> ComposioHQ / </span> awesome-claude-skills</a> </h2> <p class="col-9 color-fg-muted my-1 tmp-pr-4"> A curated list of awesome Claude Skills, resources, and tools for customizing Claude AI workflows </p> <div class="f6 color-fg-muted mt-2"> <span class="tmp-mr-3 d-inline-block ml-0 tmp-ml-0"> <span class="repo-language-color"></span> <span itemprop="programmingLanguage">Python</span> </span> <a href="/ComposioHQ/awesome-claude-skills/stargazers" data-view-component="true" class="tmp-mr-3 Link Link--muted d-inline-block"><svg>…</svg> 76,124</a> <a href="/ComposioHQ/awesome-claude-skills/forks" data-view-component="true" class="tmp-mr-3 Link Link--muted d-inline-block"><svg>…</svg> 8,880</a> <span data-view-component="true" class="tmp-mr-3 d-inline-block"> Built by <a class="d-inline-block" data-hydro-click="{…}" data-hydro-click-hmac="…" data-hovercard-type="user" data-hovercard-url="/users/Prat011/hovercard" data-octo-click="hovercard-link-click" data-octo-dimensions="link_type:self" href="/Prat011"><img class="avatar mb-1 avatar-user" src="https://avatars.githubusercontent.com/u/67639393?s=40&amp;v=4" width="20" height="20" alt="@Prat011" /></a> <a class="d-inline-block" data-hydro-click="{…}" data-hydro-click-hmac="…" data-hovercard-type="user" data-hovercard-url="/users/sohamganatra/hovercard" data-octo-click="hovercard-link-click" data-octo-dimensions="link_type:self" href="/sohamganatra"><img class="avatar mb-1 avatar-user" src="https://avatars.githubusercontent.com/u/7982102?s=40&amp;v=4" width="20" height="20" alt="@sohamganatra" /></a> <a class="d-inline-block" data-hydro-click="{…}" data-hydro-click-hmac="…" data-hovercard-type="user" data-hovercard-url="/users/claude/hovercard" data-octo-click="hovercard-link-click" data-octo-dimensions="link_type:self" href="/claude"><img class="avatar mb-1 avatar-user" src="https://avatars.githubusercontent.com/u/81847?s=40&amp;v=4" width="20" height="20" alt="@claude" /></a> <a class="d-inline-block" data-hydro-click="{…}" data-hydro-click-hmac="…" data-hovercard-type="user" data-hovercard-url="/users/sanjay3290/hovercard" data-octo-click="hovercard-link-click" data-octo-dimensions="link_type:self" href="/sanjay3290"><img class="avatar mb-1 avatar-user" src="https://avatars.githubusercontent.com/u/24948667?s=40&amp;v=4" width="20" height="20" alt="@sanjay3290" /></a> <a class="d-inline-block" data-hydro-click="{…}" data-hydro-click-hmac="…" data-hovercard-type="user" data-hovercard-url="/users/mellson/hovercard" data-octo-click="hovercard-link-click" data-octo-dimensions="link_type:self" href="/mellson"><img class="avatar mb-1 avatar-user" src="https://avatars.githubusercontent.com/u/167574?s=40&amp;v=4" width="20" height="20" alt="@mellson" /></a> </span> <span data-view-component="true" class="d-inline-block float-sm-right"> <svg>…</svg> 123 stars today </span> </div> </article>`;

t('★ parseGhTrending：从真实页面片段解析出仓库/描述/语言/星标（含 &amp; 还原）', () => {
  const rows = parseGhTrending(GH_ARTICLE_VOICESTUDIO + GH_ARTICLE_CLAUDE_SKILLS);
  assert.equal(rows.length, 2);
  const v = rows[0];
  assert.equal(v.repo, 'debpalash/VoiceStudio');
  assert.equal(v.lang, 'Python');
  assert.equal(v.stars, 50428);
  assert.equal(v.forks, 5597);
  assert.equal(v.starsToday, 3483);
  assert.ok(v.desc.includes('voice cloning'), '描述应保留原文');
  assert.ok(v.desc.includes('&') && !v.desc.includes('&amp;'), 'HTML 实体要还原');
  assert.equal(rows[1].repo, 'ComposioHQ/awesome-claude-skills');
  assert.equal(rows[1].starsToday, 123);
});

t('parseGhTrending：缺描述/缺语言/缺"今日星"的条目不炸，字段是空与 null', () => {
  const minimal =
    '<article class="Box-row">' +
    '<h2 class="h3 lh-condensed"> <a data-hydro-click="{…}" href="/o/r" class="Link">o / r</a> </h2>' +
    '<div class="f6 color-fg-muted mt-2">' +
    '<a href="/o/r/stargazers" class="Link Link--muted"><svg>…</svg> 1,234</a>' +
    '</div> </article>';
  const rows = parseGhTrending(minimal);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].repo, 'o/r');
  assert.equal(rows[0].desc, '');
  assert.equal(rows[0].lang, '');
  assert.equal(rows[0].stars, 1234);
  assert.equal(rows[0].forks, null);
  assert.equal(rows[0].starsToday, null, '没有"今日星"就是 null，不是 0');
});

t('parseGhTrending：h2 链接不是仓库形态（登录页/带查询串）的条目被丢弃', () => {
  const bad =
    '<article class="Box-row"><h2><a href="/login?return_to=x">Star</a></h2></article>' +
    '<article class="Box-row"><h2><a href="/some/deep/path/file">Not a repo</a></h2></article>';
  assert.equal(parseGhTrending(bad).length, 0);
  assert.equal(parseGhTrending('').length, 0, '空输入不炸');
});

t('★ isAiRepo：词边界匹配 —— storage 里的 rag、html 里的 ml、array 里的 ai 都不命中', () => {
  // 真实条目
  assert.equal(isAiRepo({ repo: 'debpalash/VoiceStudio', desc: 'voice cloning, dictation, transcription' }), true);
  assert.equal(isAiRepo({ repo: 'ComposioHQ/awesome-claude-skills', desc: 'A curated list of awesome Claude Skills' }), true);
  assert.equal(isAiRepo({ repo: 'firebase/firebase-ios-sdk', desc: 'Firebase SDK for Apple App Development' }), false);
  assert.equal(isAiRepo({ repo: 'NawfalMotii79/PLFM_RADAR', desc: 'low-cost 10.5 GHz PLFM phased array RADAR system' }), false);
  // 误伤守卫（这些词都是真实 trending 里的高频非 AI 词）
  assert.equal(isAiRepo({ repo: 'a/storage-engine', desc: 'fast storage with drag-and-drop' }), false, 'drag 里的 rag 不算 RAG');
  assert.equal(isAiRepo({ repo: 'a/html-renderer', desc: 'streaming html to ml dataset? no' }), false);
  assert.equal(isAiRepo({ repo: 'a/array-utils', desc: 'bit array helpers' }), false, 'array 里的 ai');
  // 词边界正确命中
  assert.equal(isAiRepo({ repo: 'a/rag', desc: '' }), true);
  assert.equal(isAiRepo({ repo: 'a/app', desc: 'RAG pipeline with embeddings' }), true);
  assert.equal(isAiRepo({ repo: 'openai/cool', desc: '' }), true);
});

t('flattenGhTrending：快照 JSON → 面板行（数字归一、AI 标记、空仓库名剔除）', () => {
  const snap = {
    source: 'https://github.com/trending',
    fetchedAt: '2026-10-01T01:02:30.141Z',
    entries: [
      { repo: 'a/ai-tool', desc: 'llm stuff', lang: 'Rust', stars: '12,682', forks: 1547, starsToday: '1,281' },
      { repo: '', desc: 'x' }, // 空 repo：剔除
      { repo: 'b/plain', desc: 'a plain todo app', stars: 'abc' }, // stars 非数字 → null；描述不含 AI 词
      'not-an-object',
    ],
  };
  const rows = flattenGhTrending(snap);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].stars, 12682, '"12,682" → 12682');
  assert.equal(rows[0].starsToday, 1281);
  assert.equal(rows[0].ai, true);
  assert.equal(rows[1].stars, null);
  assert.equal(rows[1].ai, false);
  assert.equal(flattenGhTrending(null).length, 0, '空输入不炸');
});

/* ---------------- OpenRouter 模型库 ---------------- */

// 真实条目（2026-09-30 的 /api/v1/models，第一条 gpt-6.1-sol-pro），只保留面板读的字段
const OR_CATALOG_ROW = {
  id: 'openai/gpt-6.1-sol-pro',
  name: 'OpenAI: GPT-6.1 Sol Pro',
  canonical_slug: 'openai/gpt-6.1-sol-pro-20260929',
  created: 1790702886,
  context_length: 1050000,
  architecture: { modality: 'text+image+file->text' },
  pricing: { prompt: '0.000002', completion: '0.00001' },
};

t('★ flattenOrCatalog：真实条目 —— 每 token 美元 → 每百万 token 美元', () => {
  const rows = flattenOrCatalog({ data: [OR_CATALOG_ROW] });
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.id, 'openai/gpt-6.1-sol-pro');
  assert.equal(r.vendor, 'openai', '厂商取 id 的前半段');
  assert.equal(r.context, 1050000);
  assert.equal(r.costIn, 2, '"0.000002"/token → $2/M tokens');
  assert.equal(r.costOut, 10, '"0.00001"/token → $10/M tokens');
  assert.equal(r.modality, 'text+image+file->text');
  assert.equal(r.slug, 'openai/gpt-6.1-sol-pro-20260929');
  assert.match(r.release, /^\d{4}-\d{2}-\d{2}$/, 'created（unix 秒）→ YYYY-MM-DD');
});

t('flattenOrCatalog：免费是 0、缺价是 null、没上线日期排最后', () => {
  const rows = flattenOrCatalog({
    data: [
      { id: 'inclusionai/ling-3.0-flash-sante:free', name: 'Ling 3.0 (free)', created: 1788545946, context_length: 128000, pricing: { prompt: '0', completion: '0' } },
      { id: 'x/no-price', name: 'No Price' },
      { id: 'x/old', name: 'Old', created: 1000000000 },
    ],
  });
  const free = rows.find((r) => r.id.includes(':free'));
  assert.equal(free.costIn, 0, '免费是 0（页面显示"免费"），不是 null');
  assert.equal(free.costOut, 0);
  const noprice = rows.find((r) => r.id === 'x/no-price');
  assert.equal(noprice.costIn, null, '缺价是 null（排序时恒在最后，不冒充 0 价）');
  assert.equal(noprice.release, '');
  assert.equal(noprice.context, null);
  // 排序：有日期的按降序，没日期的最后
  assert.equal(rows[rows.length - 1].id, 'x/no-price');
  assert.ok(rows[0].release >= rows[1].release);
  assert.equal(flattenOrCatalog({}).length, 0, '空输入不炸');
  assert.equal(flattenOrCatalog(null).length, 0);
});


/* ---------------- AI 新闻 / 摸摸鱼（快照面板的纯逻辑） ---------------- */

t('★ isAiText：中文子串 + 英文词边界一起管（momoyu 与 ghTrending 共用）', () => {
  // 中文（CJK 无词边界，直接子串）
  assert.equal(isAiText('如何评价 10 月 1 号发布的 Gemini 4 Argon'), true, 'Gemini');
  assert.equal(isAiText(' OpenAI 发布新模型'), true);
  assert.equal(isAiText('通用大模型刷屏'), true, '中文关键词"大模型"');
  assert.equal(isAiText('买不到票被迫买长乘短'), false, '无关中文不命中');
  assert.equal(isAiText('国庆出游计划'), false);
  // 英文词边界守卫（沿用 isAiRepo 的标准）
  assert.equal(isAiText('fast storage with drag-and-drop'), false);
  assert.equal(isAiText('RAG pipeline with embeddings'), true);
});

t('flattenAiNews：快照 → 行（坏条目剔除、score 缺失为 null、来源名兜底 key）', () => {
  const snap = {
    fetchedAt: '2026-10-01T03:48:02.000Z',
    sources: [
      { key: 'hn', name: 'Hacker News · AI', fetchedAt: '2026-10-01T03:47:00.000Z', items: [
        { title: 't1', url: 'https://a/1', time: '2026-10-01T00:00:00Z', score: 88, author: 'alice' },
        { title: '', url: 'https://a/2' },            // 无标题 → 剔除
        { title: 't3', url: '' },                     // 无链接 → 剔除
      ] },
      { key: 'arxiv', fetchedAt: '2026-10-01T03:47:30.000Z', items: [   // 无 name → 用 key
        { title: 't4', url: 'http://arxiv.org/abs/1', time: '', score: 'x' },
      ] },
      'not-a-block',
    ],
  };
  const rows = flattenAiNews(snap);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].source, 'Hacker News · AI');
  assert.equal(rows[0].score, 88);
  assert.equal(rows[1].source, 'arxiv', '来源名缺失时兜底用 key');
  assert.equal(rows[1].score, null, '非数字分数是 null（排序时恒在最后）');
  assert.equal(flattenAiNews(null).length, 0, '空输入不炸');
});

t('flattenMomoyu：快照 → 行（AI 标记在客户端算、extra 保留原文、空标题剔除）', () => {
  const snap = {
    fetchedAt: '2026-10-01T03:50:00.000Z',
    sources: [
      { key: 'zhihu', name: '知乎热榜', fetchedAt: '2026-10-01T02:00:15.000Z', items: [
        { title: '如何评价 10 月 1 号发布的 Gemini 4 Argon', url: 'https://zhihu/q1', extra: '105 万' },
        { title: '张本智和被文春爆出私下频繁搭讪女性', url: 'https://zhihu/q2', extra: '79 万' },
        { title: ' ', url: 'https://zhihu/q3' },       // 空标题 → 剔除
      ] },
    ],
  };
  const rows = flattenMomoyu(snap);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].ai, true, '标题含 Gemini → AI');
  assert.equal(rows[1].ai, false);
  assert.equal(rows[0].extra, '105 万', '热度文字保留原文，不解析成数字');
  assert.equal(flattenMomoyu(null).length, 0, '空输入不炸');
});

t('★ flattenMomoyu 的 keys 过滤：两块精选面板各取各的子集，共用同一份全量快照', () => {
  const snap = {
    sources: [
      { key: 'zhihu', name: '知乎热榜', items: [{ title: 't1', url: 'u1' }] },
      { key: 'weibo', name: '微博热搜', items: [{ title: 't2', url: 'u2' }] },
      { key: 'zhidemai', name: '值得买', items: [{ title: 't3', url: 'u3' }] },
    ],
  };
  assert.equal(flattenMomoyu(snap, ['zhihu']).length, 1, '只留知乎块');
  assert.equal(flattenMomoyu(snap, ['weibo'])[0].source, '微博热搜');
  assert.equal(flattenMomoyu(snap, ['nonexistent']).length, 0, '键不存在 → 空（面板报"没有解析出新闻"）');
  assert.equal(flattenMomoyu(snap).length, 3, '不传 keys = 全量');
});

t('★ momoyu 精选分组：科技 8 榜 / 中文 4 榜，互不重叠，值得买两边都不在', () => {
  assert.equal(MOMOYU_TECH_KEYS.length, 8);
  assert.equal(MOMOYU_CN_KEYS.length, 4);
  const both = [...MOMOYU_TECH_KEYS, ...MOMOYU_CN_KEYS];
  assert.equal(new Set(both).size, both.length, '科技与中文两组不得重叠');
  // 落选理由：值得买是促销/比价榜（"3 小时热门"），与趋势站定位最远
  assert.ok(!both.includes('zhidemai'), '值得买按纪律落选，理由见 trend.js 注释与 docs');
  // 用户点名的科技向成员都在
  for (const k of ['zhihu', 'csdn', 'juejin', 'itzhijia', 'huxiu', 'bilibili']) {
    assert.ok(MOMOYU_TECH_KEYS.includes(k), `${k} 应在科技热榜`);
  }
  for (const k of ['weibo', 'toutiao', 'hupu']) {
    assert.ok(MOMOYU_CN_KEYS.includes(k), `${k} 应在中文热榜`);
  }
});

console.log(`\n  通过 ${pass} 失败 ${process.exitCode ? 1 : 0}\n`);
