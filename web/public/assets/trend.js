/**
 * 趋势大盘 —— 客户端数据层。
 *
 * ## 为什么全部在浏览器里跑
 * 榜单数据由**浏览器直接请求上游公开接口**，服务端只发静态页。
 * 代价是跨域能否成功由上游决定，所以每个源都必须实测过（见 docs/trend-sources.md）。
 *
 * ## 三条设计约束
 *  1. **一个面板坏了不拖垮整页**：每个面板各自 fetch、各自渲染、各自显示错误。
 *  2. **不静默失败**：拿不到数据时明确说出是哪个源、什么错误，以及部分成功时的
 *     "已取 N/M 页" —— 这个项目的历史教训是"静默降级"最难查。
 *  3. **不猜数据**：源里没有的字段就不显示；不做单位换算。
 *
 * ## 评测榜为什么这么绕（重要）
 * `datasets-server/rows` 有两条硬约束，实测得来：
 *   · 一页最多 100 条（length=500 → 422）；全量 4576 行 = 46 页；
 *   · 分页是**按 eval_name 字母序**，不是按分数 —— 所以"榜"必须自己取全量再排序。
 * 于是这里并发拉 46 页（分批，避免打爆连接），合并后按 Average 降序。
 * 结果写 sessionStorage（TTL 10 分钟），否则每次进页面都要拉 46 次。
 *
 * ## 为什么手写最小 YAML 解析而不引依赖
 * 本站零外部依赖（这是既有约定，见 README）。Aider 的榜是 YAML，但形态极简单 ——
 * 扁平数组、元素是标量映射、没有嵌套/锚点/多行块。所以解析器只需要认识这一种子集。
 * 若上游改用超出该子集的写法，本面板会**明确报错并只影响自己**，不会静默出错值。
 */

import { icon } from './ui.js';
import { t, tagChips } from './i18n.js';

/**
 * 当前页面的语言。
 *
 * 为什么不从 URL 里现推、而要读 <html lang>：语言在**服务端**就定了（/en/* 是英文），
 * 客户端只需照办。读 lang 保证两边说的是同一件事 —— 若客户端自己推一遍，
 * 一旦规则不同步就会出现"英文页头 + 中文面板"。
 */
export const LOCALE =
  typeof document === 'undefined'
    ? 'zh' // Node（测试/构建脚本）里没有 DOM，按默认语言即可
    : String(document.documentElement.getAttribute('lang') || 'zh').toLowerCase().startsWith('en')
      ? 'en'
      : 'zh';

/** 取当前语言的一条文案（面板全部文案都走这里） */
const L = (key, vars) => t(LOCALE, key, vars);

/* ================================================================== */
/* 小的工具函数                                                        */
/* ================================================================== */

const $ = (sel, root = document) => root.querySelector(sel);

/** 把数字格式化成好读的样子；非数字返回 null（调用方据此不显示） */
export function num(v, digits = 2) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

/**
 * 把时间戳格式化成"9月30日 14:30"这种带日期的时刻，用于标注快照的抓取时间。
 * 只标到分钟：榜单是"这一批数据"而不是"这一秒的数据"，更细只会假精确。
 */
