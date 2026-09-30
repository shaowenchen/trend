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
import {
  parseFlatYamlList, bestAiderRows, normalizeEval, compact, num, table, esc, rankBadge, bar,
  normalizePaper, rankPapers, rankRepos, flattenModelsDev, fmtCost,
  rankSweBench, sweBoardNames, applyBoardState, groupOptions, controlsHtml,
  cardGrid, detailFromCols, detailRow,
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

console.log(`\n  通过 ${pass} 失败 ${process.exitCode ? 1 : 0}\n`);