export function fmtStamp(ts) {
  return new Date(ts).toLocaleString(LOCALE === 'en' ? 'en-US' : 'zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 大数缩写：12345 → 12.3k */
export function compact(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!Number.isFinite(n)) return null;
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}k`;
  return `${(n / 1e6).toFixed(1)}M`;
}

/** 转义：模型名/描述来自上游，直接插进 DOM 会把它们的标记当 HTML 执行 */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 带缓存的取 JSON。
 * 为什么不用 fetch 的 cache 选项：那是 HTTP 缓存，受上游响应头支配；
 * 我们要的是"这个页面这次会话里别再重复拉 46 页"，所以自己存。
 *
 * ★ 这一版加了一层捕获：`sessionStorage` 这个**属性访问本身**在部分浏览器里会抛
 * SecurityError（Cookie/站点数据被完全拦掉时，例如"阻止所有 Cookie"的 Chrome、
 * 内嵌 WebView、或某些隐私模式）。原来的写法把这个访问放在 try 外面，
 * 于是一个存储策略就能让整页脚本在求值时死掉 —— 而它只是缓存，不该有这种权力。
 * 存储层整体降级为"永远未命中"（每次直接走网络），其余一切照常。
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_PREFIX = 'trend-panel-cache:';
const cacheKey = (k) => `${CACHE_PREFIX}${k}`;

/** 取缓存条目（连写入时刻 t 一起返回，供"抓取于 HH:MM"这类标注用）；过期/异常返回 null */
function readCacheEntry(key, ttl) {
  try {
    const raw = sessionStorage.getItem(cacheKey(key));
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    return Date.now() - t < ttl ? { t, v } : null;
  } catch {
    return null;
  }
}

function readCache(key, ttl) {
  return readCacheEntry(key, ttl)?.v ?? null;
}

function writeCache(key, value) {
  try {
    sessionStorage.setItem(cacheKey(key), JSON.stringify({ t: Date.now(), v: value }));
  } catch {
    /* 存不下就算了（配额/隐私模式/存储被禁），不影响本次展示 */
  }
}

/**
 * 清空本页缓存（"刷新数据"按钮用）。返回清掉的条数，便于测试与排错。
 * 只清 sessionStorage 的 10 分钟缓存；localStorage 里的**快照不清** ——
 * 快照是"上游读不动时"的回退物，刷新求的是新数据，不是丢掉唯一的旧数据。
 */
export function clearCache() {
  let n = 0;
  try {
    for (const k of Object.keys(sessionStorage)) {
      if (k.startsWith(CACHE_PREFIX)) {
        sessionStorage.removeItem(k);
        n += 1;
      }
    }
  } catch {
    /* 存储不可用时没有缓存可清 —— 面板本来就每次都走网络 */
  }
  return n;
}

/* ── localStorage 快照层：给"上游读不动"时回退，比 sessionStorage 长命 ──
 *
 * 两层存储职责不同：
 *   · sessionStorage 缓存（上面那组）= "这 10 分钟内不重复拉"的**新鲜缓存**，
 *     标签页关了就没关系 —— 丢了就再拉一次；
 *   · localStorage 快照 = "这台浏览器最后一次成功抓取"的**存底**，
 *     跨标签页、关浏览器还在 —— 回退物的价值就在于"还在"。
 *
 * 快照永远带着写入时刻（t），展示时如实标注"抓取于几时"：旧数据标着旧时间，
 * 不冒充新数据。隐私模式/配额满时存不下，就当没有回退物，不影响本次展示。
 */
const SNAP_PREFIX = 'trend-snap:';

/** 读快照（连写入时刻一起返回）；超龄/不存在/存储不可用返回 null */
function readSnapshot(key, maxAgeMs = Number.MAX_SAFE_INTEGER) {
  try {
    const raw = localStorage.getItem(SNAP_PREFIX + key);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    return Date.now() - t < maxAgeMs ? { t, v } : null;
  } catch {
    return null;
  }
}

function writeSnapshot(key, v) {
  try {
    localStorage.setItem(SNAP_PREFIX + key, JSON.stringify({ t: Date.now(), v }));
  } catch {
    /* 存不下就没有回退物，不影响本次展示 */
  }
}

/**
 * "刷新数据"的**强制重拉**标记（sessionStorage，但不在缓存前缀下、不会被清掉）。
 * 为什么需要它：评测榜对 7 天内的快照直接复用（数据源已归档，快照即全量），
 * 不设标记的话，点"刷新数据"会清掉缓存、然后又被快照挡住 —— 按钮看起来没反应。
 */
const FORCE_KEY = 'trend-force-refetch';

function forceRefetch() {
  try {
    if (sessionStorage.getItem(FORCE_KEY)) {
      sessionStorage.removeItem(FORCE_KEY);
      return true;
    }
  } catch {
    /* 读不了就当没有标记 —— 顶多这次不强制，不会出错 */
  }
  return false;
}

async function cachedJson(key, url, { ttl = CACHE_TTL_MS } = {}) {
  const hit = readCache(key, ttl);
  if (hit !== null) return hit;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const v = await res.json();
  writeCache(key, v);
  return v;
}

/* ================================================================== */
/* 面板骨架                                                            */
/* ================================================================== */

/**
 * 面板容器。
 *
 * 为什么这里要判 `typeof document`：本文件同时被 Node 里的测试 import
 * （测 YAML 解析与分页合并这两段纯逻辑）。顶层直接摸 `document` 会让测试
 * 连模块都加载不了，于是"最容易出错的两段"反而测不到。
 */
const panelsRoot = typeof document === 'undefined' ? null : document.querySelector('#panels');

/**
 * 全部面板的 id —— **页面地址契约**。
 *
 * 每个面板有自己的一页（`trending.html`、`eval.html`…），页面用
 * `<div id="panels" data-board="trending">` 声明自己要跑哪一个。
 * 所以这些 id 同时是三样东西：DOM 契约、页面文件名、导航链接的目标。
 * 改 id = 改地址，必须与发布集合和页头导航一起改（`site.test.js` 盯着）。
 *
 * 真值住在 `./boards.js`（同级文件）：浏览器只能拿到发布集合里的文件，
 * 所以它必须在 `assets/` 下，`trend.js` 才 import 得到。那三个在 Node 下跑的
 * 消费者（构建脚本、站点测试、页头生成器）隔着目录引它没问题，反过来则不然。
 * 这里再导出一次，是为了让测试继续从同一个地方取（也免得 `./trend.js` 的
 * 既有引用者改 import）。
 */
export { BOARD_IDS, BOARD_TAGS, BOARD_ICONS, BOARD_ORDER } from './boards.js';
import { BOARD_IDS, BOARD_TAGS, BOARD_ICONS, BOARD_ORDER, TOPIC_SLUGS, tagsOfBoard } from './boards.js';

/**
 * 本页要跑哪个面板：`data-board` 指名的那一个；**没写就是全部**。
 *
 * 扁平站之后**首页正是"没写 `data-board`"** —— 一页装下全部 34 个面板。
 * 这条兜底因此从"忘了写属性的退路"变成了主路径：没写 → 跑全部（慢一点但正确），
 * 写了名字不认识 → 硬错误（见 startAll 里的报错，静默空白是本站最不想要的失败）。
 * 页面要跑的顺序取 `BOARD_ORDER`（按主题分段），不是 `BOARD_IDS`（那是稳定清单）。
 */
const requestedBoard = String(panelsRoot?.dataset?.board || '').trim();
const wantedIds = requestedBoard ? BOARD_IDS.filter((id) => id === requestedBoard) : BOARD_ORDER;

/**
 * 单面板页：本页只有一个面板，于是这个面板就是页面的主体 ——
 * 它的标题升级成 `<h1>`（一页一个 h1，且不另写一遍 hero 标题）。
 * 这样"面板叫什么"仍然只有 `i18n.js` 一处来源，页面文件里一个字都不重复。
 *
 * 扁平站之后"单面板页"只剩一个来源：页面自己写了 `data-board`。
 * 其余情况（首页）是**一页装下全部** —— 那时页面标题 `<h1>` 由构建期落在骨架里，
 * 面板标题降到 `<h3>`（中间的主题段标题是 `<h2>`），层级才不会两头抢。
 */
const SINGLE_BOARD = Boolean(requestedBoard);

/**
 * 某个面板该挂进哪个容器。
 *
 * 扁平页把 `#panels` 分成 6 个**主题段**（`<section class="topic" id="topic-<slug>">`
 * 里的 `<div class="topic-grid" data-panels>`）。一个面板挂到自己主题那一段里，
 * 于是"同一类的榜挨在一起"。`attachPanel` 的"同 id 原地替换"因此是在**段内**
 * 生效的 —— 切子榜时面板留在原地，不会跳到别的段里。
 *
 * 找不到主题容器时回落到 `panelsRoot`：那是单面板页与 Node 测试的情形
 * （没有主题分段，只有一个容器）。
 */
function rootFor(id) {
  const topic = BOARD_TAGS[id]?.topic;
  const grid = topic ? $(`#topic-${topic} [data-panels]`) : null;
  return grid || panelsRoot;
}

/**
 * 取一个已存在的面板句柄（`#panel-<id>` 的操作柄），没有就返回 null。
 * 句柄的形状与 `panel()` 的返回值一致，所以 loader 不关心面板是
 * "刚建的"还是"骨架阶段就建好的"。
 */
function panelHandle(el) {
  return {
    el,
    status: (text, kind = '') => {
      const p = $('.panel-status', el);
      if (!p) return;
      p.textContent = text;
      // 转圈只在"还在动"的时候出现；拿到结果或报错就停下
      p.className = `panel-status ${kind}${kind ? '' : ' loading'}`;
      p.hidden = !text;
    },
    body: (html) => {
      const b = $('.panel-body', el);
      if (b) b.innerHTML = html;
    },
  };
}

/**
 * 确保某个面板的骨架存在，并返回它的句柄。
 *
 * ## 为什么需要它（扁平站的核心一环）
 * 懒加载要"先有骨架、再观察、滚到了才拉数据"。而今天面板外壳是在 loader
 * **内部**才建的 —— 那就没有东西可观察。于是启动时先给每个面板 `ensurePanel`
 * 出一块骨架（同步、零网络），观察器盯着这些骨架；滚到时调 loader，loader 复用
 * 同一块骨架填数据（`ensurePanel` 幂等：`#panel-<id>` 已在就原样返回）。
 *
 * ## 为什么 loader 也调它
 * 子榜切换走的是"重新调用 loader"（chip 点击 → `loadRepos('month')`）。那条路径上
 * 骨架已经在了，`ensurePanel` 直接返回它，于是**不重建、不重排** —— 这正是
 * `attachPanel` 那条"同 id 原地替换"修复想保住的行为（见那些测试）。
 */
function ensurePanel(meta) {
  const existing = panelsRoot?.querySelector?.(`#panel-${meta.id}`);
  if (existing) return panelHandle(existing);
  return panel(meta);
}

/**
 * 只绑一次的事件委托。
 *
 * ## 为什么需要它（扁平站引入的一个真缺陷）
 * 面板里的子榜/子视图切换（repos 周期、ghTrending 的 AI 过滤、hotList 的"仅 AI"、
 * swebench 子榜、orPerf 视图…）走的是"事件委托绑在面板元素上"，注释写的是
 * "挂面板上只绑一次即可"。**在"一个面板一页"的世界里那是对的**：`panel()` 每次
 * 都建一个**新元素**，旧的随页面走了，监听器不会累积。
 *
 * 扁平站改了这件事：`ensurePanel` 让"重新调用 loader"（点刷新、或加载器重跑）
 * 复用**同一个**元素，于是同一个监听器被重复挂上 —— 点一次 chip 会触发 N 次，
 * 而页面上看不出任何异常。`key` 把"这个元素上装过哪些委托"记在 dataset 上，
 * 重复调用直接返回。
 *
 * 导出是为了能测：这条缺陷只有"点两次刷新再点一次 chip"才显形，靠人眼测不出来。
 */
export function wireOnce(el, key, fn) {
  const flag = `wired${key}`;
  if (el.dataset[flag]) return;
  el.dataset[flag] = '1';
  el.addEventListener('click', fn);
}


/** 加载中的骨架：铺几行灰条，让人知道"这里会有内容"以及大致是表格的形状 */
function skeleton(lines = 5) {
  return `<div class="skeleton" aria-hidden="true">${'<span></span>'.repeat(lines)}</div>`;
}

/**
 * 面板骨架的**头像是唯一必需的信息** —— 建骨架时得先把头像摆上去，
 * 否则懒加载的观察器没有东西可盯、面板会一直只有一排灰条。
 *
 * 以前头像名是各 loader 里的字面量（`panel({ iconName: 'trophy' })`）。
 * 扁平站之后骨架要**在 loader 之前**建，头像就成了"渲染会不会炸"的真值
 * （`ui.js` 的 `icon()` 遇到未登记的名字**直接抛错**），所以它搬进了
 * `boards.js`（`BOARD_ICONS`）—— 那里是面板 id 与标签的真值所在，
 * 也是浏览器够得着的地方。标题与说明仍由 loader 在填充阶段落值。
 *
 * 漏登记一个 id 时回落 `'box'`：`icon('box')` 是有效图标，骨架不炸；
 * 真正的头像对不对由 loader 那一次 `ensurePanel` 覆盖过来。
 */
function shellMeta(id) {
  return {
    id,
    iconName: BOARD_ICONS[id] || 'box',
    title: L(`p.${id}.title`),
    hint: L(`p.${id}.hint`),
  };
}

/**
 * 把一个新建的面板挂进容器 —— **同 id 已存在就原地替换**。
 *
 * ★ 这里曾是一个真实故障：`panel()` 无条件 `appendChild`，于是"切换子榜"
 * （点击 chip 会重新调用 loader）不是切换，而是**又追加一个同 id 的面板**，
 * 旧的那个还在 DOM 里 —— 读者看到的仍是原来的数据，像是"点了没反应"。
 * 页面上不报错，同一页出现两个同 id 元素也不会被浏览器指出。
 *
 * 抽成独立函数是为了能测：它只依赖一个"像 parent 的东西"（`querySelector`
 * / `appendChild` / `replaceWith`），不必造一整个假 DOM。
 */
export function attachPanel(root, el, id) {
  const existing = root.querySelector(`#panel-${id}`);
  // 原地替换而不是"删了再追加"：后者会把面板挪到列表末尾，
  // 多面板页面上会看到顺序莫名其妙地变。
  if (existing) existing.replaceWith(el);
  else root.appendChild(el);
  return el;
}

/**
 * 建一个面板并返回它的操作柄。
 * 面板先以"加载中"出现，填好后替换 —— 避免整页空白等最慢的那个源。
 *
 * ★ 挂载**只能经由 `attachPanel`**（`trend.test.js` 有一条源码级断言盯着）：
 * 直接 `panelsRoot.appendChild` 会让"切换子榜"退化成"又追加一个同 id 的面板"。
 */
function panel({ id, iconName, title, hint }) {
  const el = document.createElement('section');
  el.className = 'panel';
  el.id = `panel-${id}`;
  // 整页只有这一个面板时（`data-board` 页），它的标题就是页面的标题 —— 用 h1 承担
  // （一页一个 h1；读屏器也能靠它一眼报出"这是什么页"）。
  // 扁平页上不是：页面 h1 是站点标题、主题段是 h2，所以面板落到 h3，
  // 层级才一以贯之（`site.css` 的 `.panel-head :is(h1, h3)` 是另一半）。
  const heading = SINGLE_BOARD ? 'h1' : 'h3';
  // 这个榜的标签（主题 + 来源），点一下就地按类收窄（不再是独立标签页）
  const tags = tagChips(tagsOfBoard(id), LOCALE);
  el.innerHTML = `
    <header class="panel-head">
      <${heading}><span class="panel-icon">${icon(iconName)}</span>${esc(title)}</${heading}>
      ${hint ? `<p class="panel-hint">${esc(hint)}</p>` : ''}
      ${tags ? `<p class="panel-tags">${tags}</p>` : ''}
    </header>
    <p class="panel-status loading" aria-live="polite">${L('ui.loading')}</p>
    <div class="panel-body">${skeleton()}</div>`;
  attachPanel(rootFor(id), el, id);
  return {
    el,
    status: (text, kind = '') => {
      const p = $('.panel-status', el);
      p.textContent = text;
      // 转圈只在"还在动"的时候出现；拿到结果或报错就停下
      p.className = `panel-status ${kind}${kind ? '' : ' loading'}`;
      p.hidden = !text;
    },
    body: (html) => {
      $('.panel-body', el).innerHTML = html;
    },
  };
}

/** 把一组行的渲染包成表格（列少、行多，表格最省事也最可读） */
export function table(cols, rows, sort = null) {
  if (!rows.length) return `<p class="empty">${L('ui.noData')}</p>`;
  // 每列可以带 `num`（右对齐、等宽数字）与 `cls`（例如 col-2：窄屏收起）。
  // 表头也支持 `html`，用于放图标（纯文本的 label 会被读屏器念出来）。
  const clsOf = (c) => [c.num ? 'num' : '', c.cls || ''].filter(Boolean).join(' ');
  const head = cols
    .map((c, i) => {
      // `sortable: false` 的列不参与排序（例如纯图标列）
      const sortable = c.sortable !== false;
      const active = sort && sort.index === i;
      const arrow = active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
      const k = [clsOf(c), sortable ? 'sortable' : '', active ? 'sorted' : ''].filter(Boolean).join(' ');
      const inner = c.html ?? esc(c.label);
      const attrs = sortable ? ` data-sort="${i}" role="button" tabindex="0" title="${L('ui.sortHint')}"` : '';
      // 排序状态用 aria-sort 播报给读屏器（视觉箭头它们看不到）
      const aria = active ? ` aria-sort="${sort.dir === 'asc' ? 'ascending' : 'descending'}"` : '';
      return `<th${k ? ` class="${k}"` : ''}${attrs}${aria}>${inner}${arrow}</th>`;
    })
    .join('');
  const body = rows
    .map(
      (r) =>
        `<tr>${cols
          .map((c) => {
            const k = clsOf(c);
            return `<td${k ? ` class="${k}"` : ''}>${c.cell(r)}</td>`;
          })
          .join('')}</tr>`
    )
    .join('');
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/* ================================================================== */
/* 榜单列表（前 N 名）                                                  */
/* ================================================================== */

/**
 * 榜单列表：一屏放前 N 个（默认 20），**一行一条，照 momoyu.cc 的形态**。
 *
 * 为什么不再用卡片栅格：卡片是"卡中卡"—— 面板本身已经是一张带背景的卡，
 * 里面再放一圈描边圆角的小卡，一页 34 个面板时整版的视觉重量全在"框"上，
 * 而卡里能放下的标题只占一小块。momoyu.cc 那一版是**单列无框列表**：
 * 名次 / 标题 / 数值三列 + 12px 行距，行高本身就是分隔，信息密度高得多。
 *
 * ## 行什么时候是链接
 * **逐行判**（不是整榜判一次）：`cfg.link` 给了、且**这一行**取到非空地址 → 整行是
 * `<a target="_blank">`；否则是不可点的 `<span>`。两个理由：
 *   · 有 5 个榜（aider / newmodels / swebench / orAuthors / orPerf）在数据里拿不到
 *     一个体面的原始页地址 —— 这些榜整体没有 `link`；
 *   · 而 `orApps` 给的是 `link: (r) => r.url`，**个别行**的 url 就是空。
 * 按榜判会在第二种情况里产出 `<a href="">`：看着能点，一点跳回本页。
 * 宁可少一个链接，也不要一个假的。
 *
 * ## ★ `href` 必须 esc —— 它进的是**属性**位置
 * 以前链接只出现在 `openDetail` 的文案与 `<a href>` 里，走的是 `esc(link)`；
 * 现在它由上游原始 URL 直接来（`r.url` / `r.html_url` 不过 `encodeURI`），
 * 带一个 `"` 就能闭合属性、往行里插标签。所以这里**无条件 `esc(href)`**。
 *
 * ## ★ value / meta 仍是**可选**的，判空必须在调用之前
 * 早先这里写的是 `cfg.value(r) ? … : ''` —— 看着像判空，其实**先调了再判**：
 * `meta` 没给的榜单会在这里直接抛 `cfg.meta is not a function`，整块面板变成
 * "读取失败"（aaBench 那次）。现在两边一致：**先判函数是否存在，再调**。
 *
 * `title` 仍是必需的 —— 没有标题的行没有意义，缺了就该在开发时炸，
 * 而不是渲染一行空白。
 *
 * ## 转义责任在调用方（与 table() 同一条约定）
 * `title` / `value` / `meta` 的产物原样落进 HTML，各 loader 已经用 `esc()` 包好。
 * 这里**不再包一层**：包了会把配置里刻意留的 `<span class="v-num">` 也转义掉。
 * 一条活约束随之而来：这三个函数的产物里**不许出现 `<a>`**（本站曾因 `<a>` 套 `<a>`
 * 把整片栅格撑坏），所以整行是链接时不会再嵌一层。
 */
export function cardList(rows, cfg) {
  if (!rows.length) return `<p class="empty">${L('ui.noData')}</p>`;
  const items = rows
    .map((r, i) => {
      const value = cfg.value ? cfg.value(r) : '';
      const meta = cfg.meta ? cfg.meta(r) : '';
      const inner =
        rankBadge(r.__rank ?? i + 1) +
        `<span class="li-title">${cfg.title(r)}</span>` +
        (value ? `<span class="li-val">${value}</span>` : '') +
        (meta ? `<span class="li-meta">${meta}</span>` : '');
      const href = cfg.link ? cfg.link(r) : null;
      // 空串 / null / undefined 一律回落到不可点的 <span>
      return href
        ? `<li><a class="li" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${inner}</a></li>`
        : `<li><span class="li">${inner}</span></li>`;
    })
    .join('');
  return `<ul class="card-list">${items}</ul>`;
}

/**
 * 从一行里取用于比较的值。
 * 优先 `col.value(row)`（渲染之外单独给一个取值函数，避免为了排序去解析 HTML），
 * 没有就用 `row[col.field]`。
 */
function cellValue(col, row) {
  return col.value ? col.value(row) : row[col.field];
}

/**
 * 对一批行做「分组过滤 → 文本搜索 → 排序」。
 *
 * 抽成一份纯函数的原因：11 个面板都要这三件事，而数据形态各不相同
 * （模型/应用/数据集/论文/仓库/成绩）。写成一份，规则才不会每个面板一个样 ——
 * 尤其是下面「空值恒排最后」这条，逐处手写必然会有几处漏掉。
 *
 * ★ 空值恒排在最后（无论升序降序）：否则一升序，"缺数据的"会全聚到榜首，
 * 读者看到的就是一个由空值组成的假榜。
 */
export function applyBoardState(rows, cols, state, { searchFields = [], groupField = null } = {}) {
  let out = Array.isArray(rows) ? rows : [];

  if (groupField && state.group && state.group !== '*') {
    out = out.filter((r) => String(r?.[groupField] ?? '') === state.group);
  }

  const q = String(state.q || '').trim().toLowerCase();
  if (q) {
    const fields = searchFields.length ? searchFields : ['id', 'name', 'model', 'title', 'full_name'];
    out = out.filter((r) => fields.some((f) => String(r?.[f] ?? '').toLowerCase().includes(q)));
  }

  if (state.sort && cols[state.sort.index]) {
    const col = cols[state.sort.index];
    const dir = state.sort.dir === 'asc' ? 1 : -1;
    out = [...out].sort((a, b) => {
      const va = cellValue(col, a);
      const vb = cellValue(col, b);
      const ea = va === null || va === undefined || va === '';
      const eb = vb === null || vb === undefined || vb === '';
      if (ea && eb) return 0;
      if (ea) return 1; // 空的恒在最后
      if (eb) return -1;
      const na = typeof va === 'number' ? va : Number(va);
      const nb = typeof vb === 'number' ? vb : Number(vb);
      if (Number.isFinite(na) && Number.isFinite(nb)) return (na - nb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }
  return out;
}

/** 过滤控件的 HTML：搜索框 + 可选的分组下拉 */
export function controlsHtml({ q = '', placeholder = L('ui.search'), groups = null, groupLabel = L('ui.allGroups'), group = '*' } = {}) {
  const sel = groups
    ? `<select data-group aria-label="${esc(groupLabel)}"><option value="*">${esc(groupLabel)}</option>` +
      groups
        .map((g) => `<option value="${esc(g.value)}"${g.value === group ? ' selected' : ''}>${esc(g.label)} (${g.count})</option>`)
        .join('') +
      '</select>'
    : '';
  return (
    `<div class="controls">` +
    `<input type="search" data-q value="${esc(q)}" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}">` +
    sel +
    '</div>'
  );
}

/** 从数据里算出分组下拉的选项（按出现次数降序） */
export function groupOptions(rows, field, labelOf = (v) => v) {
  const m = new Map();
  for (const r of rows) {
    const v = String(r?.[field] ?? '').trim();
    if (!v) continue;
    m.set(v, (m.get(v) || 0) + 1);
  }
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({ value, count, label: labelOf(value) }));
}

/**
 * 挂一个可过滤/可排序的榜到面板上。
 *
 * 状态（搜索词、分组、排序）留在闭包里；每次变化只重画面板 body，
 * 并**重新绑定**事件 —— 因为 DOM 被整块替换了。这是本站统一的榜渲染入口。
 */
function mountBoard(p, cfg) {
  const state = { q: '', group: '*', sort: cfg.defaultSort || null };
  const baseRows = cfg.rows;

  const draw = () => {
    let rows = applyBoardState(baseRows, cfg.cols, state, cfg);
    // transform 在"过滤 + 排序"**之后**套 —— 名次徽章必须按当前显示顺序重算，
    // 否则筛掉一半后序号还停在原始位置上（1,3,7,…）
    if (cfg.transform) rows = cfg.transform(rows);
    const shown = cfg.limit ? rows.slice(0, cfg.limit) : rows;
    const groups = cfg.groupField ? groupOptions(baseRows, cfg.groupField) : null;
    // 前 20 行（原来 10）。行比卡片矮得多，一屏能装下的信息量因此翻了一倍多。
    const limit = cfg.cardLimit ?? 20;
    // ★ "这一屏/这张表到底有多少条"有三个不同的数，别让它们互相矛盾：
    //   total    —— 过滤之后的条数（与原始数不同时用 countFiltered 显示）
    //   tableCap —— 这张表**真正显示**的条数：`cfg.limit` 是刻意收口的
    //               （swebench 收了 89 条只展示前 40、orCatalog 60、eval 50…），
    //               所以下面每条说明行都要用它，否则会出现"完整列表（89 条）"
    //               而展开后只有 40 行的自相矛盾。
    //   limit    —— 上层列表显示几行。
    const tableCap = shown.length; // 表格实际会有这么多行（`cfg.limit` 已经切过）
    const total = rows.length;
    const base = total !== baseRows.length
      ? L('ui.countFiltered', { n: total, total: baseRows.length })
      : L('ui.count', { n: total });
    const note = cfg.note ? `${base} · ${cfg.note}` : base;

    // ── 列表区：只放前 N 行 ──
    // 列表在**过滤/排序之后**取，所以搜索"gemini"时看到的就是命中的那几个。
    const list = cfg.card ? cardList(shown.slice(0, limit), cfg.card) : '';
    const moreCount = tableCap - Math.min(tableCap, limit);
    const listHtml = list
      ? list +
        (moreCount > 0
          ? `<p class="list-more">${L('ui.moreInList', { n: moreCount })}</p>`
          : '')
      : '';

    // ── 完整列表：放在折叠区里 ──
    // 为什么表格不删：列表回答"最靠前的是谁"，表格回答"第 47 名是谁 / 按成本排一下"。
    // 两者不是同一个问题，所以保留，但收起来不占首屏。
    //
    // ★ 表格**延后到展开时才建**：扁平页把 34 个面板放进一页，而 `eval` 的完整表
    //   是 4576 行 × 9 列（约 4 万个单元格）、`orCatalog` 也有整份目录 —— 每个
    //   `<details>` 默认都是收起的，先把它们全建出来等于拿几万个看不见的节点
    //   撑爆 DOM。展开过（`state.open` 为真）之后按老样子每次重画都重建，
    //   所以搜索/排序的手感不变；差别只在于"从没打开过的面板不再花这份钱"。
    const tableHtml = cfg.table === false
      ? ''
      : `<details class="more"${state.open ? ' open' : ''}>` +
        `<summary>${L('ui.fullList', { n: tableCap })}</summary>` +
        controlsHtml({
          q: state.q,
          groups,
          group: state.group,
          placeholder: cfg.placeholder || L('ui.search'),
          groupLabel: cfg.groupLabel || L('ui.allGroups'),
        }) +
        `<p class="board-count">${esc(note)}</p>` +
        `<div class="table-slot"${state.open ? '' : ` data-deferred`}>${state.open ? table(cfg.cols, shown, state.sort) : ''}</div>` +
        '</details>';

    p.body((cfg.beforeControls ? cfg.beforeControls() : '') + listHtml + tableHtml);

    // 行本身在渲染时就带了 href（有地址的榜整行是 <a>），这里不再需要点击绑定 ——
    // 以前的"点卡片弹详情"随详情层一起去掉了（行直达来源，少一次点击）。

    // 折叠区：记住开合状态，并在**首次展开时**把延后的大表建出来。
    const det = p.el.querySelector('details.more');
    if (det) {
      det.addEventListener('toggle', () => {
        state.open = det.open;
        const slot = det.querySelector('.table-slot[data-deferred]');
        if (det.open && slot) {
          slot.innerHTML = table(cfg.cols, shown, state.sort);
          slot.removeAttribute('data-deferred');
        }
      });
    }
    // 重新绑定（DOM 已换）。搜索做 ~120ms 防抖：扁平页上"边打字边重画"
    // 可能意味着每次按键重排几万行（`eval`），键盘手感会顿。
    const q = p.el.querySelector('[data-q]');
    if (q) {
      let timer = null;
      q.addEventListener('input', () => {
        state.q = q.value;
        const pos = q.selectionStart;
        clearTimeout(timer);
        timer = setTimeout(() => {
          draw();
          // 保持焦点与光标位置，否则每敲一个字都会掉焦点
          const nq = p.el.querySelector('[data-q]');
          if (nq) {
            nq.focus();
            try { nq.setSelectionRange(pos, pos); } catch { /* 该类型不支持就算了 */ }
          }
        }, 120);
      });
    }
    const g = p.el.querySelector('[data-group]');
    if (g) g.addEventListener('change', () => { state.group = g.value; draw(); });
    for (const th of p.el.querySelectorAll('th[data-sort]')) {
      const idx = Number(th.getAttribute('data-sort'));
      const toggle = () => {
        const cur = state.sort;
        // 同一列再点一次 → 反向；换一列 → 从降序开始（榜最常要看的是"最大的"）
        state.sort = cur && cur.index === idx
          ? { index: idx, dir: cur.dir === 'desc' ? 'asc' : 'desc' }
          : { index: idx, dir: 'desc' };
        draw();
      };
      th.addEventListener('click', toggle);
      th.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    }
  };

  draw();
}

/**
 * 名次徽章。前三名用奖牌色 —— 这是"榜"最需要的信息，不该让人自己数序号。
 * 颜色之外还有数字本身，所以不依赖颜色单独传达信息（色盲可用）。
 */
export function rankBadge(n) {
  const cls = n <= 3 ? ` r${n}` : '';
  return `<span class="rank${cls}">${n}</span>`;
}

/**
 * 迷你条形图：宽度相对**当前这一批行里的最大值**。
 * 它表达的是"相对高低"，不是绝对刻度 —— 同一张表内可比，跨表不可比。
 * 这对"一眼看出差距"够用，而且不需要坐标轴。
 */
export function bar(value, max) {
  const v = Number(value);
  const m = Number(max);
  if (!Number.isFinite(v) || !Number.isFinite(m) || m <= 0) return '';
  const pct = Math.max(2, Math.min(100, (v / m) * 100)); // 最小 2%：0 分也要看得见那一条
  return `<span class="bar" aria-hidden="true"><i style="--w:${pct.toFixed(1)}%"></i></span>`;
}

/** 模型名 → HuggingFace 页面链接（模型名是 [org/name] 形态） */
const hfLink = (id) => `<a href="https://huggingface.co/${encodeURI(id)}" target="_blank" rel="noopener noreferrer">${esc(id)}</a>`;

/* ================================================================== */
/* 面板 1-3：HuggingFace 模型榜（趋势 / 喜欢 / 下载）                  */
/* ================================================================== */

const HF_MODELS = 'https://huggingface.co/api/models';

/** 三个排行共用一套渲染，只有 sort 与那"一列关键数字"不同 */
function modelBoardCols(metric) {
  return [
    { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
    { label: L('col.model'), field: 'id', cell: (r) => hfLink(r.id) },
    {
      label: L('col.task'),
      field: 'pipeline_tag',
      cls: 'col-2',
      cell: (r) => (r.pipeline_tag ? `<span class="tag">${esc(r.pipeline_tag)}</span>` : ''),
    },
    {
      // 表头用图标 + 视觉隐藏的文字：图标省地方，文字让读屏器念得出来
      html: `${icon(metric.icon)}<span class="sr-only">${esc(metric.label)}</span>`,
      num: true,
      field: metric.field,
      cell: (r) => `${bar(r[metric.field], metric.max)}${compact(r[metric.field]) ?? '—'}`,
    },
    {
      html: `${icon('heart')}<span class="sr-only">${L('col.likes')}</span>`,
      num: true,
      cls: 'col-2',
      field: 'likes',
      cell: (r) => compact(r.likes) ?? '—',
    },
    {
      html: `${icon('download')}<span class="sr-only">${L('col.downloads')}</span>`,
      num: true,
      cls: 'col-2',
      field: 'downloads',
      cell: (r) => compact(r.downloads) ?? '—',
    },
  ];
}

/** 名次徽章要在**过滤/排序之后**重算，否则筛掉一半后序号还是原始的 */
function withRank(rows) {
  return rows.map((r, i) => ({ ...r, __rank: i + 1 }));
}

async function loadModelBoard({ id, iconName, title, sort, metric, hint }) {
  const p = ensurePanel({ id, iconName, title, hint });
  try {
    const url = `${HF_MODELS}?sort=${sort}&direction=-1&limit=50`;
    const data = await cachedJson(`hf-${sort}`, url);
    if (!Array.isArray(data)) throw new Error(L('err.notArray'));
    p.status('', 'ok');
    const max = Math.max(...data.map((r) => Number(r[metric.field]) || 0), 0);
    mountBoard(p, {
      rows: data,
      cols: modelBoardCols({ ...metric, max }),
      defaultSort: { index: 3, dir: 'desc' },
      searchFields: ['id'],
      groupField: 'pipeline_tag',
      groupLabel: L('ui.allTasks'),
      placeholder: L('ui.searchModels'),
      // 行本身要带序号：重排后序号得跟着走
      transform: withRank,
      card: {
        title: (r) => esc(r.id),
        value: (r) => `<span class="v-num">${compact(r[metric.field]) ?? '—'}</span> <span class="v-unit">${esc(metric.label)}</span>`,
        meta: (r) =>
          (r.pipeline_tag ? `<span class="tag">${esc(r.pipeline_tag)}</span>` : '') +
          `<span class="tag">${icon('heart')}${compact(r.likes) ?? '0'}</span>` +
          `<span class="tag">${icon('download')}${compact(r.downloads) ?? '0'}</span>`,
        link: (r) => `https://huggingface.co/${encodeURI(r.id)}`,
      },
    });
  } catch (e) {
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/* ================================================================== */
/* 面板 4：HuggingFace 开源模型评测榜                                   */
/* ================================================================== */

const EVAL_DS = 'open-llm-leaderboard%2Fcontents';
const EVAL_ENDPOINT = 'https://datasets-server.huggingface.co/rows';
const EVAL_PAGE = 100;
const EVAL_TOP = 50;

/**
 * 取数节奏 —— **降并发 + 错峰 + 分级退避**，参数全部来自 2026-09-30 的实测校准：
 *
 * datasets-server 对匿名 IP 是"突发容量 + 慢回填"的令牌桶：
 *   · 桶满时 46 页 8 并发连发也能全 200（实测 11.9s）；
 *   · 桶被前面的请求耗过后，429 `Too Many Requests` 会持续 **约 60–70 秒**才回填
 *     （实测：46 连发后每 10s 探测一次，+10s…+60s 全 429，+70s 恢复 200）；
 *   · 旧实现 8 并发 + 失败后**立刻原样重发**，在半空的桶上就是连环 429：
 *     线上真实出现过 13/46 页失败（71% 覆盖）和"第一页都没拿到"两种残局。
 *
 * 所以策略是：3 并发 + 批间 700ms（持续 ~1.2 请求/秒，桶满时 ~35s 拉完全量）；
 * 普通失败短退避（800ms 起指数放大）；**429 单独长退避**（25s×次数，封顶 60s ——
 * 等的是桶回填，不是网络恢复，短退避只会再撞一次）。
 * `live-check.mjs` 复用这一份策略，体检跑的就是访客的真实节奏。
 */
export const EVAL_FETCH = {
  batch: 3, // 每批并发页数
  batchGapMs: 700, // 批与批之间停一拍：限流按"每秒请求数"计，无缝连发等于没降并发
  attempts: 3, // 单页尝试次数（含首次）
  firstAttempts: 5, // 第一页决定总页数与整块面板的去留，多给两次机会
  backoffMs: 800, // 普通失败（网络抖动/5xx）的退避基数：800ms → 1.6s → 3.2s…封顶 5s
  rateLimitUnitMs: 25000, // 429 的退避单位：25s×次数，封顶 60s（等桶回填，见 evalRetryWaitMs）
};

/** 评测榜快照的"直用窗口"：数据源 2025-03 已归档，快照就是最新全量，
 *  7 天内的快照直接用、不再打上游 46 个请求（见 loadEvalBoard）。 */
const EVAL_SNAPSHOT_MS = 7 * 24 * 60 * 60 * 1000;

const evalRowsUrl = (offset) =>
  `${EVAL_ENDPOINT}?dataset=${EVAL_DS}&config=default&split=train&offset=${offset}&length=${EVAL_PAGE}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 第 n 次失败后等多久再试（普通失败）：基数按 2 的幂放大，封顶 5s。纯函数，测试盯着它 */
export function evalBackoffMs(attempt, base = EVAL_FETCH.backoffMs) {
  return Math.min(base * 2 ** (attempt - 1), 5000);
}

/**
 * 第 n 次失败后等多久再试（**分失败类型**）：
 *   · 上游 429 带 Retry-After → 听上游的（它说的比自家猜的准）；
 *   · 429 没说 → `rateLimitUnitMs` × 尝试次数，封顶 60s。**不是网络问题，
 *     是桶要回填**：实测耗尽的桶约 60–70s 才恢复，秒级重试只会连环再撞；
 *   · 其它失败（网络抖动 / 5xx / 解析异常）→ 短退避（evalBackoffMs）就够。
 * 纯函数；`pacing` 参数给测试注入零等待用，浏览器永远用 EVAL_FETCH 默认值。
 */
export function evalRetryWaitMs(status, retryAfterMs, attempt, pacing = EVAL_FETCH) {
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) return retryAfterMs;
  if (status === 429) return Math.min((pacing.rateLimitUnitMs ?? 0) * attempt, 60000);
  return evalBackoffMs(attempt, pacing.backoffMs);
}

/** 一个原始行 → 我们展示需要的字段；分数缺失的行返回 null（不让空值参与排序） */
export function normalizeEval(row) {
  const model = String(row.fullname || '').trim();
  if (!model) return null;
  const score = parseFloat(row['Average ⬆️']);
  if (!Number.isFinite(score)) return null;
  const f = (k) => {
    const v = parseFloat(row[k]);
    return Number.isFinite(v) ? v : null;
  };
  return {
    model,
    score,
    ifeval: f('IFEval'),
    bbh: f('BBH'),
    math: f('MATH Lvl 5'),
    gpqa: f('GPQA'),
    mmlupro: f('MMLU-PRO'),
    params: f('#Params (B)'),
  };
}

/** 取一页原始成绩；重试耗尽仍失败返回 null（单页失败不该让整个榜消失） */
async function fetchEvalPage(offset, attempts = EVAL_FETCH.attempts, pacing = EVAL_FETCH) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let status = null; // 本轮失败的 HTTP 状态（网络层错误时是 null）
    let retryAfterMs = null; // 上游 429 时会明确说"多久再来"
    try {
      const res = await fetch(evalRowsUrl(offset), { headers: { accept: 'application/json' } });
      status = res.status;
      if (!res.ok) {
        const ra = Number(res.headers?.get?.('retry-after'));
        if (Number.isFinite(ra) && ra > 0) retryAfterMs = Math.min(ra * 1000, 60000);
        throw new Error(`HTTP ${res.status}`);
      }
      const j = await res.json();
      if (!Array.isArray(j?.rows)) throw new Error(L('err.noRows'));
      return j;
    } catch (e) {
      // 退避时长按失败类型分（见 evalRetryWaitMs）：429 等桶回填，其它等网络缓过来。
      // 旧实现是失败后立刻原样重发 —— 对 429 恰好是再撞一次限流
      if (attempt === attempts) return null;
      await sleep(evalRetryWaitMs(status, retryAfterMs, attempt, pacing));
    }
  }
  return null; // 循环正常走不出这里；这行写给读代码的人
}

/**
 * 拉全量（第一页探总数 → 分批限速取余下页）。
 *
 * 为什么必须先拉第一页：**页数只能在拿到 `num_rows_total` 之后才知道**
 * （46 页这个数字不是写死的，上游加模型时会变）。第一页失败就直接报错 ——
 * 没有总数就无法判断"取了多少比例"，与其显示一个残榜不如明说拿不到。
 *
 * `policy` 参数是给测试与 `live-check.mjs` 用的（传零延迟跑得快）；
 * 浏览器里永远用上面那份 EVAL_FETCH 默认值。
 */
export async function fetchAllEvalPages(onProgress, policy = EVAL_FETCH) {
  const first = await fetchEvalPage(0, policy.firstAttempts, policy);
  if (!first) throw new Error(L('err.evalFirst'));

  const total = Number.isFinite(first.num_rows_total) ? first.num_rows_total : null;
  const pageCount = total ? Math.ceil(total / EVAL_PAGE) : 1;
  const rows = [...first.rows.map((x) => x.row)];
  let failed = 0;

  const rest = [];
  for (let o = EVAL_PAGE; o < pageCount * EVAL_PAGE; o += EVAL_PAGE) rest.push(o);

  onProgress?.({ done: 1, total: pageCount, got: rows.length, failed });

  for (let i = 0; i < rest.length; i += policy.batch) {
    // 批间错峰：限流按"每秒请求数"计，一批接一批无缝连发就等于没降并发
    if (i > 0) await sleep(policy.batchGapMs);
    const batch = rest.slice(i, i + policy.batch);
    const results = await Promise.all(batch.map((o) => fetchEvalPage(o, policy.attempts, policy)));
    for (const r of results) {
      if (r) rows.push(...r.rows.map((x) => x.row));
      else failed += 1;
    }
    onProgress?.({ done: 1 + Math.min(i + policy.batch, rest.length), total: pageCount, got: rows.length, failed });
  }
  return { rows, failed, total, pageCount };
}

function evalBoardCols(max) {
  return [
    { label: '#', sortable: false, cell: (r) => rankBadge(r.rank) },
    { label: L('col.model'), field: 'model', cell: (r) => hfLink(r.model) },
    { label: L('col.avg'), num: true, field: 'score', cell: (r) => `${bar(r.score, max)}${num(r.score, 1) ?? '—'}` },
    // 以下几列在窄屏收起（site.css 的 .col-2）：手机上横向滚 9 列很难用，
    // 优先保证"哪个模型、多少分"这两件事可读
    { label: L('col.params'), num: true, cls: 'col-2', field: 'params', cell: (r) => num(r.params, 1) ?? '—' },
    { label: 'IFEval', num: true, cls: 'col-2', field: 'ifeval', cell: (r) => num(r.ifeval, 1) ?? '—' },
    { label: 'BBH', num: true, cls: 'col-2', field: 'bbh', cell: (r) => num(r.bbh, 1) ?? '—' },
    { label: 'MATH', num: true, cls: 'col-2', field: 'math', cell: (r) => num(r.math, 1) ?? '—' },
    { label: 'GPQA', num: true, cls: 'col-2', field: 'gpqa', cell: (r) => num(r.gpqa, 1) ?? '—' },
    { label: 'MMLU-PRO', num: true, cls: 'col-2', field: 'mmlupro', cell: (r) => num(r.mmlupro, 1) ?? '—' },
  ];
}

/** 评测榜：每次都要按当前顺序重排名次 */
function rankEvalRows(rows) {
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

/** 评测榜的挂载：limit 用 EVAL_TOP，并把"覆盖多少页"这类口径放进说明 */
function mountEvalBoard(p, models, note) {
  mountBoard(p, {
    rows: models,
    cols: evalBoardCols(Math.max(...models.map((r) => r.score), 0)),
    defaultSort: { index: 2, dir: 'desc' },
    limit: EVAL_TOP,
    searchFields: ['model'],
    placeholder: L('ui.searchModels'),
    transform: rankEvalRows,
    note,
    card: {
      title: (r) => esc(r.model),
      value: (r) => `<span class="v-num">${num(r.score, 1)}</span> <span class="v-unit">${L('col.avg')}</span>`,
      meta: (r) =>
        (r.params ? `<span class="tag">${num(r.params, 1)}B</span>` : '') +
        `<span class="tag">IFEval ${num(r.ifeval, 1) ?? '—'}</span>` +
        `<span class="tag">MMLU-PRO ${num(r.mmlupro, 1) ?? '—'}</span>`,
      link: (r) => `https://huggingface.co/${encodeURI(r.model)}`,
    },
  });
}

async function loadEvalBoard() {
  const p = ensurePanel(shellMeta('eval'));
  // 走 readCacheEntry()/readSnapshot() 而不是直接碰存储：存储被禁用时要降级成
  // "没有缓存"，而不是让整块面板崩掉（它只是缓存，不该有这种权力）
  const cached = readCacheEntry('eval-board', CACHE_TTL_MS);
  if (cached && Array.isArray(cached.v) && cached.v.length) {
    p.status('', 'ok');
    mountEvalBoard(p, cached.v, L('ui.cached', { n: cached.v.length, time: fmtStamp(cached.t) }));
    return;
  }

  // 7 天内的快照直接用（除非"刷新数据"点了强制重拉）：数据源 2025-03 已归档，
  // 快照就是最新全量 —— 与其每次进页面都打上游 46 个限流敏感的请求，
  // 不如把"每台浏览器每 7 天拉一次全量"作为常态。时刻照实标注。
  const forced = forceRefetch();
  const snap = readSnapshot('eval-board', EVAL_SNAPSHOT_MS);
  if (!forced && snap && Array.isArray(snap.v) && snap.v.length) {
    p.status('', 'ok');
    mountEvalBoard(p, snap.v, L('st.evalSnap', { time: fmtStamp(snap.t) }));
    return;
  }

  p.status(L('st.fetchingPages'));
  const seen = new Map(); // 以模型名去重：同一模型可能有多个精度版本，保留分高的那个
  let lastStatus = '';
  try {
    const { rows, failed, pageCount } = await fetchAllEvalPages(({ done, total, got, failed }) => {
      const s = failed
        ? L('st.progressFailed', { got, done, total, failed })
        : L('st.progress', { got, done, total });
      if (s !== lastStatus) {
        lastStatus = s;
        p.status(s);
      }
    });

    for (const row of rows) {
      const m = normalizeEval(row);
      if (!m) continue;
      const prev = seen.get(m.model);
      if (!prev || m.score > prev.score) seen.set(m.model, m);
    }
    const models = [...seen.values()];
    if (!models.length) throw new Error(L('err.noBoard'));

    // 只有**零缺页**的完整结果才进 10 分钟缓存；部分成功不进 ——
    // 否则一次 71% 覆盖会在缓存期内被当成完整榜反复展示
    if (!failed) writeCache('eval-board', models);
    // 快照（localStorage）无论完整与否都写：它只当回退物与 7 天直用窗口的来源
    writeSnapshot('eval-board', models);

    p.status('', failed ? 'warn' : 'ok');
    mountEvalBoard(
      p,
      models,
      failed
        ? L('st.evalDonePartial', { n: models.length, pages: pageCount, failed, time: fmtStamp(Date.now()) })
        : L('st.evalDone', { n: models.length, pages: pageCount, time: fmtStamp(Date.now()) })
    );
  } catch (e) {
    // 全量都没拿到：回退"最近一次成功抓取"的快照（可能早已过 7 天，仍如实标时刻），
    // 而不是给一个空面板加一句干巴巴的报错 —— 不编数据，但也不让读者白来一趟
    const last = readSnapshot('eval-board');
    if (last && Array.isArray(last.v) && last.v.length) {
      p.status('', 'warn');
      mountEvalBoard(p, last.v, L('st.evalStale', { msg: e.message, time: fmtStamp(last.t), n: last.v.length }));
      return;
    }
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/* ================================================================== */
/* 面板 5：Aider 编程能力榜（YAML 子集）                                */
/* ================================================================== */

const AIDER_URL =
  'https://raw.githubusercontent.com/Aider-AI/aider/main/aider/website/_data/polyglot_leaderboard.yml';

/**
 * 最小 YAML 子集解析器。
 *
 * 只认识这一种形态（Aider 榜单的实际写法）：
 *   - dirname: xxx
 *     model: Gemini 2.0 Pro
 *     pass_rate_2: 35.6
 *     date: 2025-02-25
 * 即：**扁平的数组，元素是"键: 标量值"**。不支持嵌套、锚点、多行块、行内数组。
 *
 * ## 遇到嵌套必须抛错，而不是继续解析（这条有测试盯着）
 * 一个嵌套映射（`- a:` 换行后跟更深缩进的 `b: 1`）在 YAML 里表示 `{a: {b: 1}}`，
 * 但按本解析器"逐行取 key: value"的写法会**静默拍平**成 `{a: null, b: 1}` ——
 * 键还在、值却挂错了地方，页面上看不出异常。所以这里显式比较缩进：
 * 续行的键缩进若比本元素的键缩进更深，就判定为嵌套并抛错。
 * 宁可这个面板报"上游格式变了"，也不要显示一个悄悄错位的值。
 */
export function parseFlatYamlList(text) {
  const items = [];
  let cur = null;
  let keyIndent = null; // 本元素里键的缩进列（用于识别嵌套）
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^\s*#/.test(raw) || /^\s*$/.test(raw) || /^---\s*$/.test(raw)) continue;

    // 顶层数组元素：以 "- " 开头（"-" 后可以是键、也可以是空）
    const newItem = /^(\s*)-\s*(.*)$/.exec(raw);
    if (newItem) {
      cur = {};
      items.push(cur);
      const indentAfterDash = newItem[1].length + 2; // "- " 占两列
      keyIndent = indentAfterDash;
      const rest = newItem[2].trim();
      if (rest) {
        const kv = /^([^:]+):\s*(.*)$/.exec(rest);
        if (!kv) throw new Error(L('err.yamlNotKV', { line: i + 1, text: raw.trim() }));
        // "- key:" 后面什么都没有 = 值在更深缩进的下一行（嵌套）→ 直接判错
        if (kv[2].trim() === '') {
          throw new Error(L('err.yamlNested', { line: i + 1, key: kv[1].trim() }));
        }
        cur[kv[1].trim()] = scalar(kv[2]);
      }
      continue;
    }

    const kv = /^(\s+)([^:]+):\s*(.*)$/.exec(raw);
    if (kv && cur) {
      // 缩进比本元素的键更深 → 这是嵌套，不是兄弟键
      if (keyIndent !== null && kv[1].length > keyIndent) {
        throw new Error(L('err.yamlIndent', { line: i + 1 }));
      }
      if (kv[3].trim() === '') {
        throw new Error(L('err.yamlNested', { line: i + 1, key: kv[2].trim() }));
      }
      cur[kv[2].trim()] = scalar(kv[3]);
      continue;
    }
    throw new Error(L('err.yamlSubset', { line: i + 1, text: raw.trim().slice(0, 60) }));
  }
  return items;
}

/** 标量转换：去掉引号、识别数字/布尔/null。**不做**日期解析（保持原样字符串） */
function scalar(s) {
  let v = String(s ?? '').trim();
  if (/^".*"$/.test(v) || /^'.*'$/.test(v)) return v.slice(1, -1);
  if (v === '' || v === '~' || v === 'null') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return parseFloat(v);
  return v;
}

/**
 * Aider 的榜每个模型有**多行**（同一模型的不同尝试/日期各一行），
 * 取每个模型的最高 pass_rate_2 作为它的成绩。
 */
export function bestAiderRows(entries) {
  const best = new Map();
  for (const e of entries) {
    const model = String(e.model || '').trim();
    const rate = parseFloat(e.pass_rate_2);
    if (!model || !Number.isFinite(rate)) continue;
    const prev = best.get(model);
    if (!prev || rate > prev.rate) best.set(model, { model, rate, date: e.date ?? null });
  }
  return [...best.values()].sort((a, b) => b.rate - a.rate);
}

async function loadAiderBoard() {
  const p = ensurePanel(shellMeta('aider'));
  try {
    const res = await fetch(AIDER_URL, { headers: { accept: 'text/plain' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = bestAiderRows(parseFlatYamlList(await res.text()));
    if (!rows.length) throw new Error(L('err.noBoard'));
    p.status('', 'ok');
    mountBoard(p, {
      rows,
      cols: [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        { label: L('col.model'), field: 'model', cell: (r) => esc(r.model) },
        { label: L('col.rate'), num: true, field: 'rate', cell: (r) => `${num(r.rate, 1)}%` },
        { label: L('col.date'), field: 'date', cell: (r) => esc(r.date ?? '—') },
      ],
      defaultSort: { index: 2, dir: 'desc' },
      searchFields: ['model'],
      placeholder: L('ui.searchModels'),
      transform: withRank,
      card: {
        title: (r) => esc(r.model),
        value: (r) => `<span class="v-num">${num(r.rate, 1)}%</span> <span class="v-unit">${L('col.rate')}</span>`,
        meta: (r) => (r.date ? `<span class="tag">${esc(r.date)}</span>` : ''),
      },
    });
  } catch (e) {
    p.status(
      L('st.failed', { msg: e.message }) + (/YAML|行|Line/.test(e.message) ? L('err.yamlChanged') : L('st.rateLimited')),
      'err'
    );
    p.body('');
  }
}

/* ================================================================== */
/* 面板 6：HF Spaces 趋势（AI 应用榜）                                   */
/* ================================================================== */

async function loadSpaces() {
  const p = ensurePanel(shellMeta('spaces'));
  try {
    const data = await cachedJson('hf-spaces', `${HF_MODELS.replace('/models', '/spaces')}?sort=trendingScore&direction=-1&limit=50`);
    if (!Array.isArray(data)) throw new Error(L('err.notArray'));
    const max = Math.max(...data.map((r) => Number(r.trendingScore) || 0), 0);
    p.status('', 'ok');
    mountBoard(p, {
      rows: data,
      cols: [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        { label: L('col.app'), field: 'id', cell: (r) => hfLink(r.id).replace('huggingface.co/', 'huggingface.co/spaces/') },
        { label: L('col.sdk'), field: 'sdk', cls: 'col-2', cell: (r) => (r.sdk ? `<span class="tag">${esc(r.sdk)}</span>` : '') },
        {
          html: `${icon('trending')}<span class="sr-only">${L('col.trending')}</span>`,
          num: true,
          field: 'trendingScore',
          cell: (r) => `${bar(r.trendingScore, max)}${compact(r.trendingScore) ?? '—'}`,
        },
        { html: `${icon('heart')}<span class="sr-only">${L('col.likes')}</span>`, num: true, cls: 'col-2', field: 'likes', cell: (r) => compact(r.likes) ?? '—' },
      ],
      defaultSort: { index: 3, dir: 'desc' },
      searchFields: ['id'],
      groupField: 'sdk',
      groupLabel: L('ui.allSdks'),
      placeholder: L('ui.searchApps'),
      transform: withRank,
      card: {
        title: (r) => esc(r.id),
        value: (r) => `<span class="v-num">${compact(r.trendingScore) ?? '—'}</span> <span class="v-unit">${L('col.trending')}</span>`,
        meta: (r) =>
          (r.sdk ? `<span class="tag">${esc(r.sdk)}</span>` : '') +
          `<span class="tag">${icon('heart')}${compact(r.likes) ?? '0'}</span>`,
        link: (r) => `https://huggingface.co/spaces/${encodeURI(r.id)}`,
      },
    });
  } catch (e) {
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/* ================================================================== */
/* 面板 7：HF 数据集趋势                                                 */
/* ================================================================== */

async function loadDatasets() {
  const p = ensurePanel(shellMeta('datasets'));
  try {
    const data = await cachedJson('hf-datasets', `${HF_MODELS.replace('/models', '/datasets')}?sort=trendingScore&direction=-1&limit=50`);
    if (!Array.isArray(data)) throw new Error(L('err.notArray'));
    const max = Math.max(...data.map((r) => Number(r.trendingScore) || 0), 0);
    p.status('', 'ok');
    mountBoard(p, {
      rows: data,
      cols: [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        { label: L('col.dataset'), field: 'id', cell: (r) => hfLink(r.id).replace('huggingface.co/', 'huggingface.co/datasets/') },
        {
          html: `${icon('trending')}<span class="sr-only">${L('col.trending')}</span>`,
          num: true,
          field: 'trendingScore',
          cell: (r) => `${bar(r.trendingScore, max)}${compact(r.trendingScore) ?? '—'}`,
        },
        { html: `${icon('heart')}<span class="sr-only">${L('col.likes')}</span>`, num: true, cls: 'col-2', field: 'likes', cell: (r) => compact(r.likes) ?? '—' },
        { html: `${icon('download')}<span class="sr-only">${L('col.downloads')}</span>`, num: true, cls: 'col-2', field: 'downloads', cell: (r) => compact(r.downloads) ?? '—' },
      ],
      defaultSort: { index: 2, dir: 'desc' },
      searchFields: ['id'],
      placeholder: L('ui.searchDatasets'),
      transform: withRank,
      card: {
        title: (r) => esc(r.id),
        value: (r) => `<span class="v-num">${compact(r.trendingScore) ?? '—'}</span> <span class="v-unit">${L('col.trending')}</span>`,
        meta: (r) =>
          `<span class="tag">${icon('heart')}${compact(r.likes) ?? '0'}</span>` +
          `<span class="tag">${icon('download')}${compact(r.downloads) ?? '0'}</span>`,
        link: (r) => `https://huggingface.co/datasets/${encodeURI(r.id)}`,
      },
    });
  } catch (e) {
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/* ================================================================== */
/* 面板 8：HF 每日论文（热榜）                                           */
/* ================================================================== */

/** 论文条目 → 展示需要的字段。upvotes 是"热度"信号，缺了就不排它。 */
export function normalizePaper(entry) {
  const p = entry?.paper || {};
  const title = String(p.title || entry?.title || '').trim();
  if (!title) return null;
  const votes = Number(p.upvotes);
  return {
    id: p.id ?? null,
    title,
    votes: Number.isFinite(votes) ? votes : 0,
    date: String(p.publishedAt || entry?.publishedAt || '').slice(0, 10),
    summary: String(p.summary || entry?.summary || '').trim(),
  };
}

export function rankPapers(entries) {
  const seen = new Map();
  for (const e of entries) {
    const r = normalizePaper(e);
    if (!r) continue;
    if (!seen.has(r.title)) seen.set(r.title, r);
  }
  return [...seen.values()].sort((a, b) => b.votes - a.votes);
}

async function loadPapers() {
  const p = ensurePanel(shellMeta('papers'));
  try {
    const data = await cachedJson('hf-papers', 'https://huggingface.co/api/daily_papers?limit=50');
    if (!Array.isArray(data)) throw new Error(L('err.notArray'));
    const rows = rankPapers(data);
    if (!rows.length) throw new Error(L('err.noPapers'));
    const max = Math.max(...rows.map((r) => r.votes), 0);
    p.status('', 'ok');
    mountBoard(p, {
      rows,
      cols: [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        {
          label: L('col.paper'),
          field: 'title',
          cell: (r) =>
            `<a href="https://huggingface.co/papers/${encodeURIComponent(r.id || '')}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a>`,
        },
        { label: L('col.date'), cls: 'col-2', field: 'date', cell: (r) => esc(r.date || '—') },
        {
          html: `${icon('heart')}<span class="sr-only">${L('col.votes')}</span>`,
          num: true,
          field: 'votes',
          cell: (r) => `${bar(r.votes, max)}${compact(r.votes) ?? '0'}`,
        },
      ],
      defaultSort: { index: 3, dir: 'desc' },
      limit: 30,
      searchFields: ['title'],
      placeholder: L('ui.searchPapers'),
      transform: withRank,
      card: {
        title: (r) => esc(r.title),
        value: (r) => `<span class="v-num">${compact(r.votes) ?? '0'}</span> <span class="v-unit">${L('col.votes')}</span>`,
        meta: (r) => (r.date ? `<span class="tag">${esc(r.date)}</span>` : ''),
        link: (r) => `https://huggingface.co/papers/${encodeURIComponent(r.id || '')}`,
      },
    });
  } catch (e) {
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/* ================================================================== */
/* 面板 9：GitHub 高星 AI 项目（可按时间段 / 语言切换）                   */
/* ================================================================== */

const GH_QUERIES = {
  week: { labelKey: 'col.weekStars', q: 'topic:llm created:>@WEEK@' },
  month: { labelKey: 'col.monthStars', q: 'topic:llm created:>@MONTH@' },
  stars: { labelKey: 'col.totalStars', q: 'topic:llm stars:>1000' },
};

const isoDaysAgo = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

/**
 * 只留真正的 AI 仓库并排序。
 * 为什么不用 GitHub 返回的顺序：它的 `sort=stars` 对"本周新增"没有意义
 * （按总星标排，永远是那几个大仓库），而热门榜要看的是**当期**增量。
 * 所以按当期索引排序，并把当期增量与总星标分开显示。
 */
export function rankRepos(items, metricKey) {
  const rows = (items || [])
    .filter((r) => r && typeof r.full_name === 'string')
    .map((r) => ({
      full_name: r.full_name,
      html_url: r.html_url,
      description: String(r.description || '').trim(),
      stars: Number(r.stargazers_count) || 0,
      gained: Number(r[metricKey]) || 0, // 本期新增星标（GitHub 只在带日期条件的搜索里给）
      lang: r.language || null,
      created: String(r.created_at || '').slice(0, 10),
    }));
  // 有当期增量就按增量排，否则退回总星标
  const useGained = rows.some((r) => r.gained > 0);
  return rows.sort((a, b) => (useGained ? b.gained - a.gained : b.stars - a.stars));
}

async function loadRepos(range = 'week') {
  const p = ensurePanel(shellMeta('repos'));
  try {
    const q = GH_QUERIES[range].q.replace('@WEEK@', isoDaysAgo(7)).replace('@MONTH@', isoDaysAgo(30));
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=30`;
    const data = await cachedJson(`gh-${range}`, url);
    if (!Array.isArray(data?.items)) throw new Error(L('err.noItems'));
    const rows = rankRepos(data.items, 'stargazers_count');
    if (!rows.length) throw new Error(L('err.noRepos'));
    p.status('', 'ok');

    // 时间段切换放在过滤控件之上；切换时只重画这个面板（不重建，避免整列跳动）
    const switchHtml = Object.entries(GH_QUERIES)
      .map(([k, v]) => `<button class="chip${k === range ? ' on' : ''}" data-range="${k}" type="button">${esc(L(v.labelKey))}</button>`)
      .join('');

    mountBoard(p, {
      rows,
      cols: [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        { label: L('col.repo'), field: 'full_name', cell: (r) => `<a href="${esc(r.html_url)}" target="_blank" rel="noopener noreferrer">${esc(r.full_name)}</a>` },
        { label: L('col.lang'), cls: 'col-2', field: 'lang', cell: (r) => (r.lang ? `<span class="tag">${esc(r.lang)}</span>` : '') },
        { html: `${icon('star')}<span class="sr-only">${L('col.stars')}</span>`, num: true, field: 'stars', cell: (r) => compact(r.stars) ?? '—' },
      ],
      defaultSort: { index: 3, dir: 'desc' },
      searchFields: ['full_name', 'description'],
      groupField: 'lang',
      groupLabel: L('ui.allLangs'),
      placeholder: L('ui.searchRepos'),
      transform: withRank,
      card: {
        title: (r) => esc(r.full_name),
        value: (r) => `<span class="v-num">${compact(r.stars) ?? '—'}</span> <span class="v-unit">${L('col.stars')}</span>`,
        meta: (r) =>
          (r.lang ? `<span class="tag">${esc(r.lang)}</span>` : '') +
          `<span class="tag">${esc(r.created)}</span>`,
        link: (r) => r.html_url,
      },
      beforeControls: () => `<div class="chips" data-chips>${switchHtml}</div>`,
    });

    // 绑定时间段切换（mountBoard 每次重画都会换 DOM，所以在这里绑会随重画失效，
    // 因此挂到面板元素上用事件委托 —— 只绑一次即可）
    wireOnce(p.el, 'range', (e) => {
      const btn = e.target.closest?.('[data-range]');
      if (btn) loadRepos(btn.getAttribute('data-range'));
    });
  } catch (e) {
    p.status(L('st.failed', { msg: e.message }) + L('st.ghLimit'), 'err');
    p.body('');
  }
}

/* ================================================================== */
/* 面板 9.5：GitHub Trending 每日榜（构建期快照，AI 关键词过滤）         */
/* ================================================================== */

/**
 * 快照地址：相对**本模块**（import.meta.url）而不是页面解析 —— 中文页在 `/`、
 * 英文页在 `/en/`，同一个相对路径在两边会解析到不同目录；钉在脚本自身上，
 * 两种页面取到的都是 `assets/data/gh-trending.json`。
 *
 * 为什么是快照而不是浏览器直连：github.com 的页面响应**不带 CORS**
 * （2026-09-30 实测），浏览器直连必被拦；页面是 650KB 的 HTML 也不适合每次
 * 进页面都拖一遍。快照由 `scripts/fetch-gh-trending.mjs` 在**构建期**生成
 * （GitHub Actions 每日跑），抓取失败就不提交、旧快照原样保留 ——
 * 页面上继续显示旧快照与它的抓取时刻，绝不拿残缺数据顶上。
 */
const GH_TRENDING_SNAP_URL = new URL('./data/gh-trending.json', import.meta.url).href;

/** 极小的 HTML 实体还原（解析描述里的 &amp; 这类用，五样够覆盖 GitHub 的输出） */
function unescapeHtml(s) {
  return String(s)
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

/** "1,281" → 1281；"abc"/缺失 → null（空值恒排最后，不冒充 0 星） */
const intOrNull = (s) => {
  const n = parseInt(String(s ?? '').replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};

/**
 * 解析 github.com/trending 的 HTML → 结构化条目。
 * 页面与 CI 抓取脚本用的是**同一份**实现（脚本 import 这里的导出），
 * 字段对不上只会在一处修。依赖的标记都取自 2026-09-30 的真实页面；
 * GitHub 改版时这里解析出的条目会骤减，抓取脚本按"少于 5 条"拒绝提交 ——
 * 坏快照进不了仓库，门禁在 CI 侧而不是靠人眼。
 */
export function parseGhTrending(html) {
  const out = [];
  const articles = String(html || '').match(/<article class="Box-row">[\s\S]*?<\/article>/g) || [];
  for (const a of articles) {
    // 仓库：h2 里的链接（article 里第一个 <a> 是"登录加星"按钮，指到 /login，不能要）
    const repo = /<h2[^>]*>\s*<a[^>]*href="\/([^"]+)"/.exec(a)?.[1];
    if (!repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) continue;
    out.push({
      repo,
      desc: unescapeHtml(/<p class="col-9[^"]*">([\s\S]*?)<\/p>/.exec(a)?.[1] ?? '').trim(),
      lang: /itemprop="programmingLanguage">([^<]+)</.exec(a)?.[1]?.trim() || '',
      stars: intOrNull(/\/stargazers"[^>]*>[\s\S]*?<\/svg>\s*([\d,]+)/.exec(a)?.[1]),
      forks: intOrNull(/\/forks"[^>]*>[\s\S]*?<\/svg>\s*([\d,]+)/.exec(a)?.[1]),
      starsToday: intOrNull(/([\d,]+)\s+stars today/.exec(a)?.[1]),
    });
  }
  return out;
}

/**
 * AI 关键词 —— 判断一个 trending 仓库是否与 AI 相关。**词边界**匹配：
 * "storage" 里的 rag、"detail" 里的 ai、"html" 里的 ml 都不该命中。
 * 取舍是**宁缺勿滥**：模糊的词（smart / data / app）不进清单 ——
 * 把无关仓库拉进"仅 AI"视图，比漏掉一个边缘仓库更伤这个榜的可信度。
 */
const AI_KEYWORDS = [
  'ai', 'agi', 'llm', 'llms', 'gpt', 'chatgpt', 'claude', 'gemini', 'deepseek',
  'qwen', 'mistral', 'llama', 'kimi', 'doubao', 'openai', 'anthropic', 'copilot',
  'genai', 'generative ai', 'agent', 'agents', 'agentic', 'mcp', 'autogen',
  'crewai', 'langchain', 'langgraph', 'llamaindex', 'rag', 'embedding', 'embeddings',
  'vector database', 'transformer', 'transformers', 'diffusion', 'stable diffusion',
  'comfyui', 'midjourney', 'sdxl', 'vllm', 'ollama', 'llama.cpp', 'gguf',
  'lora', 'fine-tuning', 'finetuning', 'fine-tune', 'whisper', 'tts', 'asr',
  'speech recognition', 'voice cloning', 'text-to-speech', 'text to speech',
  'speech to text', 'ocr', 'nlp', 'machine learning', 'deep learning',
  'neural network', 'neural networks', 'yolo', 'multimodal', 'text-to-image',
  'text to image', 'image generation', 'video generation', 'chatbot', 'chatbots',
  'inference', 'tokenizer', 'quantization', 'mlops', 'semantic search',
  'knowledge graph', 'large language model',
];
const AI_RE = new RegExp(`(?:^|[^a-z0-9])(?:${AI_KEYWORDS.join('|')})(?:[^a-z0-9]|$)`, 'i');

/**
 * 中文 AI 关键词 —— CJK 没有词边界，直接子串匹配即可（不存在"大模型"嵌在
 * 别的词里"的问题）。选词仍是宁缺勿滥：'智能'/'模型'这种单看会误伤的词不进表。
 */
const AI_TEXT_ZH_RE =
  /大模型|人工智能|智能体|深度学习|机器学习|神经网络|文生图|图生视频|语音识别|自动驾驶|多模态|生成式|AIGC|文心|通义|混元|豆包|智谱|开源模型|大语言模型/i;

/** 一段文本是否 AI 相关（中英一起看：英语词边界 + 中文子串）。GitHub Trending 与中文热榜共用 */
export function isAiText(text) {
  const s = String(text ?? '');
  return AI_TEXT_ZH_RE.test(s) || AI_RE.test(s);
}

/** 一个 trending 条目是否 AI 相关：仓库名 + 描述一起看 */
export function isAiRepo(entry) {
  return isAiText(`${entry?.repo ?? ''} ${entry?.desc ?? ''}`);
}

/** 快照 JSON → 面板行（数字归一、AI 标记、空仓库名剔除） */
export function flattenGhTrending(snap) {
  const entries = Array.isArray(snap?.entries) ? snap.entries : [];
  const rows = [];
  for (const e of entries) {
    const repo = String(e?.repo || '').trim();
    if (!repo) continue;
    rows.push({
      repo,
      desc: String(e?.desc || '').trim(),
      lang: String(e?.lang || '').trim(),
      // 快照是 CI 用 parseGhTrending 生成的（数字），这里仍走 intOrNull：
      // 手工修过/旧版快照里的 "12,682" 字符串也能归一，坏值一律 null 不冒充 0
      stars: intOrNull(e?.stars),
      forks: intOrNull(e?.forks),
      starsToday: intOrNull(e?.starsToday),
      ai: isAiRepo(e),
    });
  }
  return rows;
}

/** 面板：GitHub Trending 每日榜（默认只看 AI 相关，可切全部仓库） */
async function loadGhTrending(view = 'ai') {
  const p = ensurePanel(shellMeta('ghTrending'));
  try {
    // 快照很小（几十 KB），10 分钟内的会话缓存足够 —— 数据本来就是每日一更
    const snap = await cachedJson('gh-trending', GH_TRENDING_SNAP_URL);
    const fetchedAt = Date.parse(snap?.fetchedAt);
    const all = flattenGhTrending(snap);
    if (!all.length) throw new Error(L('err.noRepos'));
    const rows = view === 'ai' ? all.filter((r) => r.ai) : all;
    p.status('', 'ok');
    mountBoard(p, {
      rows,
      cols: [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        {
          label: L('col.repo'),
          field: 'repo',
          cell: (r) => `<a href="https://github.com/${encodeURI(r.repo)}" target="_blank" rel="noopener noreferrer">${esc(r.repo)}</a>`,
        },
        { label: L('col.starsToday'), num: true, field: 'starsToday', cell: (r) => compact(r.starsToday) ?? '—' },
        { label: L('col.stars'), num: true, cls: 'col-2', field: 'stars', cell: (r) => compact(r.stars) ?? '—' },
        { label: L('col.lang'), cls: 'col-2', field: 'lang', cell: (r) => (r.lang ? `<span class="tag">${esc(r.lang)}</span>` : '—') },
        { label: L('col.desc'), field: 'desc', cell: (r) => esc(r.desc) || '—' },
      ],
      defaultSort: { index: 2, dir: 'desc' },
      searchFields: ['repo', 'desc', 'lang'],
      groupField: 'lang',
      groupLabel: L('ui.allLangs'),
      placeholder: L('ui.searchRepos'),
      transform: withRank,
      beforeControls: () => subBoardChips({ ai: 'p.ghTrending.ai', all: 'p.ghTrending.all' }, view, 'ghtrend'),
      // 快照声明：这是构建期抓的、什么时候抓的 —— 每榜都要能回答这两句
      note: L('st.ghSnap', { time: fmtStamp(Number.isFinite(fetchedAt) ? fetchedAt : Date.now()) }),
      card: {
        title: (r) => esc(r.repo),
        value: (r) => `<span class="v-num">+${compact(r.starsToday) ?? '—'}</span> <span class="v-unit">${L('col.starsToday')}</span>`,
        meta: (r) =>
          (r.lang ? `<span class="tag">${esc(r.lang)}</span>` : '') +
          `<span class="tag">${icon('star')}${compact(r.stars) ?? '—'}</span>`,
        link: (r) => `https://github.com/${r.repo}`,
      },
    });
    // 子视图切换（事件委托：mountBoard 每次重画都换 DOM，绑在面板元素上只绑一次）
    wireOnce(p.el, 'ghtrend', (e) => {
      const b = e.target.closest?.('[data-ghtrend]');
      if (b) loadGhTrending(b.getAttribute('data-ghtrend'));
    });
  } catch (e) {
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/* ================================================================== */
/* 面板 9.6：AI 新闻热点（8 源构建期快照）与 13 个中文热榜（聚合快照）    */
/* ================================================================== */

/**
 * 三份快照的地址：相对**本模块**解析（与 ghTrending 同一理由 —— 中英文页面
 * 在不同目录，钉死在脚本自身上两种页面才取到同一个文件）。
 * 由 scripts/ 下的抓取脚本在构建期生成（管道的工程记录见仓库 docs），
 * `.github/workflows/refresh-snapshots.yml` 每日刷新；抓取失败不提交，
 * 旧快照原样保留（页面照常显示旧快照与它的抓取时刻）。
 */
const AI_NEWS_SNAP_URL = new URL('./data/ai-news.json', import.meta.url).href;
const AI_PRESS_SNAP_URL = new URL('./data/ai-press.json', import.meta.url).href;
const CN_HOT_SNAP_URL = new URL('./data/cn-hot.json', import.meta.url).href;

/** AI 新闻快照 → 面板行（坏条目剔除；score 缺失为 null，空值恒排最后） */
export function flattenAiNews(snap) {
  const out = [];
  for (const s of snap?.sources || []) {
    for (const it of s?.items || []) {
      const title = String(it?.title || '').trim();
      const url = String(it?.url || '').trim();
      if (!title || !url) continue;
      out.push({
        title,
        url,
        source: String(s.name || s.key || ''),
        time: String(it.time || ''),
        score: Number.isFinite(Number(it.score)) ? Number(it.score) : null,
        author: String(it.author || ''),
      });
    }
  }
  return out;
}

/**
 * 新闻类面板的公共骨架：aiNews（聚合/社区源）与 aiPress（一手信源）形状相同
 * （都是 {fetchedAt, sources:[{key,name,fetchedAt,items}]}），只差面板身份与
 * 快照地址 —— 抽成一个工厂，避免两份 100 行的复制（复制的失效方式就是
 * 改了这边忘了那边）。
 */
async function mountNewsPanel({ id, iconName, snapUrl, cacheKey, showScore = true }) {
  const p = ensurePanel({ id, iconName, title: L(`p.${id}.title`), hint: L(`p.${id}.hint`) });
  try {
    const snap = await cachedJson(cacheKey, snapUrl);
    const rows = flattenAiNews(snap);
    if (!rows.length) throw new Error(L('err.noNews'));
    // 标"最老来源"的抓取时刻：有源失联时读者能看到最旧的块有多旧 ——
    // 比标"最新"诚实（快照的价值判断权在读的人，不在写的人）
    const times = (snap.sources || []).map((x) => Date.parse(x.fetchedAt)).filter(Number.isFinite);
    const oldest = times.length ? Math.min(...times) : Date.now();
    // 观察项（一手源里取不到的，如实跟着快照走）：aiPress 用，aiNews 没有
    const skipped = (snap.skipped || []).map((x) => x.name).filter(Boolean);
    const note =
      L('st.aiNewsSnap', { time: fmtStamp(oldest) }) +
      (skipped.length ? ` · ${L('st.pressSkipped', { names: skipped.join(' / ') })}` : '');
    p.status('', 'ok');
    mountBoard(p, {
      rows,
      cols: [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        {
          label: L('col.title'),
          field: 'title',
          cell: (r) => `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a>`,
        },
        { label: L('col.source'), cls: 'col-2', field: 'source', cell: (r) => `<span class="tag">${esc(r.source)}</span>` },
        { label: L('col.date'), cls: 'col-2', field: 'time', cell: (r) => (r.time ? fmtStamp(Date.parse(r.time)) : '—') },
        // 一手博客没有统一的热度口径（官方 RSS 不带浏览/点赞数）—— aiPress 不显示这列，
        // 硬造一个口径反而是编数据
        ...(showScore
          ? [{ label: L('col.hot'), num: true, cls: 'col-2', field: 'score', cell: (r) => compact(r.score) ?? '—' }]
          : []),
      ],
      defaultSort: { index: 3, dir: 'desc' },
      searchFields: ['title', 'source'],
      groupField: 'source',
      groupLabel: L('ui.allSources'),
      placeholder: L('ui.searchNews'),
      transform: withRank,
      note,
      card: {
        title: (r) => esc(r.title),
        value: (r) =>
          showScore
            ? `<span class="v-num">${compact(r.score) ?? '—'}</span> <span class="v-unit">${L('col.hot')}</span>`
            : `<span class="v-num">${r.time ? fmtStamp(Date.parse(r.time)) : '—'}</span>`,
        meta: (r) =>
          `<span class="tag">${esc(r.source)}</span>` +
          (r.time ? `<span class="tag">${fmtStamp(Date.parse(r.time))}</span>` : ''),
        link: (r) => r.url,
      },
    });
  } catch (e) {
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/** 面板：AI 新闻热点（8 个聚合/社区源，带热度口径） */
function loadAiNews() {
  return mountNewsPanel({ id: 'aiNews', iconName: 'file', snapUrl: AI_NEWS_SNAP_URL, cacheKey: 'ai-news' });
}

/** 面板：AI 官方要闻（8 家一手信源，无热度口径但带观察项声明） */
function loadAiPress() {
  return mountNewsPanel({ id: 'aiPress', iconName: 'file', snapUrl: AI_PRESS_SNAP_URL, cacheKey: 'ai-press', showScore: false });
}

/**
 * 中文热榜快照 → 面板行（AI 标记在客户端算，"全部 / 仅 AI"由读者切换）。
 * `allowedKeys`：只保留这些 source_key 的块 —— 13 块单榜面板共用同一份
 * 全量快照，各取各的块，不为每个面板单独抓一份（抓取管道的工程记录
 * 见仓库 scripts/ 与 docs/trend-sources.md §9）。
 */
export function flattenHotList(snap, allowedKeys = null) {
  const allow = Array.isArray(allowedKeys) ? new Set(allowedKeys) : null;
  const out = [];
  for (const s of snap?.sources || []) {
    if (allow && !allow.has(s.key)) continue;
    for (const it of s?.items || []) {
      const title = String(it?.title || '').trim();
      if (!title) continue;
      out.push({
        title,
        url: String(it?.url || ''),
        source: String(s.name || ''),
        // 站方的热度文字（'552 万' / '59回复'）：保留原文，不解析成数字
        extra: String(it?.extra || '').trim(),
        ai: isAiText(title),
      });
    }
  }
  return out;
}

/**
 * 13 个中文热榜的面板成员（用户返修定的形态：**每个榜一个独立面板/路由**）。
 * 顺序 = 首页索引条里的跳转顺序：先技术/科技社区，再全站热搜，最后促销榜。
 * 真值只有这一处：BOARD_IDS / 页面 / 首页索引条 / BOARD_LOADERS 都从它推导，
 * 漏一个会在 site.test.js 的对齐断言里炸出来。
 */
export const HOT_LIST_KEYS = [
  'zhihu', 'csdn', 'juejin', 'itzhijia', 'huxiu', 'aifaner', 'zhongguancun', 'bilibili',
  'weibo', 'toutiao', 'hupu', 'douban', 'zhidemai',
];

/** 每个榜的面板图标（src/site/nav.js 的 BOARD_ICONS 用同一份对应） */
export const HOT_LIST_ICONS = {
  zhihu: 'file',
  csdn: 'code',
  juejin: 'code',
  itzhijia: 'monitor',
  huxiu: 'file',
  aifaner: 'monitor',
  zhongguancun: 'monitor',
  bilibili: 'monitor',
  weibo: 'trending',
  toutiao: 'trending',
  hupu: 'trending',
  douban: 'star',
  zhidemai: 'star',
};

/**
 * 单个热榜面板：同一份全量快照里取这一个 source_key 的块。
 * 13 块面板同形（列 / 搜索 / AI 切换 / 快照声明），共用这一个加载器 ——
 * 与 mountNewsPanel 同一个理由：同形面板抽一个实现，防复制漂移。
 *
 * 快照声明用**该榜块内的站方抓取时刻**（比整份快照的抓取时刻更贴近
 * "这条榜是什么时候的"）。条目链接指向原平台，如实呈现。
 */
async function loadHotList(key, view = 'all') {
  // 头像优先取 `boards.js` 的 `BOARD_ICONS`（骨架阶段用的同一份），
  // 缺了才回落到 `HOT_LIST_ICONS`（13 个中文热榜的历史表）与 `'monitor'`。
  const p = ensurePanel({
    id: key,
    iconName: BOARD_ICONS[key] || HOT_LIST_ICONS[key] || 'monitor',
    title: L(`p.${key}.title`),
    hint: L(`p.${key}.hint`),
  });
  try {
    const snap = await cachedJson(`cn-hot-${key}`, CN_HOT_SNAP_URL);
    const block = (snap?.sources || []).find((x) => x.key === key);
    const all = flattenHotList({ sources: block ? [block] : [] });
    if (!all.length) throw new Error(L('err.noNews'));
    const rows = view === 'ai' ? all.filter((r) => r.ai) : all;
    if (!rows.length) throw new Error(L('err.noNews'));
    const blockTime = Date.parse(block?.fetchedAt || '');
    p.status('', 'ok');
    mountBoard(p, {
      rows,
      cols: [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        {
          label: L('col.title'),
          field: 'title',
          cell: (r) => (r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a>` : esc(r.title)),
        },
        { label: L('col.hot'), field: 'extra', cell: (r) => (r.extra ? `<span class="tag">${esc(r.extra)}</span>` : '—') },
      ],
      defaultSort: null,
      searchFields: ['title'],
      placeholder: L('ui.searchNews'),
      transform: withRank,
      // "仅 AI" 过滤保留：全站一致的过滤能力，成本为零（标记在快照摊平时已算好）；
      // 在娱乐向榜单上命中少，本身就是真实信号，不藏
      beforeControls: () => subBoardChips({ all: 'ui.showAll', ai: 'ui.aiOnly' }, view, 'mmy'),
      note: L('st.hotSnap', { time: fmtStamp(Number.isFinite(blockTime) ? blockTime : Date.now()) }),
      card: {
        title: (r) => esc(r.title),
        value: (r) => `<span class="v-num">${esc(r.extra) || '—'}</span>`,
        meta: () => '',
        link: (r) => r.url || null,
      },
    });
    // 子视图切换（事件委托：mountBoard 重画换 DOM，绑在面板元素上只绑一次）
    wireOnce(p.el, 'mmy', (e) => {
      const b = e.target.closest?.('[data-mmy]');
      if (b) loadHotList(key, b.getAttribute('data-mmy'));
    });
  } catch (e) {
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/* ================================================================== */
/* 面板 9.7：三张 2026-10-16 新增的榜                                    */
/*  · hnTop         —— Hacker News 首页实况（构建期快照）                */
/*  · wikiAttention —— 维基百科 AI 词条的大众关注度（构建期快照）         */
/*  · googleTrends  —— Google 每日搜索趋势，按区域（构建期快照）          */
/*                                                                     */
/* 三张都走**构建期快照**，但理由各不相同（不是"懒得直连"）：             */
/*  · hnTop：hn.algolia.com 的 CORS 实测是**通**的，浏览器能直连。仍然     */
/*    快照，是为了与站内其它社区热度榜统一口径（一次抓取对 Algolia 最友好、 */
/*    标注一致）。要改成直连只需删掉快照、在这里 fetch 同一个 URL。         */
/*  · wikiAttention：wikimedia 要求一个带联系方式的 **User-Agent**，       */
/*    而 `User-Agent` 是浏览器的 forbidden header（fetch 里设不了）——      */
/*    无 UA 实测 403。所以浏览器直连这条路是**死的**，只能构建期抓。        */
/*  · googleTrends：`trends.google.com/trending/rss` 响应里**没有任何         */
/*    `access-control-*` 头**（还有 `cross-origin-resource-policy: same-site`）， */
/*    浏览器直连必被拦。                                                */
/* ================================================================== */

const HN_TOP_SNAP_URL = new URL('./data/hn-top.json', import.meta.url).href;
const WIKI_SNAP_URL = new URL('./data/wiki-attention.json', import.meta.url).href;
const GOOGLE_TRENDS_SNAP_URL = new URL('./data/google-trends.json', import.meta.url).href;

/**
 * HN 快照 → 面板行。
 *
 * ★ 自帖（Ask/Show HN）没有外部链接，`external` 为空 —— 那时行指向 HN 讨论页。
 * 页面上给个标签区分（"讨论"），让读者知道点过去是评论区而不是原文。
 */
export function flattenHnTop(snap) {
  return (snap?.items || [])
    .map((it) => {
      const title = String(it?.title || '').trim();
      if (!title) return null;
      const external = String(it?.external || '').trim();
      const hnUrl = String(it?.hnUrl || '').trim();
      const url = external || hnUrl;
      if (!url) return null;
      const points = it?.points === null || it?.points === undefined ? null : Number(it.points);
      const comments = it?.comments === null || it?.comments === undefined ? null : Number(it.comments);
      return {
        title,
        url,
        external,
        hnUrl,
        points: Number.isFinite(points) ? points : null,
        comments: Number.isFinite(comments) ? comments : null,
        author: String(it?.author || ''),
        time: String(it?.time || ''),
        rank: Number(it?.rank) || 0,
      };
    })
    .filter(Boolean)
    // 按 HN 的首页名次排（快照里已带 rank，不依赖数组顺序）
    .sort((a, b) => a.rank - b.rank);
}

/** 面板：Hacker News 首页实况（构建期快照，一次 30 条） */
async function loadHnTop() {
  const p = ensurePanel(shellMeta('hnTop'));
  try {
    const snap = await cachedJson('hn-top', HN_TOP_SNAP_URL);
    const fetchedAt = Date.parse(snap?.fetchedAt);
    const rows = flattenHnTop(snap);
    if (!rows.length) throw new Error(L('err.noNews'));
    p.status('', 'ok');
    mountBoard(p, {
      rows,
      cols: [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        {
          label: L('col.title'),
          field: 'title',
          cell: (r) => `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a>`,
        },
        { label: L('col.hot'), num: true, field: 'points', cell: (r) => compact(r.points) ?? '—' },
        { label: L('col.comments'), num: true, cls: 'col-2', field: 'comments', cell: (r) => compact(r.comments) ?? '—' },
        {
          label: L('col.source'),
          cls: 'col-2',
          field: 'external',
          // 自帖没有外链 —— 这一列因此不空着，而是明说"讨论"
          cell: (r) => `<span class="tag">${esc(r.external ? L('ui.hnExternal') : L('ui.hnDiscuss'))}</span>`,
        },
      ],
      defaultSort: null, // 默认就是 HN 的首页名次，不另排（那才是"首页实况"）
      searchFields: ['title', 'author'],
      placeholder: L('ui.searchNews'),
      transform: withRank,
      note: L('st.hnSnap', { time: fmtStamp(Number.isFinite(fetchedAt) ? fetchedAt : Date.now()) }),
      card: {
        title: (r) => esc(r.title),
        value: (r) => `<span class="v-num">${compact(r.points) ?? '—'}</span> <span class="v-unit">${L('col.hot')}</span>`,
        meta: (r) =>
          `<span class="tag">${icon('file')}${compact(r.comments) ?? '0'}</span>` +
          (r.author ? `<span class="tag">${esc(r.author)}</span>` : ''),
        link: (r) => r.url,
      },
    });
  } catch (e) {
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/**
 * 维基快照 → 面板行。快照按语种分块（`sources`），每块一个语种。
 * 条目里的 `views` / `trend` 是抓取器算好的（见 `scripts/fetch-wiki-attention.mjs`）。
 */
export function flattenWikiAttention(snap) {
  const out = [];
  for (const s of snap?.sources || []) {
    for (const it of s?.items || []) {
      const title = String(it?.title || '').trim();
      if (!title) continue;
      const views = Number(it?.views);
      const trend = it?.trend === null || it?.trend === undefined ? null : Number(it.trend);
      out.push({
        project: String(s.key || ''),
        projectName: String(s.name || ''),
        article: title,
        // 展示用标题：下划线换空格、去掉消歧义后缀（'Claude_(语言模型)' → 'Claude'）
        label: String(title).replaceAll('_', ' ').replace(/\s*\([^)]*\)\s*$/, '').trim(),
        url: String(it?.url || ''),
        views: Number.isFinite(views) ? views : null,
        trend: Number.isFinite(trend) ? trend : null,
        date: String(s.fetchedAt || ''),
      });
    }
  }
  // 浏览量降序（跨语种混排时，英文榜的量级远大于小语种 —— 那是真实的，
  // 读者可以按"语种"分组收窄）
  return out.sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
}

/** 面板：维基百科 AI 词条关注度（按语种分组） */
async function loadWikiAttention() {
  const p = ensurePanel(shellMeta('wikiAttention'));
  try {
    const snap = await cachedJson('wiki-attention', WIKI_SNAP_URL);
    const rows = flattenWikiAttention(snap);
    if (!rows.length) throw new Error(L('err.noRows'));
    const dates = Array.isArray(snap?.dates) ? snap.dates : [];
    // 各语种的数据日期可能不同（某个语种昨天没数据就退了一天）—— 如实列出全部
    const skipped = (snap?.skipped || []).map((x) => x.project).filter(Boolean);
    p.status('', 'ok');
    mountBoard(p, {
      rows,
      cols: [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        {
          label: L('col.title'),
          field: 'label',
          cell: (r) => (r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.label)}</a>` : esc(r.label)),
        },
        { label: L('col.lang'), cls: 'col-2', field: 'projectName', cell: (r) => `<span class="tag">${esc(r.projectName)}</span>` },
        { label: L('col.views'), num: true, field: 'views', cell: (r) => compact(r.views) ?? '—' },
        {
          label: L('col.wikiTrend'),
          num: true,
          cls: 'col-2',
          field: 'trend',
          // 没有走势就显示 '—'（不拿 1.0 冒充"持平"：那是编出来的）
          cell: (r) => (r.trend === null ? '—' : `${r.trend >= 1 ? '↑' : '↓'}${num(Math.abs(r.trend - 1) * 100, 0)}%`),
        },
      ],
      defaultSort: { index: 3, dir: 'desc' },
      searchFields: ['label', 'article', 'projectName'],
      groupField: 'projectName',
      groupLabel: L('ui.allLangs'),
      placeholder: L('ui.searchNews'),
      transform: withRank,
      note:
        L('st.wikiSnap', { time: dates.join(' / ') || '—' }) +
        (skipped.length ? ` · ${L('st.pressSkipped', { names: skipped.join(' / ') })}` : ''),
      card: {
        title: (r) => esc(r.label),
        value: (r) => `<span class="v-num">${compact(r.views) ?? '—'}</span> <span class="v-unit">${L('col.views')}</span>`,
        meta: (r) => `<span class="tag">${esc(r.projectName)}</span>${r.trend === null ? '' : `<span class="tag">${r.trend >= 1 ? '↑' : '↓'}${num(Math.abs(r.trend - 1) * 100, 0)}%</span>`}`,
        link: (r) => r.url,
      },
    });
  } catch (e) {
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/**
 * Google 趋势快照 → 面板行（**只取当前选中的区域**）。
 *
 * 与中文热榜那 13 个面板同一种模式：同一份快照、各取各的块，
 * 不为每个区域单独抓一份。区别是这里把"选哪个区域"做成了**子视图切换片**
 * （13 个热榜是各自独立的面板，因为它们各自是一个"榜"；而这是同一个榜的
 * 十个区域视图，读者通常只关心自己所在的那个）。
 */
export function flattenGoogleTrends(snap, region) {
  const block = (snap?.sources || []).find((s) => s.key === region);
  if (!block) return [];
  return (block.items || [])
    .map((it, i) => {
      const title = String(it?.title || '').trim();
      if (!title) return null;
      return {
        title,
        url: String(it?.url || ''),
        // 上游只给 '2000+' / '100K+' 这种粗粒度文字 —— 保留原文，不解析成数字
        traffic: String(it?.extra || ''),
        newsTitle: String(it?.newsTitle || ''),
        newsUrl: String(it?.newsUrl || ''),
        newsSource: String(it?.newsSource || ''),
        region,
        rank: i + 1,
      };
    })
    .filter(Boolean);
}

/** 面板：Google 每日搜索趋势（按区域切换） */
async function loadGoogleTrends(region = 'US') {
  const p = ensurePanel(shellMeta('googleTrends'));
  try {
    const snap = await cachedJson('google-trends', GOOGLE_TRENDS_SNAP_URL);
    const rows = flattenGoogleTrends(snap, region);
    if (!rows.length) throw new Error(L('err.noRows'));
    const fetchedAt = Date.parse(snap?.fetchedAt);
    const skipped = (snap?.skipped || []).map((x) => x.region).filter(Boolean);
    // 区域切换片：顺序沿用快照里 sources 的顺序（抓取脚本 REGIONS 的顺序）
    const views = Object.fromEntries((snap?.sources || []).map((s) => [s.key, s.name]));
    p.status('', 'ok');
    mountBoard(p, {
      rows,
      cols: [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        {
          label: L('col.keyword'),
          field: 'title',
          // 没有条目级原文地址 —— 落点是"在 Google 上搜这个词"，那正是读者要做的
          cell: (r) => (r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a>` : esc(r.title)),
        },
        { label: L('col.hot'), field: 'traffic', cell: (r) => (r.traffic ? `<span class="tag">${esc(r.traffic)}</span>` : '—') },
        {
          label: L('col.news'),
          cls: 'col-2',
          field: 'newsTitle',
          cell: (r) => (r.newsUrl ? `<a href="${esc(r.newsUrl)}" target="_blank" rel="noopener noreferrer">${esc(r.newsTitle || r.newsSource)}</a>` : '—'),
        },
      ],
      defaultSort: null, // 默认就是 Google 的名次（热度本来也只有粗粒度，排序没意义）
      searchFields: ['title', 'newsTitle', 'newsSource'],
      placeholder: L('ui.searchNews'),
      transform: withRank,
      beforeControls: () =>
        subBoardChips(views, region, 'geo') +
        // ★ 说明中国大陆没有这个区域 —— 读者找不到 CN 时该有个答案，
        //   而不是以为我们漏了（端点上 geo=CN 实测 400）
        `<p class="chips-note">${L('ui.geoNote')}</p>`,
      note:
        L('st.googleSnap', { time: fmtStamp(Number.isFinite(fetchedAt) ? fetchedAt : Date.now()) }) +
        (skipped.length ? ` · ${L('st.pressSkipped', { names: skipped.join(' / ') })}` : ''),
      card: {
        title: (r) => esc(r.title),
        value: (r) => `<span class="v-num">${esc(r.traffic) || '—'}</span>`,
        meta: (r) => (r.newsSource ? `<span class="tag">${esc(r.newsSource)}</span>` : ''),
        link: (r) => r.url,
      },
    });
    wireOnce(p.el, 'geo', (e) => {
      const b = e.target.closest?.('[data-geo]');
      if (b) loadGoogleTrends(b.getAttribute('data-geo'));
    });
  } catch (e) {
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/* ================================================================== */
/* 面板 10：最新发布的模型（models.dev，体积大 → 点击才加载）             */
/* ================================================================== */

const MODELS_DEV_URL = 'https://models.dev/api.json';

/**
 * 把 models.dev 的 `provider → models` 嵌套结构摊平成模型数组。
 *
 * 为什么这个源值得单独处理：它是**唯一**带 `release_date` 的源，
 * 所以能做"最新发布"这种别处拿不到的榜。代价是体积 4.8MB，
 * 所以做成点击加载而不是进页面就拉。
 */
export function flattenModelsDev(json) {
  const out = [];
  for (const [pid, prov] of Object.entries(json || {})) {
    for (const [mid, m] of Object.entries(prov?.models || {})) {
      if (!m || !m.id) continue;
      out.push({
        id: m.id,
        name: String(m.name || m.id),
        provider: String(prov.name || pid),
        release: String(m.release_date || ''),
        context: Number(m.limit?.context) || null,
        costIn: Number(m.cost?.input ?? NaN),
        costOut: Number(m.cost?.output ?? NaN),
        reasoning: Boolean(m.reasoning),
        openWeights: Boolean(m.open_weights),
      });
    }
  }
  // 按发布日期降序；没有日期的排在最后（而不是被当成 1970 年排到开头）
  return out.sort((a, b) => {
    if (!a.release && !b.release) return a.name.localeCompare(b.name);
    if (!a.release) return 1;
    if (!b.release) return -1;
    return b.release.localeCompare(a.release);
  });
}

/** 价格格式化：$/百万 token，两位有效数字就够，不堆小数 */
export function fmtCost(v) {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return L('ui.free');
  return `$${v < 1 ? v.toFixed(2) : v.toFixed(1)}`;
}

async function loadNewModels() {
  const p = ensurePanel(shellMeta('newmodels'));
  // ★ 进页面就拉（4.8MB）—— 与 SWE-bench 同理：这一页只有这一张榜，
  // 多一次点击只是多一步。
  p.status(L('st.loadingBig', { size: '4.8MB' }), 'loading');
  p.body(skeleton(6));
  {
    try {
      const json = await cachedJson('models-dev', MODELS_DEV_URL);
      const rows = flattenModelsDev(json);
      if (!rows.length) throw new Error(L('err.noModels'));
      // 只显示带发布日期的（"最新发布"这个榜的意义所在）
      const dated = rows.filter((r) => r.release);
      p.status('', 'ok');
      mountBoard(p, {
        rows: dated,
        cols: [
          { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
          { label: L('col.model'), field: 'name', cell: (r) => esc(r.name) },
          { label: L('col.provider'), cls: 'col-2', field: 'provider', cell: (r) => `<span class="tag">${esc(r.provider)}</span>` },
          { label: L('col.release'), field: 'release', cell: (r) => esc(r.release) },
          { label: L('col.context'), num: true, cls: 'col-2', field: 'context', cell: (r) => compact(r.context) ?? '—' },
          // 价格排序要把"没价格"的排最后：applyBoardState 已经这么做了（空值恒最后）
          { label: L('col.priceIn'), num: true, cls: 'col-2', field: 'costIn', cell: (r) => fmtCost(r.costIn) },
          { label: L('col.priceOut'), num: true, cls: 'col-2', field: 'costOut', cell: (r) => fmtCost(r.costOut) },
        ],
        defaultSort: { index: 3, dir: 'desc' },
        limit: 40,
        searchFields: ['name', 'provider'],
        groupField: 'provider',
        groupLabel: L('ui.allProviders'),
        placeholder: L('ui.searchModelsProviders'),
        transform: withRank,
        note: L('st.dated', { total: rows.length, dated: dated.length }),
        card: {
          title: (r) => esc(r.name),
          value: (r) => `<span class="v-num">${esc(r.release)}</span> <span class="v-unit">${L('col.release')}</span>`,
          meta: (r) =>
            `<span class="tag">${esc(r.provider)}</span>` +
            `<span class="tag">${compact(r.context) ?? '—'} ${L('col.context')}</span>` +
            `<span class="tag">${L('col.priceIn')} ${fmtCost(r.costIn)}</span>`,
        },
      });
    } catch (e) {
      p.status(L('st.failed', { msg: e.message }) + L('st.retryRefresh'), 'err');
      p.body('');
    }
  }
}

/* ================================================================== */
/* 面板 11：SWE-bench（真实代码修复能力）                                */
/* ================================================================== */

/**
 * 数据在 `swe-bench.github.io` 仓库的 `data/leaderboards.json`（经 raw.githubusercontent，
 * CORS `*`）。这个文件 **4MB**，而且它把每个提交的**逐题明细**都塞在同一个文件里
 * （`resolved_instances` / `costs_to_complete` 等长数组）—— 我们只用到汇总字段。
 * 所以处理方式与 models.dev 一样：**点击才加载**，并且只取需要的字段。
 *
 * ★ 量纲坑（已实测确认）：`resolved` 是**已经在 0–100 的百分数**（Verified 子榜最大 79.2，
 * 若按 0–1 比例解释则不可能超过 1）。所以展示时**直接用，不要再 ×100**。
 * 这个坑有测试盯着：见 trend.test.js 的「SWE-bench 的 resolved 不乘 100」。
 */

const SWE_BENCH_URL =
  'https://raw.githubusercontent.com/swe-bench/swe-bench.github.io/master/data/leaderboards.json';

/** 想要哪个子榜（4MB 里只有 5 个，取名字最直白的那个） */
export const DEFAULT_SWE_BOARD = 'Verified';

/**
 * 从一个子榜里取出排在前面的一批。
 *
 * 去重规则：同一个模型可能**多次提交**（不同日期/不同 agent），榜单站的原始列表是按
 * 提交时间排的，会出现同一个模型占好几行。这里按"模型名"取**最高分**那一次，
 * 因为读者要看的是"这个模型能做到多少"，不是"谁什么时候又交了一次"。
 */
/** 数据里实际有哪些子榜（用于界面上的切换项，顺序按数据本身） */
export function sweBoardNames(boards) {
  return (boards || []).map((b) => String(b?.name || '')).filter(Boolean);
}

export function rankSweBench(boards, boardName = DEFAULT_SWE_BOARD) {
  const board = (boards || []).find((b) => b?.name === boardName) || (boards || [])[0];
  if (!board || !Array.isArray(board.results)) return [];
  const best = new Map();
  for (const r of board.results) {
    // ★ 必须先挡掉 null/undefined/空串再 Number()：
    // `Number(null)` 是 0 且 `Number.isFinite(0)` 为真 —— 直接用 Number 判断会把
    // "没有成绩"的条目当成 **0 分**混进榜里（实测官方数据里确实有 resolved:null 的条目）。
    const raw = r?.resolved;
    if (raw === null || raw === undefined || raw === '') continue;
    const score = Number(raw);
    if (!Number.isFinite(score)) continue; // 非数字同样丢，不参与排名
    const model = String(r.model_display || r.agent || '').trim();
    if (!model) continue;
    const row = {
      model,
      // resolved 已是百分数（0–100），**不做任何换算**
      score,
      date: String(r.date || '').slice(0, 10),
      // 同一个坑：Number(null) === 0，所以要先挡 null/空串
      cost: r.cost === null || r.cost === undefined || r.cost === '' ? null : Number(r.cost),
      org: String(r.model_org || r.agent_org || '').trim(),
    };
    const prev = best.get(model);
    if (!prev || row.score > prev.score) best.set(model, row);
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

async function loadSweBench(boardName = DEFAULT_SWE_BOARD) {
  const p = ensurePanel(shellMeta('swebench'));

  // ★ 进页面就拉（4MB）。曾经是"点击才加载"，但那个按钮是**多余的仪式** ——
  // 这一页只有这一张榜，读者既然点进来了就是要看它，多一次点击只是多一步。
  // 代价是首屏要等 4MB（约 1–2 秒），所以状态行明说在拉什么、多大。

  // 已加载：给子榜切换（5 个子榜）并渲染
  const render = (boards, current) => {
    const names = sweBoardNames(boards);
    const chips = names
      .map((n) => `<button class="chip${n === current ? ' on' : ''}" data-board="${esc(n)}" type="button">${esc(n)}</button>`)
      .join('');
    const rows = rankSweBench(boards, current);
    p.status('', 'ok');
    mountBoard(p, {
      rows,
      cols: [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        { label: L('col.model'), field: 'model', cell: (r) => esc(r.model) },
        { label: L('col.org'), cls: 'col-2', field: 'org', cell: (r) => (r.org ? `<span class="tag">${esc(r.org)}</span>` : '') },
        // resolved 已是 0–100 的百分数，**不乘 100**
        { label: L('col.score'), num: true, field: 'score', cell: (r) => `${bar(r.score, rows[0].score)}${num(r.score, 1)}%` },
        { label: L('col.cost'), num: true, cls: 'col-2', field: 'cost', cell: (r) => (Number.isFinite(r.cost) ? `$${num(r.cost, 0)}` : '—') },
        { label: L('col.submitted'), cls: 'col-2', field: 'date', cell: (r) => esc(r.date || '—') },
      ],
      defaultSort: { index: 3, dir: 'desc' },
      limit: 40,
      searchFields: ['model', 'org'],
      groupField: 'org',
      groupLabel: L('ui.allOrgs'),
      placeholder: L('ui.searchModelsOrgs'),
      transform: withRank,
      beforeControls: () => `<div class="chips" data-boards>${chips}</div>`,
      note: L('st.board', { name: current }),
      card: {
        title: (r) => esc(r.model),
        value: (r) => `<span class="v-num">${num(r.score, 1)}%</span> <span class="v-unit">${L('col.score')}</span>`,
        meta: (r) =>
          (r.org ? `<span class="tag">${esc(r.org)}</span>` : '') +
          (r.date ? `<span class="tag">${esc(r.date)}</span>` : '') +
          (Number.isFinite(r.cost) ? `<span class="tag">$${num(r.cost, 0)}</span>` : ''),
      },
    });
    // 事件委托：重画会换掉 DOM，挂面板上只绑一次
    wireOnce(p.el, 'subboard', (e) => {
      const btn = e.target.closest?.('[data-board]');
      if (btn) render(boards, btn.getAttribute('data-board'));
    });
  };

  const run = async (which) => {
    p.status(L('st.loadingBig', { size: '4MB' }), 'loading');
    p.body(skeleton(6));
    try {
      const json = await cachedJson('swe-bench', SWE_BENCH_URL);
      const boards = json?.leaderboards;
      if (!Array.isArray(boards)) throw new Error(L('err.noBoards'));
      if (!rankSweBench(boards, which).length) throw new Error(L('err.noBoardRows', { name: which }));
      render(boards, which);
    } catch (e) {
      // 没有"重试按钮"了：重试的路是页面底部的「刷新数据」（它清缓存后重画）
      p.status(L('st.failed', { msg: e.message }) + L('st.retryRefresh'), 'err');
      p.body('');
    }
  };

  run(boardName);
}

/* ================================================================== */
/* 面板：OpenRouter 模型用量榜                                          */
/* ================================================================== */

const OPENROUTER_RANKINGS_URL = 'https://openrouter.ai/api/frontend/v1/rankings/models';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

/**
 * OpenRouter 的用量榜 —— **数据形状与口径**（2026-09-30 实测，见 docs/trend-sources.md）
 *
 * 接口给的是**按天的原始用量**：`{data: [{date, model_permaslug, variant,
 * total_prompt_tokens, total_completion_tokens, count, ...}]}`，
 * 7 天窗口、约 600 行。字段含义（不猜，都是实测确认的）：
 *
 *   · `model_permaslug` 才是**模型身份**；同一模型的 `standard` / `batch` / `free`
 *     是**三行**，把它们当三个模型排是错的（榜单上会出现 "(batch)" 这种条目）。
 *     所以下面按 model_permaslug 合并 —— 合并后也就自然没有了名字带 "(batch)" 的问题。
 *   · `rankingMetricValue` 恰好等于 `total_prompt_tokens + total_completion_tokens`
 *     （602/602 行相等，实测）。口径就是**按天 token 用量**，不是"请求数"、
 *     也不是 OpenRouter 榜单页那个"share"百分比。
 *   · 接口**不带模型显示名**，名字要另外取（见 openrouterNames）。
 *
 * 取最新一天的快照：`date` 是日粒度，同一天出现多次才是"一天内的多个样本"，
 * 目前每个模型每天恰好一行，所以"同一天取最大"是安全的。
 */
export function openrouterBoard(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) throw new Error(L('err.noBoard'));

  const latest = list.reduce((m, r) => (String(r.date) > m ? String(r.date) : m), '');
  const byModel = new Map();
  for (const r of list) {
    if (String(r.date) !== latest) continue; // 只要最新一天
    const key = String(r.model_permaslug || r.variant_permaslug || '').trim();
    if (!key) continue; // 实测有 1 行空 slug（不是模型，是"未归属"的合计）
    const tokens = Number(r.rankingMetricValue ?? 0) || 0;
    const reqs = Number(r.count ?? 0) || 0;
    const cur = byModel.get(key) || { key, tokens: 0, requests: 0 };
    // 同一模型的多个变体（standard/batch/free）在这里相加 —— 合并的正是那三行
    cur.tokens += tokens;
    cur.requests += reqs;
    byModel.set(key, cur);
  }

  const out = [...byModel.values()];
  if (!out.length) throw new Error(L('err.noBoard'));
  const sum = out.reduce((a, r) => a + r.tokens, 0) || 1;
  for (const r of out) r.share = (r.tokens / sum) * 100;
  // 降序：榜的第一屏就该是最高的那些
  out.sort((a, b) => b.tokens - a.tokens || a.key.localeCompare(b.key));
  return { rows: out, date: latest, total: sum };
}

/**
 * 用量行的名字 —— 与 `/api/v1/models` 的连接。
 *
 * 为什么不直接显示 slug：榜上出现 `typesafe/jev-1.13-20260917` 这种事很常见，
 * 而清单里给的是 `Typesafe: Jev 1.13`。
 *
 * 匹配三级（实测覆盖率见 docs/trend-sources.md）：
 *   1. `id` 精确相等；
 *   2. `canonical_slug` 精确相等；
 *   3. 把用量行的日期后缀（`-20260910`）去掉后与 canonical_slug 去后缀相等。
 *
 * **返回 null 就是真的没有**，调用方回落到 slug —— 不编一个名字出来。
 * 清单只有 464 个模型（OpenRouter 的对话模型目录），而用量里含音频/视频/
 * embedding 等**不在该目录里**的模型，所以必然有一小部分解析不到。
 */
export function openrouterNames(models) {
  const byId = new Map();
  const byCanon = new Map();
  for (const m of Array.isArray(models) ? models : []) {
    if (!m?.id) continue;
    byId.set(String(m.id), m);
    if (m.canonical_slug) byCanon.set(String(m.canonical_slug), m);
  }
  const stripDate = (s) => String(s).replace(/-\d{8}$/, '');
  const cache = new Map();
  return (slug) => {
    if (cache.has(slug)) return cache.get(slug);
    const name =
      byId.get(slug)?.name ??
      byCanon.get(slug)?.name ??
      // 去日期后缀再匹配一次；`(batch)` 那条不优先取，优先要基座名
      (() => {
        const want = stripDate(slug);
        let hit = null;
        for (const [k, m] of byCanon) {
          if (stripDate(k) === want) {
            if (!/\(batch\)/i.test(m.name)) return m.name;
            hit = hit || m.name;
          }
        }
        return hit;
      })() ??
      null;
    cache.set(slug, name);
    return name;
  };
}

/** 用量行的显示名：优先清单里的名字，取不到就回落成 slug 的主人/模型两段 */
export function openrouterLabel(slug, nameOf) {
  const name = nameOf?.(slug);
  if (name) return name;
  // 回落：`vendor/model-20260910` → 去掉厂商前缀与日期，剩下的当名字
  const tail = String(slug).split('/').slice(1).join('/') || String(slug);
  return tail.replace(/-\d{8}$/, '');
}

async function loadOpenRouter() {
  const p = ensurePanel(shellMeta('openrouter'));
  p.status(L('st.loadingBig', { size: '420KB + 760KB' }), 'loading');
  try {
    // 两份数据：用量榜（主数据）+ 模型清单（只为了名字）
    const [rankings, models] = await Promise.all([
      cachedJson('openrouter-rankings', OPENROUTER_RANKINGS_URL),
      cachedJson('openrouter-models', OPENROUTER_MODELS_URL),
    ]);
    const nameOf = openrouterNames(models?.data);
    const { rows, date, total } = openrouterBoard(rankings?.data);
    const day = date.slice(0, 10); // '2026-09-29 00:00:00' → '2026-09-29'

    const withNames = rows.map((r) => ({
      ...r,
      label: openrouterLabel(r.key, nameOf),
      named: Boolean(nameOf(r.key)),
    }));

    p.status('', 'ok');
    mountBoard(p, {
      rows: withNames,
      // 数据每天更新，说明里带上日期与总量：读者要能判断"这是哪一天的榜"
      note: L('st.orWindow', { date: day, n: rows.length }),
      cols: [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        {
          label: L('col.model'),
          field: 'label',
          cell: (r) =>
            // 点名字去 OpenRouter 上的模型页；取不到名字的那几个用 slug 当链接文字
            `<a href="https://openrouter.ai/${encodeURI(r.key)}" target="_blank" rel="noopener noreferrer">${esc(r.label)}</a>`,
        },
        {
          label: L('col.orTokens'),
          num: true,
          field: 'tokens',
          cell: (r) => `${bar(r.tokens, withNames[0]?.tokens)}${compact(r.tokens) ?? '—'}`,
        },
        {
          label: L('col.orShare'),
          num: true,
          cls: 'col-2',
          field: 'share',
          cell: (r) => `${num(r.share, 1)}%`,
        },
        {
          label: L('col.orRequests'),
          num: true,
          cls: 'col-2',
          field: 'requests',
          cell: (r) => compact(r.requests) ?? '—',
        },
      ],
      defaultSort: { index: 2, dir: 'desc' },
      searchFields: ['label', 'key'],
      placeholder: L('ui.searchModels'),
      transform: withRank,
      card: {
        title: (r) => esc(r.label),
        value: (r) =>
          `<span class="v-num">${num(r.share, 1)}%</span> <span class="v-unit">${L('col.orShare')}</span>`,
        meta: (r) =>
          `<span class="tag">${compact(r.tokens) ?? '—'} tokens</span>` +
          `<span class="tag">${compact(r.requests) ?? '—'} ${L('col.orRequests')}</span>` +
          // 取不到清单名字的标一个 slug 标签：既不藏起来，也不假称它有名字
          (r.named ? '' : `<span class="tag">${L('ui.orSlugOnly')}</span>`),
        link: (r) => `https://openrouter.ai/${encodeURI(r.key)}`,
      },
    });
    // 总量放在面板状态行里：它是"这是全站的盘"这个事实的一半
    p.status(L('st.orTotal', { total: compact(total) ?? '—', date: day }), 'ok');
  } catch (e) {
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/* ================================================================== */
/* 面板：OpenRouter 的四张榜（上升 / 机构 / 性能 / 应用）              */
/* ================================================================== */

const OR_API = 'https://openrouter.ai/api/frontend/v1';

/**
 * `climbing` / `breakouts` 的 `changePercent` **单位不一样**（实测，必须分开处理）
 *
 * 同一个响应里：`climbing` 给的是**百分数**（359.85 = +359.85%），
 * `breakouts` 给的是**比率**（3.57 = +357%）。看着数值差不多，乘 100 之后就差
 * 两个数量级 —— 混在一起排，突破榜会整条被排到上升榜末尾，而页面上不会报错，
 * 只会看起来"突破榜怎么都这么小"。
 *
 * 所以每个子榜自带单位标记：`kind` 只有 `climbing` 是百分数，其余按比率算。
 * 需要证据时看两榜的分布：climbing 几十~几百、breakouts 0.0x~3.5，量级分得很开。
 */
export function growthPct(v, kind) {
  // ★ 先挡空值再 Number()：`Number(null)` 与 `Number('')` 都是 **0**（有限数），
  // 直接转会把"上游没给增幅"变成"增幅 0%"，于是这种行会混进榜里假装有数据。
  // 合法结果是 0（真的没涨），但那是**上游给了 0**，不是"没给"。
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return kind === 'climbing' ? n : n * 100;
}

/** 上升榜的行：climbing / breakouts 共用，唯一的差别就是 changePercent 的单位 */
export function rankClimbing(list, kind) {
  const rows = (Array.isArray(list) ? list : [])
    .map((r) => ({
      slug: String(r.variantPermaslug || ''),
      tokens: Number(r.weeklyTokens) || 0,
      prev: Number(r.prevWeeklyTokens) || 0,
      // 单位换算在这里一次性做掉，下游只管 %（见 growthPct 的说明）
      growth: growthPct(r.changePercent, kind),
    }))
    .filter((r) => r.slug && r.growth !== null && r.tokens > 0);
  // 按增幅降序 —— 上游给的这个数组**不是**按增幅排的（实测 breakouts 是乱的）
  rows.sort((a, b) => b.growth - a.growth || b.tokens - a.tokens);
  return rows;
}

/**
 * 厂商（机构）份额。
 * `share` 上游给的是 0~1 的比例（0.2272 = 22.7%），`changePercent` 是**比率**
 * （0.0289 = +2.9%，注意不是 289%）—— 与 climbing 的单位又不同，实测确认。
 */
export function rankAuthors(list) {
  return (Array.isArray(list) ? list : [])
    .map((a) => ({
      author: String(a.author || ''),
      tokens: Number(a.weeklyTokens) || 0,
      share: Number(a.share) * 100,
      growth: Number(a.changePercent) * 100,
    }))
    .filter((a) => a.author)
    .sort((a, b) => b.tokens - a.tokens);
}

/** 性能榜：延迟与吞吐两个视角，各自按"越小/越大越好"降序 */
export function rankPerformance(list, view) {
  const rows = (Array.isArray(list) ? list : [])
    .map((r) => ({
      slug: String(r.slug || r.id || ''),
      name: String(r.name || ''),
      author: String(r.author || ''),
      requests: Number(r.request_count) || 0,
      latency: Number.isFinite(r.p50_latency) ? Number(r.p50_latency) : null,
      throughput: Number.isFinite(r.p50_throughput) ? Number(r.p50_throughput) : null,
      provider: view === 'throughput' ? r.best_throughput_provider : r.best_latency_provider,
      price: view === 'throughput' ? r.best_throughput_price : r.best_latency_price,
      providers: Number(r.provider_count) || 0,
    }))
    .filter((r) => r.slug);
  // 延迟：快在前（升序）；吞吐：快在前（降序）。缺值的行丢给调用方按"空值最后"处理
  if (view === 'throughput') rows.sort((a, b) => (b.throughput ?? -1) - (a.throughput ?? -1));
  else rows.sort((a, b) => (a.latency ?? Infinity) - (b.latency ?? Infinity));
  return rows;
}

/**
 * Artificial Analysis 的评测分（三张子榜：intelligence / coding / agentic）。
 *
 * ★ 用 `score` 排，**不用** `percentilesBySlug` —— 后者是"百分位"，看着像分
 * 但语义完全不同（同一个模型在两处的数不一样），混用会得到一个说不清是什么的榜。
 */
export function rankAa(list) {
  return (Array.isArray(list) ? list : [])
    .map((r) => ({
      slug: String(r.permaslug || r.uid || ''),
      // aa_name 是 Artificial Analysis 那边的完整名（带括号后缀），太啰嗦；
      // heuristic_openrouter_slug 是它猜的 OpenRouter 标识，优先用它做显示名
      name: String(r.aa_name || r.heuristic_openrouter_slug || r.permaslug || ''),
      score: Number(r.score),
    }))
    .filter((r) => r.slug && Number.isFinite(r.score))
    .sort((a, b) => b.score - a.score);
}

/** 应用榜：day / week 两个窗口，按 token 用量排序 */
export function rankApps(list) {
  return (Array.isArray(list) ? list : [])
    .map((r) => ({
      title: String(r.app?.title || ''),
      slug: String(r.app?.slug || ''),
      url: r.app?.origin_url || r.app?.main_url || '',
      source: r.app?.source_code_url || '',
      categories: Array.isArray(r.app?.categories) ? r.app.categories.join(' · ') : '',
      tokens: Number(r.total_tokens) || 0,
      requests: Number(r.total_requests) || 0,
    }))
    .filter((r) => r.title)
    .sort((a, b) => b.tokens - a.tokens);
}

/**
 * 多模态用量榜：图像 / 视频 / 语音三个端点。
 *
 * ★ 形状**不完全一样**（实测确认）：三个都是 `{x, ys}` 的时间序列，
 * 但 `video-output-hours` 与 `stt-transcript-characters` **多套一层** ——
 * 是 `{data:{data:[…]}}` 而不是 `{data:[…]}`。按同一种形状解析的话，
 * 后两个只会得到一行（把 `data` 当成模型映射，取到 `cachedAt` 这种键），
 * 页面上表现为"只有一个模型的榜"，不报错。
 *
 * 取**最后一个点**作为当前值；`Others` 是上游的合计桶（不是模型），排除。
 */
export function flattenMedia(json, { exclude = ['Others'] } = {}) {
  const series = Array.isArray(json?.data) ? json.data : json?.data?.data;
  const last = Array.isArray(series) && series.length ? series[series.length - 1] : null;
  const rows = [];
  for (const [slug, v] of Object.entries(last?.ys || {})) {
    if (!slug || exclude.includes(slug)) continue;
    const value = Number(v) || 0;
    if (value > 0) rows.push({ slug, value, at: String(last.x || '') });
  }
  return rows.sort((a, b) => b.value - a.value);
}

/** 取名字的小工具：OpenRouter 的四张榜都要显示名，走同一个连接 */
function orNameOf(models) {
  return openrouterNames(models?.data);
}

/** 子榜切换片（与 GitHub 时间段的写法一致：按钮 + 事件委托） */
function subBoardChips(views, current, attr) {
  return (
    `<div class="chips" data-chips>` +
    Object.entries(views)
      .map(
        ([k, v]) =>
          `<button class="chip${k === current ? ' on' : ''}" data-${attr}="${k}" type="button">${esc(L(v))}</button>`
      )
      .join('') +
    '</div>'
  );
}

/** 面板：OpenRouter 上升榜（climbing / breakouts 两个子榜） */
async function loadOrTrends(view = 'climbing') {
  const p = ensurePanel(shellMeta('orTrends'));
  try {
    const [disc, models] = await Promise.all([
      cachedJson('or-discovery', `${OR_API}/rankings/discovery`),
      cachedJson('openrouter-models', OPENROUTER_MODELS_URL),
    ]);
    const nameOf = orNameOf(models);
    const rows = rankClimbing(disc?.data?.[view], view).map((r) => ({
      ...r,
      label: openrouterLabel(r.slug, nameOf),
      named: Boolean(nameOf(r.slug)),
    }));
    if (!rows.length) throw new Error(L('err.noBoard'));
    p.status('', 'ok');
    mountBoard(p, {
      rows,
      cols: [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        {
          label: L('col.model'),
          field: 'label',
          cell: (r) => `<a href="https://openrouter.ai/${encodeURI(r.slug)}" target="_blank" rel="noopener noreferrer">${esc(r.label)}</a>`,
        },
        {
          label: L('col.orGrowth'),
          num: true,
          field: 'growth',
          cell: (r) => `<span class="v-num">+${num(r.growth, r.growth >= 10 ? 0 : 1)}%</span>`,
        },
        { label: L('col.orWeekTokens'), num: true, cls: 'col-2', field: 'tokens', cell: (r) => compact(r.tokens) ?? '—' },
        { label: L('col.orPrevWeek'), num: true, cls: 'col-2', field: 'prev', cell: (r) => compact(r.prev) ?? '—' },
      ],
      defaultSort: { index: 2, dir: 'desc' },
      searchFields: ['label', 'slug'],
      placeholder: L('ui.searchModels'),
      transform: withRank,
      beforeControls: () => subBoardChips({ climbing: 'p.orTrends.climbing', breakouts: 'p.orTrends.breakouts' }, view, 'trend'),
      card: {
        title: (r) => esc(r.label),
        value: (r) => `<span class="v-num">+${num(r.growth, r.growth >= 10 ? 0 : 1)}%</span> <span class="v-unit">${L('col.orGrowth')}</span>`,
        meta: (r) => `<span class="tag">${compact(r.tokens) ?? '—'} ${L('col.orWeekTokens')}</span>`,
        link: (r) => `https://openrouter.ai/${encodeURI(r.slug)}`,
      },
    });
    wireOnce(p.el, 'trend', (e) => {
      const b = e.target.closest?.('[data-trend]');
      if (b) loadOrTrends(b.getAttribute('data-trend'));
    });
  } catch (e) {
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/** 面板：OpenRouter 机构份额 */
async function loadOrAuthors() {
  const p = ensurePanel(shellMeta('orAuthors'));
  try {
    const disc = await cachedJson('or-discovery', `${OR_API}/rankings/discovery`);
    const rows = rankAuthors(disc?.data?.authors);
    if (!rows.length) throw new Error(L('err.noBoard'));
    p.status('', 'ok');
    mountBoard(p, {
      rows,
      cols: [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        { label: L('col.org'), field: 'author', cell: (r) => esc(r.author) },
        { label: L('col.orShare'), num: true, field: 'share', cell: (r) => `${num(r.share, 1)}%` },
        { label: L('col.orWeekTokens'), num: true, field: 'tokens', cell: (r) => compact(r.tokens) ?? '—' },
        {
          label: L('col.orGrowth'),
          num: true,
          cls: 'col-2',
          field: 'growth',
          cell: (r) => (r.growth === null ? '—' : `${r.growth > 0 ? '+' : ''}${num(r.growth, 1)}%`),
        },
      ],
      defaultSort: { index: 2, dir: 'desc' },
      searchFields: ['author'],
      placeholder: L('ui.search'),
      transform: withRank,
      card: {
        title: (r) => esc(r.author),
        value: (r) => `<span class="v-num">${num(r.share, 1)}%</span> <span class="v-unit">${L('col.orShare')}</span>`,
        meta: (r) =>
          `<span class="tag">${compact(r.tokens) ?? '—'} ${L('col.orWeekTokens')}</span>` +
          `<span class="tag">${r.growth > 0 ? '+' : ''}${num(r.growth, 1)}%</span>`,
      },
    });
  } catch (e) {
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/** 面板：OpenRouter 性能榜（延迟 / 吞吐两个子榜） */
async function loadOrPerformance(view = 'latency') {
  const p = ensurePanel(shellMeta('orPerf'));
  try {
    const data = await cachedJson('or-performance', `${OR_API}/rankings/performance`);
    const rows = rankPerformance(data?.data, view);
    if (!rows.length) throw new Error(L('err.noBoard'));
    p.status('', 'ok');
    const field = view === 'throughput' ? 'throughput' : 'latency';
    const unit = view === 'throughput' ? 'tok/s' : 'ms';
    mountBoard(p, {
      rows,
      cols: [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        { label: L('col.model'), field: 'name', cell: (r) => esc(r.name || r.slug) },
        { label: L('col.org'), cls: 'col-2', field: 'author', cell: (r) => (r.author ? `<span class="tag">${esc(r.author)}</span>` : '') },
        {
          label: view === 'throughput' ? L('col.orThroughput') : L('col.orLatency'),
          num: true,
          field,
          cell: (r) => (r[field] === null ? '—' : `${num(r[field], 0)} ${unit}`),
        },
        { label: L('col.orReqCount'), num: true, cls: 'col-2', field: 'requests', cell: (r) => compact(r.requests) ?? '—' },
        { label: L('col.orProvider'), cls: 'col-2', field: 'provider', cell: (r) => (r.provider ? `<span class="tag">${esc(r.provider)}</span>` : '') },
      ],
      defaultSort: { index: 3, dir: view === 'throughput' ? 'desc' : 'asc' },
      searchFields: ['name', 'slug', 'author'],
      placeholder: L('ui.searchModels'),
      transform: withRank,
      beforeControls: () => subBoardChips({ latency: 'p.orPerf.latency', throughput: 'p.orPerf.throughput' }, view, 'perf'),
      card: {
        title: (r) => esc(r.name || r.slug),
        value: (r) =>
          r[field] === null
            ? '—'
            : `<span class="v-num">${num(r[field], 0)}</span> <span class="v-unit">${unit}</span>`,
        meta: (r) =>
          (r.provider ? `<span class="tag">${esc(r.provider)}</span>` : '') +
          `<span class="tag">${compact(r.requests) ?? '—'} ${L('col.orReqCount')}</span>`,
      },
    });
    wireOnce(p.el, 'perf', (e) => {
      const b = e.target.closest?.('[data-perf]');
      if (b) loadOrPerformance(b.getAttribute('data-perf'));
    });
  } catch (e) {
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/** 面板：Artificial Analysis 三张评测榜（与 HF 评测榜不同来源，可并列看） */
async function loadOrBenchmarks(view = 'intelligence') {
  const p = ensurePanel(shellMeta('aaBench'));
  try {
    const data = await cachedJson('or-benchmarks', `${OR_API}/rankings/benchmarks`);
    const rows = rankAa(data?.data?.aaData?.[view]);
    if (!rows.length) throw new Error(L('err.noBoard'));
    p.status('', 'ok');
    mountBoard(p, {
      rows,
      cols: [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        { label: L('col.model'), field: 'name', cell: (r) => esc(r.name) },
        { label: L('col.score'), num: true, field: 'score', cell: (r) => num(r.score, 1) },
      ],
      defaultSort: { index: 2, dir: 'desc' },
      searchFields: ['name', 'slug'],
      placeholder: L('ui.searchModels'),
      transform: withRank,
      beforeControls: () =>
        subBoardChips(
          { intelligence: 'p.aaBench.intelligence', coding: 'p.aaBench.coding', agentic: 'p.aaBench.agentic' },
          view,
          'aa'
        ),
      card: {
        title: (r) => esc(r.name),
        value: (r) => `<span class="v-num">${num(r.score, 1)}</span> <span class="v-unit">${L('col.score')}</span>`,
        // 这一榜只有"名字 + 分数"两个字段（AA 的原始数据里没有机构/日期），
        // 所以没有可当标签的东西 —— 显式给空串，而不是省略（见 cardList 的说明）
        meta: () => '',
        link: (r) => `https://openrouter.ai/${encodeURI(r.slug)}`,
      },
    });
    wireOnce(p.el, 'aa', (e) => {
      const b = e.target.closest?.('[data-aa]');
      if (b) loadOrBenchmarks(b.getAttribute('data-aa'));
    });
  } catch (e) {
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/* ================================================================== */
/* 面板：OpenRouter 模型库（全量目录：价格 / 上下文 / 模态 / 上线时间）  */
/* ================================================================== */

/**
 * `/api/v1/models`（~762KB、约 460 个模型）→ 面板行。
 * 价格从"每 token 美元"（字符串）换算成"每百万 token 美元"（数字）：
 * `"0.000002"` → 2（fmtCost 显示成 `$2`，0 显示成"免费"）。
 * 缺失字段一律 null —— 空值恒排最后，不冒充 0 分 / 0 价 / 0 上下文。
 */
export function flattenOrCatalog(json) {
  const perM = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n * 1e6 : null;
  };
  const out = [];
  for (const m of json?.data || []) {
    if (!m?.id) continue;
    out.push({
      id: String(m.id),
      name: String(m.name || m.id),
      vendor: String(m.id).split('/')[0] || '',
      release: Number.isFinite(Number(m.created)) ? new Date(m.created * 1000).toISOString().slice(0, 10) : '',
      context: Number(m.context_length) || null,
      costIn: perM(m.pricing?.prompt),
      costOut: perM(m.pricing?.completion),
      modality: String(m.architecture?.modality || ''),
      slug: String(m.canonical_slug || m.id),
    });
  }
  // 上线日期降序，没日期的排最后（与 flattenModelsDev 同一约定：不把缺日期当 1970）
  return out.sort((a, b) => {
    if (!a.release && !b.release) return a.name.localeCompare(b.name);
    if (!a.release) return 1;
    if (!b.release) return -1;
    return b.release.localeCompare(a.release);
  });
}

/** 模型库的挂载：新鲜数据与回退快照共用一份配置，只差那行"快照声明" */
function mountOrCatalog(p, rows, note) {
  mountBoard(p, {
    rows,
    cols: [
      { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
      {
        label: L('col.model'),
        field: 'name',
        cell: (r) => `<a href="https://openrouter.ai/${encodeURI(r.slug)}" target="_blank" rel="noopener noreferrer">${esc(r.name)}</a>`,
      },
      { label: L('col.provider'), cls: 'col-2', field: 'vendor', cell: (r) => `<span class="tag">${esc(r.vendor)}</span>` },
      { label: L('col.release'), field: 'release', cell: (r) => esc(r.release) || '—' },
      { label: L('col.context'), num: true, cls: 'col-2', field: 'context', cell: (r) => compact(r.context) ?? '—' },
      { label: L('col.priceIn'), num: true, cls: 'col-2', field: 'costIn', cell: (r) => fmtCost(r.costIn) },
      { label: L('col.priceOut'), num: true, cls: 'col-2', field: 'costOut', cell: (r) => fmtCost(r.costOut) },
      { label: L('col.modality'), cls: 'col-2', field: 'modality', cell: (r) => esc(r.modality) || '—' },
    ],
    defaultSort: { index: 3, dir: 'desc' },
    limit: 60,
    searchFields: ['name', 'id', 'vendor'],
    groupField: 'vendor',
    groupLabel: L('ui.allProviders'),
    placeholder: L('ui.searchModelsProviders'),
    transform: withRank,
    note,
    card: {
      title: (r) => esc(r.name),
      value: (r) => `<span class="v-num">${esc(r.release) || '—'}</span> <span class="v-unit">${L('col.release')}</span>`,
      meta: (r) =>
        `<span class="tag">${esc(r.vendor)}</span>` +
        `<span class="tag">${compact(r.context) ?? '—'} ${L('col.context')}</span>` +
        `<span class="tag">${L('col.priceIn')} ${fmtCost(r.costIn)}</span>`,
      link: (r) => `https://openrouter.ai/${encodeURI(r.slug)}`,
    },
  });
}

/**
 * 面板：OpenRouter 模型库。与"用量榜"互补 —— 那边回答"谁在被用"，
 * 这边回答"有什么可用的、多少钱"。浏览器直连（CORS `*`，实测 2026-09-30），
 * 762KB 与 models.dev（4.8MB）/ SWE-bench（4MB）同属"进页面就拉"的量级。
 */
async function loadOrCatalog() {
  const p = ensurePanel(shellMeta('orCatalog'));
  p.status(L('st.loadingBig', { size: '0.76MB' }), 'loading');
  p.body(skeleton(6));
  try {
    // 与其它 OpenRouter 面板共用同一个缓存键：同一标签页里逛完整组只拉一次
    const json = await cachedJson('openrouter-models', OPENROUTER_MODELS_URL);
    const rows = flattenOrCatalog(json);
    if (!rows.length) throw new Error(L('err.noModels'));
    writeSnapshot('or-catalog', rows);
    // 抓取时刻：缓存条目自带写入时间 t —— 命中缓存时是当初拉取的时刻，
    // 未命中则是刚才（cachedJson 刚写进去），两种情况下它都是真话
    const entry = readCacheEntry('openrouter-models', CACHE_TTL_MS);
    p.status('', 'ok');
    mountOrCatalog(p, rows, L('st.orCatDone', { time: fmtStamp(entry?.t ?? Date.now()) }));
  } catch (e) {
    // 上游读不动：回退本浏览器最后一次成功抓取的快照（照实标时刻，不装新数据）
    const snap = readSnapshot('or-catalog');
    if (snap && Array.isArray(snap.v) && snap.v.length) {
      p.status('', 'warn');
      mountOrCatalog(p, snap.v, L('st.staleSnap', { msg: e.message, time: fmtStamp(snap.t) }));
      return;
    }
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/** 面板：OpenRouter 应用榜 + 多模态用量（三个子榜） */
async function loadOrApps(view = 'day') {
  const p = ensurePanel(shellMeta('orApps'));
  const views = { day: 'p.orApps.day', week: 'p.orApps.week', image: 'p.orApps.image', video: 'p.orApps.video', audio: 'p.orApps.audio' };
  try {
    const isMedia = view === 'image' || view === 'video' || view === 'audio';
    const url = isMedia
      ? `${OR_API}/rankings/${view === 'image' ? 'image-output' : view === 'video' ? 'video-output-hours' : 'stt-transcript-characters'}`
      : `${OR_API}/rankings/apps`;
    const [raw, models] = await Promise.all([cachedJson(`or-${view}`, url), cachedJson('openrouter-models', OPENROUTER_MODELS_URL)]);
    const nameOf = orNameOf(models);
    // 单位三者不同：图像按张、视频按**小时**（上游给的就是小时）、语音按字符
    const mediaUnit = view === 'image' ? L('ui.orImages') : view === 'video' ? L('ui.orHours') : L('ui.orChars');

    let rows;
    let cols;
    let card;
    if (isMedia) {
      rows = flattenMedia(raw).map((r) => ({
        ...r,
        label: openrouterLabel(r.slug, nameOf),
      }));
      cols = [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        { label: L('col.model'), field: 'label', cell: (r) => esc(r.label) },
        { label: mediaUnit, num: true, field: 'value', cell: (r) => num(r.value, 0) },
      ];
      card = {
        title: (r) => esc(r.label),
        value: (r) => `<span class="v-num">${num(r.value, 0)}</span> <span class="v-unit">${mediaUnit}</span>`,
      };
    } else {
      rows = rankApps(raw?.data?.[view]);
      cols = [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        {
          label: L('col.app'),
          field: 'title',
          cell: (r) => (r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a>` : esc(r.title)),
        },
        { label: L('col.orTokens'), num: true, field: 'tokens', cell: (r) => compact(r.tokens) ?? '—' },
        { label: L('col.orRequests'), num: true, cls: 'col-2', field: 'requests', cell: (r) => compact(r.requests) ?? '—' },
        { label: L('col.task'), cls: 'col-2', field: 'categories', cell: (r) => (r.categories ? `<span class="tag">${esc(r.categories)}</span>` : '') },
      ];
      card = {
        title: (r) => esc(r.title),
        value: (r) => `<span class="v-num">${compact(r.tokens) ?? '—'}</span> <span class="v-unit">${L('col.orTokens')}</span>`,
        meta: (r) => `<span class="tag">${compact(r.requests) ?? '—'} ${L('col.orRequests')}</span>`,
        link: (r) => r.url,
      };
    }
    if (!rows.length) throw new Error(L('err.noBoard'));
    p.status('', 'ok');
    mountBoard(p, {
      rows,
      cols,
      defaultSort: { index: 2, dir: 'desc' },
      searchFields: isMedia ? ['label', 'slug'] : ['title', 'categories'],
      placeholder: isMedia ? L('ui.searchModels') : L('ui.searchApps'),
      transform: withRank,
      beforeControls: () => subBoardChips(views, view, 'app'),
      card,
    });
    wireOnce(p.el, 'app', (e) => {
      const b = e.target.closest?.('[data-app]');
      if (b) loadOrApps(b.getAttribute('data-app'));
    });
  } catch (e) {
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/* ================================================================== */
/* 启动                                                                */
/* ================================================================== */

/**
 * 面板注册表 —— 键就是 `BOARD_IDS` 里的 id，值是一个启动函数。
 *
 * 用**映射**而不是数组：面板页靠 id 指名要跑哪一个，数组就只能按下标取，
 * 而"第 5 个"这种说法一旦有人调整顺序就会静默错位（跑出别的面板，页面不报错）。
 */
const BOARD_LOADERS = {
  trending: () =>
    loadModelBoard({
      id: 'trending',
      iconName: 'trending',
      title: L('p.trending.title'),
      sort: 'trendingScore',
      metric: { label: L('col.trending'), field: 'trendingScore', icon: 'trending' },
      hint: L('p.trending.hint'),
    }),
  liked: () =>
    loadModelBoard({
      id: 'liked',
      iconName: 'heart',
      title: L('p.liked.title'),
      sort: 'likes',
      metric: { label: L('col.likes'), field: 'likes', icon: 'heart' },
      hint: L('p.liked.hint'),
    }),
  downloaded: () =>
    loadModelBoard({
      id: 'downloaded',
      iconName: 'download',
      title: L('p.downloaded.title'),
      sort: 'downloads',
      metric: { label: L('col.downloads'), field: 'downloads', icon: 'download' },
      hint: L('p.downloaded.hint'),
    }),
  eval: () => loadEvalBoard(),
  aider: () => loadAiderBoard(),
  spaces: () => loadSpaces(),
  datasets: () => loadDatasets(),
  papers: () => loadPapers(),
  aiNews: () => loadAiNews(),
  aiPress: () => loadAiPress(),
  repos: () => loadRepos('week'),
  ghTrending: () => loadGhTrending('ai'),
  zhihu: () => loadHotList('zhihu'),
  csdn: () => loadHotList('csdn'),
  juejin: () => loadHotList('juejin'),
  itzhijia: () => loadHotList('itzhijia'),
  huxiu: () => loadHotList('huxiu'),
  aifaner: () => loadHotList('aifaner'),
  zhongguancun: () => loadHotList('zhongguancun'),
  bilibili: () => loadHotList('bilibili'),
  weibo: () => loadHotList('weibo'),
  toutiao: () => loadHotList('toutiao'),
  hupu: () => loadHotList('hupu'),
  douban: () => loadHotList('douban'),
  zhidemai: () => loadHotList('zhidemai'),
  newmodels: () => loadNewModels(),
  openrouter: () => loadOpenRouter(),
  orCatalog: () => loadOrCatalog(),
  orTrends: () => loadOrTrends(),
  orAuthors: () => loadOrAuthors(),
  orPerf: () => loadOrPerformance(),
  aaBench: () => loadOrBenchmarks(),
  orApps: () => loadOrApps(),
  swebench: () => loadSweBench(),
  // 2026-10-16 新增三张榜（三张都走构建期快照，理由各不相同，见各自的注释段）
  hnTop: () => loadHnTop(),
  wikiAttention: () => loadWikiAttention(),
  googleTrends: () => loadGoogleTrends(),
};

/**
 * 清掉本页的缓存并重画全部面板。
 *
 * 为什么要"清缓存"而不是直接 location.reload()：
 * 缓存是 sessionStorage 里的，刷新页面并不会丢掉它 —— 用户点"刷新数据"
 * 却看到一模一样的内容（因为读的还是 10 分钟内的缓存），
 * 会以为按钮坏了。所以必须显式清掉再拉。
 *
 * localStorage 的快照**不清**（它是上游挂掉时的回退物），但要立一个
 * **强制重拉**标记：评测榜对 7 天内快照直接复用，不设标记的话按钮对它无效。
 *
 * 扁平页上不再把 `#panels` 清空重建 —— 那会让滚动位置与已展开的折叠区全都跳掉。
 * 改为：已经加载过的面板**原地重跑** loader，没加载过的交回观察器（滚到才拉）。
 */
function reloadAll() {
  clearCache();
  try {
    sessionStorage.setItem(FORCE_KEY, '1');
  } catch {
    /* 存不进就算了：顶多评测榜这次仍用快照，不是错误 */
  }
  if (SINGLE_BOARD) {
    // 单面板页：唯一那个面板重建就行（此时清空无害 —— 整页就它一个）
    panelsRoot.innerHTML = '';
    startAll();
    return;
  }
  const pending = [];
  for (const id of wantedIds) {
    if (loaded.has(id)) startLoader(id); // 已加载的：重跑（清过缓存，会真的重拉）
    else pending.push(id);
  }
  observePending(pending);
}

/**
 * 逐个启动面板（不 await 彼此）：最慢的源不该挡住最快的源。
 *
 * 扁平页把"建骨架"与"拉数据"拆开：所有骨架先同步建好（零网络），
 * 观察器盯着它们；滚到视口附近才调 loader。今天重型面板是靠"翻页"才不加载的
 * （models.dev 4.8MB、SWE-bench 4MB、评测榜 46 页），一页装下之后必须改用懒加载，
 * 否则进页面会同时开拉十几个源。
 */
function startAll() {
  // 页面指名的 panel 不存在 → 明着报，不要渲染一个空白页。
  // 走到这里只会是页面写错 id 或 id 改过（`SITE_FILES` / 导航 / data-board 三处要一起改）
  if (!wantedIds.length) {
    panelsRoot.innerHTML =
      `<section class="panel"><p class="panel-status err">` +
      `${esc(L('err.unknownBoard', { id: requestedBoard }))}</p></section>`;
    return;
  }
  // ① 建骨架：同步、无网络。面板的头像与标题因此立刻可见，页面有形状。
  for (const id of wantedIds) ensurePanel(shellMeta(id));
  // ② 触发加载：单面板页直接全加载（就一个）；扁平页交给观察器
  if (SINGLE_BOARD) for (const id of wantedIds) startLoader(id);
  else observePending(wantedIds);
}

/** 已经跑过 loader 的面板 id（刷新时据此决定"原地重跑"还是"重新交给观察器"） */
const loaded = new Set();
/** 正在拉取中的面板 id —— 挡住"观察器 + 深链接"对同一个面板重复发起 */
const inflight = new Set();

/** 跑一个面板的 loader，出错时**画进它自己那块面板**（不静默消失） */
function startLoader(id) {
  if (inflight.has(id)) return; // 同一次加载不重复发起
  inflight.add(id);
  loaded.add(id);
  Promise.resolve()
    .then(() => BOARD_LOADERS[id]())
    .catch((e) => {
      // 兜底：面板构造本身出错也要看得见。骨架已经在 DOM 里，往它里面写错误即可；
      // 万一连骨架都没有（不该发生），**经由 attachPanel** 补一块 —— 不直接 appendChild，
      // 那正是本站修过的"同 id 两个面板"缺陷（见 attachPanel 的注释）。
      let el = panelsRoot.querySelector(`#panel-${id}`);
      if (!el) {
        el = document.createElement('section');
        el.className = 'panel';
        el.id = `panel-${id}`;
        attachPanel(rootFor(id), el, id);
      }
      el.innerHTML = `<p class="panel-status err">${L('err.init', { msg: esc(e.message) })}</p>`;
    })
    .finally(() => inflight.delete(id));
}

/**
 * 扁平页的懒加载：滚到视口附近才调 loader。
 *
 * `rootMargin` 给一屏（600px）的提前量 —— 出发点是"滚到那一块时数据已经在了"，
 * 而不是"滚到了才开始数秒等待"。命中即 `unobserve`（每个面板只拉一次）。
 *
 * **观察器只建一个**（`panelObserver`，模块级）：`reloadAll` 会给"还没加载过的"
 * 面板再 `observePending` 一次，若每次都 `new IntersectionObserver` 就会在同一批
 * 目标上叠出第二个、第三个观察器。`armed` 记着"这个 id 已经交给观察器了"，
 * 重复调用不重复观察。`rootFor`/`ensurePanel` 之外，这是"面板只做一次事"的
 * 又一环（另两环见 `inflight` 与 `wireOnce`）。
 *
 * 没有 `IntersectionObserver` 时退化成"全部加载"：与"没写 data-board 就跑全部"
 * 同一个思路 —— 慢一点，但不会空白。
 */
let panelObserver = null;
const armed = new Set();

function observePending(ids) {
  const todo = ids.filter((id) => !armed.has(id) && !loaded.has(id));
  if (!todo.length) return;
  if (!('IntersectionObserver' in window)) {
    for (const id of todo) startLoader(id);
    return;
  }
  if (!panelObserver) {
    panelObserver = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          const id = en.target.id.replace(/^panel-/, '');
          panelObserver.unobserve(en.target);
          armed.delete(id);
          startLoader(id);
        }
      },
      { rootMargin: '600px 0px' }
    );
  }
  for (const id of todo) {
    const el = panelsRoot.querySelector(`#panel-${id}`);
    if (!el) continue;
    armed.add(id);
    panelObserver.observe(el);
  }
}

/**
 * 扁平页的交互总线：主题筛选（索引条）与标签筛选（面板头）。
 *
 * 两者是**同一条轴上的收窄**：主题是分类（每个榜恰好一个），标签是"主题或来源"
 * （来源会横跨主题）。所以取交集就能满足"点主题 = 看这一类"与"点 HuggingFace =
 * 看这个来源"，且两者可以叠加。收窄只切显示，面板始终留在 DOM 里 ——
 * 于是索引条里的 `#panel-<id>` 锚点永远有效。
 */
const filter = { topic: '*', tag: '*' };

/** 收窄后该不该显示某个榜 —— 抽成纯函数便于测试（不碰 DOM） */
export function boardVisible(id, f) {
  const t = BOARD_TAGS[id];
  if (!t) return false;
  if (f.topic !== '*' && t.topic !== f.topic) return false;
  if (f.tag !== '*' && t.topic !== f.tag && t.source !== f.tag) return false;
  return true;
}

function applyFilter() {
  for (const el of panelsRoot.querySelectorAll('.panel')) {
    const id = el.id.replace(/^panel-/, '');
    el.hidden = !boardVisible(id, filter);
  }
  // 空主题段整段藏起来：只留一个空标题会让人以为"这一段坏了"
  for (const sec of document.querySelectorAll('.topic')) {
    const anyShown = [...sec.querySelectorAll('.panel')].some((p) => !p.hidden);
    sec.hidden = !anyShown;
  }
  // 索引条与面板头里的筛选片：标出当前选中（不只靠颜色，还用 aria-pressed）
  for (const b of document.querySelectorAll('[data-topic-filter],[data-tag-filter]')) {
    const v = b.getAttribute('data-topic-filter') ?? b.getAttribute('data-tag-filter');
    const attr = b.hasAttribute('data-topic-filter') ? 'topic' : 'tag';
    const on = filter[attr] === v || (v === '*' && filter[attr] === '*');
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}

function wireFilters() {
  // ★ 绑在 `document` 而不是 `panelsRoot`：**索引条是 `#panels` 的兄弟**（构建期落在
  //   它前面），不是它的子节点 —— 绑在 `panelsRoot` 上时，索引条里的主题/来源筛选片
  //   点下去根本冒泡不到那里（面板头里的标签片倒是能）。这个缺陷页面上不报错，
  //   只表现为"点了索引条的分类没反应"，本地一条 DOM 探针才照得出来。
  document.addEventListener('click', (e) => {
    const chip = e.target.closest?.('[data-topic-filter],[data-tag-filter]');
    if (!chip) return;
    if (chip.hasAttribute('data-topic-filter')) {
      // 选主题 = 只看这一类：把来源筛选清掉，否则"主题 A ∧ 来源 B"极易落成空集
      filter.topic = chip.getAttribute('data-topic-filter');
      filter.tag = '*';
    } else {
      const tag = chip.getAttribute('data-tag-filter');
      filter.tag = filter.tag === tag ? '*' : tag; // 再点一次取消
    }
    applyFilter();
  });

  // 索引条里的跳转：先清掉筛选，否则目标可能正被隐藏着 —— 那时浏览器滚不过去。
  document.addEventListener('click', (e) => {
    const jump = e.target.closest?.('[data-jump]');
    if (!jump) return;
    filter.topic = '*';
    filter.tag = '*';
    applyFilter();
    // 跳到还没加载过的面板：立刻发起，不必等观察器（浏览器已经在滚了）
    const id = jump.getAttribute('data-jump');
    if (id && !loaded.has(id)) startLoader(id);
  });
}

/** 「刷新数据」按钮：与筛选同一行，由 `src/site/nav.js` 落在索引条里 */
function wireRefresh() {
  const btn = document.getElementById('refresh');
  const hint = document.getElementById('refresh-hint');
  if (!btn) return;
  btn.addEventListener('click', () => {
    btn.disabled = true;
    if (hint) hint.textContent = L('hero.refreshing');
    reloadAll();
    // 评测榜要拉 46 页、约 8 秒，按钮禁用久一点，避免连点
    setTimeout(() => {
      btn.disabled = false;
      if (hint) hint.textContent = L('hero.refreshed');
    }, 1200);
  });
}

if (panelsRoot) {
  startAll();
  wireFilters();
  wireRefresh();
}
