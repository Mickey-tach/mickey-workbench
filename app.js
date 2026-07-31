'use strict';

/* ===================== 基础工具 ===================== */
const STORE = 'mickey_';
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

function load(key, def) {
  try { const v = localStorage.getItem(STORE + key); return v === null ? def : JSON.parse(v); }
  catch (e) { return def; }
}
function save(key, val) {
  try { localStorage.setItem(STORE + key, JSON.stringify(val)); }
  catch (e) { alert('保存失败：本地存储空间不足。\n图片已改为存入 IndexedDB，若仍提示，请清理部分历史数据或重新导出备份。\n(' + (e && e.name || 'Error') + ')'); }
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDate(d) {
  const x = new Date(d); const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}
function todayStr() { return fmtDate(new Date()); }
function fmtTime(ts) { if (!ts) return ''; const d = new Date(ts); const p = (n) => String(n).padStart(2, '0'); return p(d.getHours()) + ':' + p(d.getMinutes()); }
function money(n) { return '¥' + Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function flash(btn, text) { const o = btn.textContent; btn.textContent = text; setTimeout(() => btn.textContent = o, 1100); }

/* 图片压缩为 dataURL */
function readImage(file, cb) {
  const r = new FileReader();
  r.onload = () => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height; const max = 900;
      if (w > max) { h = Math.round(h * max / w); w = max; }
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      cb(c.toDataURL('image/jpeg', 0.8));
    };
    img.src = r.result;
  };
  r.readAsDataURL(file);
}

/* 图片存入 IndexedDB（避免 localStorage 仅约 5MB 上限，导致加几张图就存不进去） */
const _imgDB = (() => {
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('mickey_imgs', 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('imgs')) r.result.createObjectStore('imgs'); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  return {
    put(id, data) { return open().then((db) => new Promise((res, rej) => { const tx = db.transaction('imgs', 'readwrite'); tx.objectStore('imgs').put(data, id); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); })); },
    get(id) { return open().then((db) => new Promise((res, rej) => { const tx = db.transaction('imgs', 'readonly'); const rq = tx.objectStore('imgs').get(id); rq.onsuccess = () => res(rq.result || ''); rq.onerror = () => rej(rq.error); })); },
    del(id) { return open().then((db) => new Promise((res) => { const tx = db.transaction('imgs', 'readwrite'); tx.objectStore('imgs').delete(id); tx.oncomplete = () => res(); tx.onerror = () => res(); })); },
    dump() { return open().then((db) => new Promise((res, rej) => { const tx = db.transaction('imgs', 'readonly'); const kq = tx.objectStore('imgs').getAllKeys(); const vq = tx.objectStore('imgs').getAll(); let keys = [], vals = []; kq.onsuccess = () => { keys = kq.result; }; vq.onsuccess = () => { vals = vq.result; }; tx.oncomplete = () => res(keys.map((k, i) => ({ id: k, data: vals[i] }))); tx.onerror = () => rej(tx.error); })); },
    load(arr) { return open().then((db) => Promise.all((arr || []).map((it) => new Promise((res) => { if (!it || it.id == null) return res(); const tx = db.transaction('imgs', 'readwrite'); tx.objectStore('imgs').put(it.data, it.id); tx.oncomplete = () => res(); tx.onerror = () => res(); })))); },
  };
})();
function storeImg(dataUrl) { const id = uid(); return _imgDB.put(id, dataUrl).then(() => id); }
/* 把数组中仍是 data: 的图片存入 IDB、其余（已是 id 或链接）原样保留 */
function storeImgs(arr) { return Promise.all((arr || []).map((d) => (('' + d).indexOf('data:') === 0 ? storeImg(d) : Promise.resolve(d)))); }
function resolveImg(ref) {
  if (!ref) return Promise.resolve('');
  if (/^(https?:|data:)/i.test(ref)) return Promise.resolve(ref); /* 链接或旧版 base64 直接返回 */
  return _imgDB.get(ref).catch(() => ''); /* 按 id 从 IDB 取，异常则回落空图 */
}
function resolveImgs(arr) { return Promise.all((arr || []).map(resolveImg)); }
function isImgLinkOrData(v) { return /^(https?:|data:)/i.test(v || ''); }

/* ===================== 数据备份 / 恢复 ===================== */
function dumpImgs() { return _imgDB.dump().catch(() => []); }
function loadImgsDump(arr) { return _imgDB.load(arr).catch(() => {}); }
async function exportBackup() {
  const ls = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.indexOf('mickey_') === 0) ls[k] = localStorage.getItem(k);
  }
  const imgs = await dumpImgs();
  const payload = { app: 'mickey-workbench', version: 1, exportedAt: new Date().toISOString(), localStorage: ls, images: imgs };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const a = document.createElement('a');
  const d = new Date(); const p2 = (n) => ('' + n).padStart(2, '0');
  a.href = URL.createObjectURL(blob);
  a.download = 'mickey-backup-' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes()) + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  if (typeof alert === 'function') alert('已导出备份文件（含全部数据与图片），请妥善保存到云盘或本机。');
}
function importBackup(file) {
  if (!file) return;
  if (typeof confirm === 'function' && !confirm('导入备份将覆盖当前所有本地数据，确定继续吗？\n建议先点「导出备份」保存当前数据。')) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const p = JSON.parse(reader.result);
      const ls = p.localStorage || {};
      Object.keys(ls).forEach((k) => { if (k.indexOf('mickey_') === 0) localStorage.setItem(k, ls[k]); });
      await loadImgsDump(p.images || []);
      if (typeof alert === 'function') alert('备份导入成功，即将刷新页面。');
      location.reload();
    } catch (e) { if (typeof alert === 'function') alert('备份文件解析失败：' + e.message); }
  };
  reader.readAsText(file);
}

/* ===================== 导航 ===================== */
function initNav() {
  const go = (target) => {
    $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.target === target));
    $$('.page').forEach((p) => p.classList.toggle('active', p.id === target));
    activeSection = target;
    const titles = { home: '首页', plan: '每日计划', review: '周复盘', learn: '学习复盘', sports: '运动', ledger: '记账本', english: '每日英语', mood: '今日心情', inspiration: '选题每日灵感', tailor: '裁缝日记' };
    $('#pageTitle').textContent = titles[target] || '';
    $('#topDate').textContent = todayStr();
    window.scrollTo({ top: 0 });
  };
  $$('.nav-item').forEach((btn) => btn.addEventListener('click', () => go(btn.dataset.target)));
}

/* ===================== 1. 每日计划 ===================== */
const PRESET_TASKS = [
  { id: 'preset_vocab', text: '英语词语积累20个', preset: true },
  { id: 'preset_review', text: '复盘', preset: true },
];
const planExpanded = new Set();
function normTask(t) {
  return {
    id: t.id || uid(),
    text: t.text || '',
    done: !!t.done,
    preset: !!t.preset,
    due: t.due || '',
    shelved: !!t.shelved,
    shelveReason: t.shelveReason || '',
    subtasks: Array.isArray(t.subtasks) ? t.subtasks.map((s) => ({ id: s.id || uid(), text: s.text || '', done: !!s.done })) : [],
    created: t.created || Date.now(),
  };
}
function initPlan() {
  $('#planDate').textContent = '今天 ' + todayStr();
  if (!load('plan_init', false)) {
    save('tasks', PRESET_TASKS.map((t) => normTask({ ...t, done: false })));
    save('plan_init', true);
  } else {
    const tasks = (load('tasks', []) || []).map(normTask); /* 旧数据补全字段 */
    save('tasks', tasks);
  }
  const input = $('#taskInput');
  const due = $('#taskDue');
  const add = () => {
    const text = input.value.trim(); if (!text) return;
    const tasks = load('tasks', []).map(normTask);
    tasks.push(normTask({ id: uid(), text, done: false, preset: false, due: due.value || '', created: Date.now() }));
    save('tasks', tasks); input.value = ''; if (due) due.value = ''; renderPlan();
  };
  $('#taskAdd').addEventListener('click', add);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  $('#taskList').addEventListener('click', onTaskClick);
  $('#taskList').addEventListener('keydown', onTaskKey);
  renderPlan();
}
function dueHtml(due, today) {
  if (due < today) return `<span class="due overdue">⏰ ${due} 逾期</span>`;
  if (due === today) return `<span class="due today">⏰ 今天到期</span>`;
  const diff = Math.round((new Date(due) - new Date(today)) / 86400000);
  if (diff <= 7) return `<span class="due soon">⏰ ${due}</span>`;
  return `<span class="due">⏰ ${due}</span>`;
}
function onTaskClick(e) {
  const card = e.target.closest('.task-card'); if (!card) return;
  const id = card.dataset.id; const tasks = load('tasks', []).map(normTask);
  const t = tasks.find((x) => x.id === id); if (!t) return;
  if (e.target.classList.contains('check')) { t.done = !t.done; if (t.done) planExpanded.delete(id); }
  else if (e.target.classList.contains('del')) { const i = tasks.findIndex((x) => x.id === id); if (i >= 0) tasks.splice(i, 1); planExpanded.delete(id); }
  else if (e.target.classList.contains('shelve')) {
    if (t.shelved) { t.shelved = false; t.shelveReason = ''; }
    else {
      promptText('搁置该任务', '请填写搁置原因，例如：优先级低 / 暂时没时间 / 等资源齐 / 方向变了', (reason) => {
        const ts = load('tasks', []).map(normTask); const tt = ts.find((x) => x.id === id);
        if (tt) { tt.shelved = true; tt.shelveReason = reason || '未填写原因'; save('tasks', ts); renderPlan(); }
      }, t.shelveReason);
      return;
    }
  }
  else if (e.target.classList.contains('sub-toggle')) { if (planExpanded.has(id)) planExpanded.delete(id); else planExpanded.add(id); save('tasks', tasks); renderPlan(); return; }
  else if (e.target.classList.contains('sub-check')) { const sid = e.target.closest('.sub-item').dataset.sid; const s = t.subtasks.find((x) => x.id === sid); if (s) s.done = !s.done; }
  else if (e.target.classList.contains('sub-del')) { const sid = e.target.dataset.sid; const i = t.subtasks.findIndex((x) => x.id === sid); if (i >= 0) t.subtasks.splice(i, 1); }
  else if (e.target.classList.contains('sub-add-btn')) { const inp = card.querySelector('.sub-input'); const v = inp.value.trim(); if (v) { t.subtasks.push({ id: uid(), text: v, done: false }); inp.value = ''; } }
  else return;
  save('tasks', tasks); renderPlan();
}
function onTaskKey(e) {
  if (e.key === 'Enter' && e.target.classList.contains('sub-input')) {
    e.preventDefault();
    const card = e.target.closest('.task-card'); const id = card.dataset.id;
    const v = e.target.value.trim(); if (!v) return;
    const tasks = load('tasks', []).map(normTask); const t = tasks.find((x) => x.id === id);
    if (t) { t.subtasks.push({ id: uid(), text: v, done: false }); save('tasks', tasks); renderPlan(); }
  }
}
function promptText(title, placeholder, cb, defaultVal) {
  openModal(`<div class="modal-h">${escapeHtml(title)}</div>
    <textarea id="ptInput" class="modal-textarea" placeholder="${escapeHtml(placeholder || '')}">${escapeHtml(defaultVal || '')}</textarea>
    <div class="modal-actions"><button class="btn-ghost" id="ptCancel">取消</button><button class="btn-primary" id="ptOk">确定</button></div>`);
  const ta = $('#ptInput'); if (ta) ta.focus();
  $('#ptOk').addEventListener('click', () => { const v = (ta ? ta.value : '').trim(); closeModal(); cb(v); });
  $('#ptCancel').addEventListener('click', closeModal);
}
function renderSchedule(tasks, today) {
  const box = $('#scheduleSummary'); if (!box) return;
  const sched = tasks.filter((t) => t.due && !t.done && !t.shelved);
  if (!sched.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
  box.style.display = '';
  const od = sched.filter((t) => t.due < today);
  const td = sched.filter((t) => t.due === today);
  const soon = sched.filter((t) => t.due > today && Math.round((new Date(t.due) - new Date(today)) / 86400000) <= 7);
  const rows = [...od, ...td, ...soon].map((t) => `<li class="${t.due < today ? 'od' : (t.due === today ? 'td' : '')}"><span class="dot"></span>${escapeHtml(t.text)} <em>${t.due}${t.due < today ? ' 逾期' : (t.due === today ? ' 今天' : '')}</em></li>`).join('');
  box.innerHTML = `<div class="ss-head">⏰ 定时任务汇总（${sched.length} 项待办有截止日）</div><ul class="ss-list">${rows}</ul>`;
}
function renderPlan() {
  const tasks = load('tasks', []).map(normTask);
  tasks.sort((a, b) => {
    const rank = (t) => t.shelved ? 2 : (t.done ? 1 : 0);
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    return a.created - b.created;
  });
  const list = $('#taskList'); list.innerHTML = '';
  if (!tasks.length) list.innerHTML = '<div class="empty">还没有任务，添加一个吧～</div>';
  const today = todayStr();
  tasks.forEach((t) => {
    const c = document.createElement('div');
    c.className = 'task-card' + (t.done ? ' done' : '') + (t.shelved ? ' shelved' : '');
    c.dataset.id = t.id;
    const dueBadge = t.due ? dueHtml(t.due, today) : '';
    const subOpen = planExpanded.has(t.id);
    const subDone = t.subtasks.filter((s) => s.done).length;
    const subHtml = t.subtasks.length ? `<button class="sub-toggle" title="子任务">📋 ${subDone}/${t.subtasks.length}</button>` : '';
    const shelveHtml = t.shelved ? `<span class="shelve-reason" title="搁置原因">⏸ ${escapeHtml(t.shelveReason || '已搁置')}</span>` : '';
    c.innerHTML = `<button class="check" aria-label="完成">${t.done ? '✓' : ''}</button>
      <span class="task-text">${escapeHtml(t.text)}</span>
      ${dueBadge}${subHtml}${shelveHtml}
      <button class="shelve" aria-label="${t.shelved ? '恢复' : '搁置'}">${t.shelved ? '↩' : '📥'}</button>
      <button class="del" aria-label="删除">×</button>`;
    list.appendChild(c);
    if (subOpen) {
      const wrap = document.createElement('div'); wrap.className = 'subtasks';
      wrap.innerHTML = (t.subtasks.map((s) => `<div class="sub-item" data-sid="${s.id}"><button class="sub-check ${s.done ? 'on' : ''}">${s.done ? '✓' : ''}</button><span class="sub-text ${s.done ? 'done' : ''}">${escapeHtml(s.text)}</span><button class="sub-del" data-sid="${s.id}">×</button></div>`).join('') || '<div class="muted" style="padding:4px 0">还没有子任务</div>') +
        `<div class="sub-add"><input class="sub-input" type="text" placeholder="拆解子任务，回车添加…" maxlength="60"><button class="sub-add-btn">添加</button></div>`;
      c.appendChild(wrap);
    }
  });
  const done = tasks.filter((t) => t.done).length;
  $('#planProgressText').textContent = `已完成 ${done} / ${tasks.length}`;
  $('#planProgressFill').style.width = tasks.length ? (done / tasks.length * 100) + '%' : '0%';
  renderSchedule(tasks, today);
}

/* ===================== 2. 周复盘 ===================== */
function getMonday(d) { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x; }
function weekKey(d) { return fmtDate(getMonday(d)); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
let currentWeek = weekKey(new Date());
let activeSection = 'plan';
function initReview() {
  $('#weekPrev').addEventListener('click', () => { currentWeek = fmtDate(addDays(currentWeek, -7)); renderReview(); });
  $('#weekNext').addEventListener('click', () => { currentWeek = fmtDate(addDays(currentWeek, 7)); renderReview(); });
  $('#weekToday').addEventListener('click', () => { currentWeek = weekKey(new Date()); renderReview(); });
  $('#weekSelect').addEventListener('change', (e) => { currentWeek = e.target.value; renderReview(); });
  ['#rvCompleted', '#rvProblems', '#rvImprovements', '#rvHighlights'].forEach((s) => $(s).addEventListener('input', () => {
    save('review_' + currentWeek, { completed: $('#rvCompleted').value, problems: $('#rvProblems').value, improvements: $('#rvImprovements').value, highlights: $('#rvHighlights').value });
    refreshWeekSelect();
  }));
  $('#rvThoughts').addEventListener('input', () => { const d = load('review_' + currentWeek, {}); d.thoughts = $('#rvThoughts').value; save('review_' + currentWeek, d); });
  $('#genSuggestions').addEventListener('click', renderReviewAnalysis);
  $('#aiReview').addEventListener('click', analyzeReviewAI);
  renderReview();
}
function reviewWeeks() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(STORE + 'review_')) out.push(k.slice((STORE + 'review_').length)); }
  return out;
}
function refreshWeekSelect() {
  const weeks = reviewWeeks(); if (!weeks.includes(currentWeek)) weeks.push(currentWeek); weeks.sort();
  const sel = $('#weekSelect'); const prev = sel.value;
  sel.innerHTML = weeks.map((w) => { const m = getMonday(w); const tag = w === weekKey(new Date()) ? '（本周）' : ''; return `<option value="${w}">${fmtDate(m)} ~ ${fmtDate(addDays(m, 6))}${tag}</option>`; }).join('');
  sel.value = weeks.includes(prev) && prev ? prev : currentWeek;
}
function renderReview() {
  const m = getMonday(currentWeek);
  $('#reviewRange').textContent = `本周 ${fmtDate(m)} ~ ${fmtDate(addDays(m, 6))}`;
  const data = load('review_' + currentWeek, { completed: '', problems: '', improvements: '', highlights: '' });
  $('#rvCompleted').value = data.completed || ''; $('#rvProblems').value = data.problems || '';
  $('#rvImprovements').value = data.improvements || ''; $('#rvHighlights').value = data.highlights || ''; $('#rvThoughts').value = data.thoughts || '';
  $('#reviewHint').textContent = getMonday(currentWeek) < getMonday(new Date()) ? '这是历史周记录，可随时回溯查看与修改。' : '新的一周已自动生成空白模块，内容会自动保存。';
  refreshWeekSelect();
  renderReviewAnalysis();
}

/* ===================== 效率分析 / 学习复盘 / AI ===================== */
function matchLearningToContext(tasks, reviewData) {
  const books = load('books', []) || [];
  const materials = load('materials', []) || [];
  const ideas = load('ideas', []) || [];
  const norm = (s) => (s == null ? '' : String(s)).toLowerCase();
  // 各数据源上下文：每日计划 + 素材(物料) + 灵感(选题) + 周复盘
  const taskCtx = (tasks || []).map((t) => norm(t.text) + ' ' + norm((t.subtasks || []).filter((s) => !s.done).map((s) => s.text).join(' ')) + ' ' + norm(t.note)).join(' ');
  const matCtx = materials.map((m) => norm([m.name, m.cat, m.spec, m.code, m.source].filter(Boolean).join(' '))).join(' ');
  const ideaCtx = ideas.map((x) => norm(x.text)).join(' ');
  const revCtx = norm([reviewData.completed, reviewData.problems, reviewData.improvements, reviewData.highlights, reviewData.thoughts].filter(Boolean).join(' '));
  const ctx = (taskCtx + ' ' + matCtx + ' ' + ideaCtx + ' ' + revCtx);
  const out = [];
  books.forEach((b) => (b.viewpoints || []).forEach((v) => {
    const kw = ((v.tags || []).join(' ') + ' ' + (v.useWhere || '') + ' ' + (v.text || '')).split(/[\s,，、]+/).filter((w) => w.length >= 2).map(norm);
    const hitWords = kw.filter((w) => ctx.includes(w));
    const sources = [];
    if (hitWords.some((w) => taskCtx && taskCtx.includes(w))) sources.push('计划');
    if (matCtx && hitWords.some((w) => matCtx.includes(w))) sources.push('素材');
    if (ideaCtx && hitWords.some((w) => ideaCtx.includes(w))) sources.push('灵感');
    if (revCtx && hitWords.some((w) => revCtx.includes(w))) sources.push('复盘');
    out.push({ book: b.title, text: v.text, where: v.useWhere, tags: v.tags, key: !!v.key, hit: hitWords.length > 0, sources });
  }));
  out.sort((a, b) => ((b.hit && b.key ? 2 : 0) + (b.hit ? 1 : 0)) - ((a.hit && a.key ? 2 : 0) + (a.hit ? 1 : 0)));
  return out;
}
function viewMatchHtml(m) {
  const src = (m.sources || []).map((s) => `<span class="tag-src">${s}</span>`).join('');
  return `<div class="an-view ${m.key ? 'key' : ''}">${m.key ? '★ ' : ''}${escapeHtml(m.text)}${m.where ? ` <em>→ ${escapeHtml(m.where)}</em>` : ''} <span class="from">（《${escapeHtml(m.book)}》）</span>${src ? ' ' + src : ''}</div>`;
}
function topReason(reasons) {
  const c = {}; reasons.forEach((r) => { if (r) c[r] = (c[r] || 0) + 1; });
  const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : '';
}
function renderReviewAnalysis() {
  const box = $('#reviewAnalysis'); if (!box) return;
  const data = load('review_' + currentWeek, {}) || {};
  const tasks = load('tasks', []).map(normTask);
  const total = tasks.length, done = tasks.filter((t) => t.done).length;
  const active = tasks.filter((t) => !t.done && !t.shelved).length;
  const shelved = tasks.filter((t) => t.shelved);
  const overdue = tasks.filter((t) => t.due && t.due < todayStr() && !t.done && !t.shelved);
  const rate = total ? Math.round(done / total * 100) : 0;
  const matches = matchLearningToContext(tasks, data).filter((m) => m.hit || m.key);
  const tips = [];
  if (!total) tips.push('本周还没有建立任何任务，先从 3 件最重要的事开始。');
  else if (rate < 50) tips.push(`完成率仅 ${rate}%，任务可能偏多或偏大，建议把大任务拆成子任务（点任务上的 📋），每天聚焦 3 件核心。`);
  else if (rate < 80) tips.push(`完成率 ${rate}%，状态不错，留意那些反复拖到明天的任务，考虑是否搁置或重排优先级。`);
  else tips.push(`完成率 ${rate}%，执行力很强，保持节奏！`);
  if (overdue.length) tips.push(`有 ${overdue.length} 个任务已逾期，建议今天先清掉或重新设定截止日。`);
  if (shelved.length) { const reasons = shelved.map((s) => s.shelveReason).filter(Boolean); tips.push(`本周搁置 ${shelved.length} 个任务${reasons.length ? '，常见原因：' + topReason(reasons) : ''}，搁置不是失败，定期回看它们是否还值得做。`); }
  if (matches.length) tips.push(`可把读书学到的观点用起来：${matches.slice(0, 3).map((m) => '《' + m.book + '》的「' + m.text + '」').join('；')}。`);
  if (!data.thoughts) tips.push('试着在「心里想法」里写下这周的真实情绪，复盘会更完整。');
  box.innerHTML = `<div class="an-head">📊 本周效率分析（自动）</div>
    <div class="an-stats">
      <span>任务 ${total}</span><span>完成 ${done}</span><span>进行中 ${active}</span>
      <span class="${rate < 50 ? 'bad' : (rate < 80 ? 'mid' : 'good')}">完成率 ${rate}%</span>
      <span class="${overdue.length ? 'bad' : ''}">逾期 ${overdue.length}</span>
      <span class="${shelved.length ? 'mid' : ''}">搁置 ${shelved.length}</span>
    </div>
    ${matches.length ? `<div class="an-views"><b>📚 可践行的读书观点：</b>${matches.slice(0, 5).map(viewMatchHtml).join('')}</div>` : ''}
    <div class="an-tips"><b>💡 建议</b><ul>${tips.map((t) => '<li>' + escapeHtml(t) + '</li>').join('')}</ul></div>`;
  const cfg = load('ai_cfg', {}); const aiBtn = $('#aiReview'); if (aiBtn) aiBtn.style.display = (cfg && cfg.key) ? '' : 'none';
}
async function analyzeReviewAI() {
  const data = load('review_' + currentWeek, {}) || {};
  const tasks = load('tasks', []).map(normTask);
  const books = load('books', []);
  const ctx = JSON.stringify({ week: currentWeek, tasks, review: data, books: (books || []).map((b) => ({ title: b.title, viewpoints: (b.viewpoints || []).map((v) => ({ text: v.text, tags: v.tags, useWhere: v.useWhere, key: v.key })) })) }, null, 2);
  const sys = '你是一个个人成长教练。根据用户一周的任务完成情况、周复盘笔记和读书观点，给出简短（250字内）的效率分析、情绪观察与可执行的下一步建议。用中文、分点、直接说重点。';
  openModal('<div class="modal-h">✨ AI 综合分析与建议</div><div class="modal-loading">正在分析，请稍候…</div>');
  try {
    const r = await callAI([{ role: 'system', content: sys }, { role: 'user', content: ctx }]);
    openModal(`<div class="modal-h">✨ AI 综合分析与建议</div><div class="modal-text">${escapeHtml(r)}</div><div class="modal-actions"><button class="btn-primary" id="mc">知道了</button></div>`);
    $('#mc').addEventListener('click', closeModal);
  } catch (e) { openModal(`<div class="modal-h">⚠️ AI 分析失败</div><div class="modal-text">${escapeHtml(e.message)}</div><div class="modal-actions"><button class="btn-primary" id="mc">关闭</button></div>`); const x = $('#mc'); if (x) x.addEventListener('click', closeModal); }
}

/* ===================== 学习复盘 ===================== */
const LEARN_TAGS = ['工作', '生活', '副业', '健康', '人际', '情绪', '效率', '理财'];
const BOOK_DB = [
  /* 女性 */
  { cat: '女性', title: '第二性', author: '西蒙娜·德·波伏瓦', desc: '女性独立的哲学奠基之作，探讨“女人不是天生的，而是被塑造的”。', text: '“女人不是天生的，而是被变成的。”\n我们并非生来就被定义，社会、教育与期待共同塑造了“女性”的模样。认识这一点，是走向自由的第一步——你拥有定义自己的权利。' },
  { cat: '女性', title: '向前一步', author: '谢丽尔·桑德伯格', desc: '鼓励女性在职场领导岗位上更自信地迈出一步。', text: '当机会来临时，女性常常觉得自己还没准备好。\n但成长恰恰发生在“略微超出能力”的边缘。别等完美，先坐下那张桌子。' },
  { cat: '女性', title: '82年生的金智英', author: '赵南柱', desc: '一部关于普通女性日常的纪实小说，温柔又刺痛。', text: '“女孩子太胆小，男孩子太野蛮。”\n从小被这样规训的我们，终于开始问：为什么同样是认真生活，却被要求更懂事、更懂事、再懂事一点？' },
  { cat: '女性', title: '我的天才女友', author: '埃莱娜·费兰特', desc: '那不勒斯四部曲开篇，关于女性友谊、成长与自我书写。', text: '我们从小到大都在互相塑造。\n真正的友谊不是依附，而是让彼此看见自己本可以走到的远方。' },
  { cat: '女性', title: '一间自己的房间', author: '弗吉尼亚·伍尔夫', desc: '女性写作与经济独立的经典随笔。', text: '“一个女人如果打算写小说，她必须有钱，还要有一间自己的房间。”\n独立空间与独立收入，是精神自由的底座。' },
  { cat: '女性', title: '始于极限', author: '上野千鹤子 / 铃木凉美', desc: '两代女性关于恋爱、工作与自由的坦诚书信。', text: '“别为了迎合别人而弄丢自己。”\n成熟不是变得圆滑，而是更清楚自己要什么、不要什么。' },
  /* 经济 */
  { cat: '经济', title: '富爸爸穷爸爸', author: '罗伯特·清崎', desc: '建立资产与负债思维，重塑金钱观的入门经典。', text: '穷人为钱工作，富人让钱为自己工作。\n真正拉开差距的不是收入高低，而是你把钱放进资产还是负债。先买资产，再谈享受。' },
  { cat: '经济', title: '小狗钱钱', author: '博多·舍费尔', desc: '用童话讲透理财，适合所有人的金钱启蒙。', text: '把你收入的十分之一留下来，养一只会下金蛋的“鹅”。\n无论发生什么，都不要杀掉你的鹅——持续的储蓄与复利，是最温柔的魔法。' },
  { cat: '经济', title: '穷查理宝典', author: '查理·芒格', desc: '多元思维模型与逆向思考的智者箴言。', text: '反过来想，总是反过来想。\n如果想知道怎么过得幸福，先研究怎样会过上痛苦的人生，然后避开那些事。' },
  { cat: '经济', title: '纳瓦尔宝典', author: '埃里克·乔根森', desc: '关于财富与幸福的现代箴言集。', text: '财富不是靠出售时间换来的，而是靠拥有股权与复利。\n用专长和杠杆，让同一份努力被放大千万倍。' },
  { cat: '经济', title: '经济学原理', author: '曼昆', desc: '最通俗的宏观/微观经济学入门。', text: '天下没有免费的午餐。\n每一个选择都有机会成本，理性的人会考虑边际量。' },
  { cat: '经济', title: '思考，快与慢', author: '丹尼尔·卡尼曼', desc: '揭秘人类两套思维系统与认知偏差。', text: '我们并非总是理性。\n意识到直觉的盲区，才能在重要决定上慢下来、想清楚。' },
  /* AI */
  { cat: 'AI', title: '人工智能时代', author: '杰瑞·卡普兰', desc: '透视 AI 对社会、就业与财富的重新分配。', text: '未来不属于会用 AI 的人，而属于懂得与 AI 协作的人。\n理解它如何运作，比恐惧它更重要；把它当工具，而非对手。' },
  { cat: 'AI', title: '深度学习', author: 'Ian Goodfellow 等', desc: 'AI 领域的权威教材，系统理解神经网络。', text: '深度学习的核心，是用多层非线性变换，把原始数据逐步抽象成可理解的特征。\n看似神秘，本质仍是对“表示”的层层学习。' },
  { cat: 'AI', title: '生命3.0', author: '迈克斯·泰格马克', desc: '探讨人工智能与人类的未来命运。', text: '我们可以成为自己命运的设计者。\n面对强大的技术，最危险的不是它太聪明，而是我们没能提前想清楚想要怎样的未来。' },
  { cat: 'AI', title: '黑客与画家', author: '保罗·格雷厄姆', desc: '关于编程、创业与创造力的文集。', text: '创造优美事物的方式，往往是先做一个能用的粗糙版本，再持续打磨。\n代码和画作一样，都是创造。' },
  { cat: 'AI', title: '算法图解', author: '巴尔加瓦', desc: '用图说话，轻松理解常见算法。', text: '算法不是天书，而是一套解决问题的清晰步骤。\n先想清楚“怎么分而治之”，再动手写代码。' },
  { cat: 'AI', title: '智能时代', author: '吴军', desc: '大数据与机器智能如何重塑商业与社会。', text: '在智能时代，数据成了新的能源。\n谁掌握数据、又懂得用数据做决策，谁就掌握了未来。' },
];
BOOK_DB.forEach((b, i) => { b._i = i; });
function booksByCat(c) { return BOOK_DB.filter((b) => b.cat === c); }
function allCats() { return [...new Set(BOOK_DB.map((b) => b.cat))]; }
let recCat = '女性';
let recOffset = {};
let recQuery = '';
function readLog(d) { return load('read_log_' + (d || todayStr()), { minutes: 0 }); }
function bumpReadLog(mins, d) { const r = readLog(d); r.minutes = (r.minutes || 0) + mins; r.ts = Date.now(); save('read_log_' + (d || todayStr()), r); }
function saveQuote(text, book) { if (!text || !text.trim()) return; const q = load('quotes', []); q.push({ text: text.trim(), book: book || '学习', ts: Date.now() }); save('quotes', q.slice(-50)); }
function openReader(title, text) {
  const d = todayStr(); let secs = 0, timer = null;
  const fmt = () => Math.floor(secs / 60) + '分' + String(secs % 60).padStart(2, '0') + '秒';
  openModal(`<div class="modal-h">📖 阅读 · ${escapeHtml(title)}</div>
    <div class="reader">
      <div class="reader-bar">
        <span class="rb-time" id="rbTime">⏱ 00分00秒</span>
        <button class="btn-ghost" id="rbToggle">▶ 开始计时</button>
        <span class="muted" id="rbToday"></span>
      </div>
      <div class="reader-text">${escapeHtml(text || '（暂无可读内容，可在书籍详情里补充读书笔记）')}</div>
      <div class="quote-pick"><input id="qpText" class="modal-input" placeholder="读到喜欢的句子？粘贴/写下，保存为金句到首页"><button class="btn-primary" id="qpSave">💎 存金句</button></div>
      <div class="modal-actions"><button class="btn-ghost" id="rbClose">关闭</button></div>
    </div>`);
  const rb = $('#rbTime'), rbT = $('#rbToggle'), rbToday = $('#rbToday');
  rbToday.textContent = '今日已读 ' + readLog(d).minutes + ' 分';
  rbT.addEventListener('click', () => {
    if (timer) { clearInterval(timer); timer = null; rbT.textContent = '▶ 继续计时'; bumpReadLog(Math.max(1, Math.round(secs / 60)), d); rbToday.textContent = '今日已读 ' + readLog(d).minutes + ' 分'; return; }
    rbT.textContent = '⏸ 暂停'; timer = setInterval(() => { secs++; rb.textContent = '⏱ ' + fmt(); }, 1000);
  });
  $('#qpSave').addEventListener('click', () => { const t = $('#qpText').value; if (!t.trim()) return; saveQuote(t, title); flash($('#qpSave'), '已存金句'); $('#qpText').value = ''; });
  $('#rbClose').addEventListener('click', () => { if (timer) { clearInterval(timer); bumpReadLog(Math.max(1, Math.round(secs / 60)), d); } closeModal(); if (activeSection === 'home') renderHome(); renderLearn(); });
}
function renderRecBooks() {
  const wrap = $('#recWrap'); if (!wrap) return;
  const rl = readLog(); const status = rl.minutes ? `<div class="read-status">📖 今日已阅读 ${rl.minutes} 分钟</div>` : '';
  const cats = allCats();
  wrap.innerHTML = `${recDailyHtml()}
    ${status}
    <div class="rec-search"><input id="recSearch" class="modal-input" placeholder="🔍 搜索书名 / 作者 / 主题，如：理财、女性、AI" value="${escapeHtml(recQuery)}"></div>
    <div class="rec-section">
      <div class="rs-head"><h3>📚 为你推荐（点「开始阅读」可在页内阅读，自动记时长）</h3>
        ${recQuery ? '' : `<div class="rec-tabs">${cats.map((c) => `<button class="rec-tab ${c === recCat ? 'on' : ''}" data-cat="${c}">${c}</button>`).join('')}</div>`}
      </div>
      ${recQuery
        ? `<button class="btn-ghost" id="recClear" style="margin:4px 0 10px">✕ 清除搜索</button>`
        : `<div class="rec-bar"><button class="btn-ghost" id="recShuffle">🔄 换一批</button><span class="muted" id="recCount"></span></div>`}
      <div class="rec-grid" id="recResults"></div>
    </div>`;
  $('#recSearch').addEventListener('input', (e) => { recQuery = e.target.value; renderRecResults(); });
  const clear = $('#recClear'); if (clear) clear.addEventListener('click', () => { recQuery = ''; renderRecBooks(); });
  wrap.querySelectorAll('.rec-tab').forEach((t) => t.addEventListener('click', () => { recCat = t.dataset.cat; recOffset[recCat] = 0; renderRecResults(); }));
  const sh = $('#recShuffle'); if (sh) sh.addEventListener('click', () => {
    const len = booksByCat(recCat).length; const off = (recOffset[recCat] || 0) + 3; recOffset[recCat] = len > 3 ? off % len : 0; renderRecResults();
  });
  renderRecDaily();
  renderRecResults();
  const recAiBtn = $('#recAi'); if (recAiBtn) recAiBtn.addEventListener('click', genAiBooks);
}
function recDailyHtml() {
  const seed = dateSeed(todayStr());
  const n = BOOK_DB.length;
  const idxs = [seed % n, (seed + 5) % n, (seed + 11) % n];
  const books = [...new Set(idxs)].map((i) => BOOK_DB[i]).filter(Boolean);
  return `<div class="rec-daily">
    <div class="rs-head"><h3>📅 今日推荐 <span class="muted" style="font-size:12px;font-weight:400">· ${fmtDate(new Date())} 每日更新</span></h3>
      <button class="btn-ghost rec-ai" id="recAi" title="AI 根据你的方向荐书">✨ AI 荐书</button></div>
    <div class="rec-grid" id="recDaily">${books.map(recCard).join('')}</div>
    <div class="rec-ai-box" id="recAiBox" style="display:none"></div>
  </div>`;
}
function renderRecDaily() { const box = $('#recDaily'); if (box) bindRecCards(box); }
function recCard(b) {
  return `<div class="rec-card">
    <div class="rc-title">${escapeHtml(b.title)}</div>
    <div class="rc-author">${escapeHtml(b.author)}</div>
    <div class="rc-desc">${escapeHtml(b.desc)}</div>
    <div class="rc-actions"><button class="rc-read" data-bi="${b._i}">开始阅读</button><button class="rc-add" data-bi="${b._i}">加入书架</button></div>
  </div>`;
}
function renderRecResults() {
  const box = $('#recResults'); if (!box) return;
  const q = recQuery.trim().toLowerCase();
  let items;
  if (q) {
    items = BOOK_DB.filter((b) => (b.title + b.author + b.desc + b.cat).toLowerCase().includes(q));
  } else {
    const list = booksByCat(recCat); const off = recOffset[recCat] || 0; items = list.slice(off, off + 3);
    const cEl = $('#recCount'); if (cEl) cEl.textContent = list.length ? (off + 1) + '–' + Math.min(off + 3, list.length) + ' / ' + list.length : '';
  }
  box.innerHTML = items.length ? items.map(recCard).join('') : (q ? '<div class="empty">没找到相关书籍，换个关键词试试～</div>' : '<div class="empty">这个分类暂时没有更多啦</div>');
  bindRecCards(box);
}
function bindRecCards(box) {
  if (!box) return;
  box.querySelectorAll('.rc-read').forEach((b) => b.addEventListener('click', () => { const book = BOOK_DB[Number(b.dataset.bi)]; openReader(book.title, book.text); }));
  box.querySelectorAll('.rc-add').forEach((b) => b.addEventListener('click', () => {
    const book = BOOK_DB[Number(b.dataset.bi)];
    const arr = load('books', []); if (arr.some((x) => x.title === book.title)) { flash(b, '已在书架'); return; }
    arr.push({ id: uid(), title: book.title, author: book.author, status: '在读', rating: 0, cover: '', notes: book.text, noteImgs: [], viewpoints: [], type: '书', platform: '', ts: Date.now() });
    save('books', arr); flash(b, '已加入'); renderLearn();
  }));
}
function initLearn() {
  $('#addBook').addEventListener('click', () => openBookForm());
  $('#aiCfgBtn').addEventListener('click', openAICfg);
  renderLearn();
}
async function renderLearn() {
  const books = load('books', []) || [];
  const covers = await Promise.all((books || []).map((b) => resolveImg(b.cover)));
  const list = $('#bookList'); list.innerHTML = '';
  if (!books.length) list.innerHTML = '<div class="empty">还没有书，点「添加书籍」开始你的学习复盘吧～</div>';
  books.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).forEach((b, i) => {
    const vp = b.viewpoints || []; const keys = vp.filter((v) => v.key).length;
    const c = document.createElement('div'); c.className = 'book-card'; c.dataset.id = b.id;
    c.innerHTML = `<div class="book-cover">${covers[i] ? `<img src="${covers[i]}" alt="">` : '<span class="ph">📕</span>'}</div>
      <div class="book-info">
        <div class="book-title">${escapeHtml(b.title || '未命名')}</div>
        <div class="book-author">${escapeHtml(b.author || '未知作者')} · ${escapeHtml(b.status || '在读')}</div>
        <div class="book-meta">观点 ${vp.length} ｜ 重点 ${keys}${b.rating ? ' ｜ ' + '★'.repeat(b.rating) : ''}</div>
      </div>
      <button class="book-open">查看</button>`;
    list.appendChild(c);
  });
  list.querySelectorAll('.book-card').forEach((card) => card.addEventListener('click', () => openBookDetail(card.dataset.id)));
  renderRecBooks();
  renderLearnInsight();
}
async function renderLearnInsight() {
  const box = $('#learnInsight'); if (!box) return;
  const tasks = load('tasks', []).map(normTask);
  const rev = load('review_' + currentWeek, {}) || {};
  const matches = matchLearningToContext(tasks, rev).filter((m) => m.hit || m.key);
  const cfg = load('ai_cfg', {});
  if (!matches.length) {
    box.innerHTML = `<div class="an-head">📚 观点应用洞察</div><div class="muted">添加书籍并给观点打上「适用标签 / 可用在哪」，这里会实时匹配你当前的<b>每日计划、裁缝素材、选题灵感、周复盘</b>，提示哪些观点可以马上用起来。${cfg && cfg.key ? '' : '（在右上角「⚙️ AI 分析设置」填入 Key 后，可用 AI 深度分析）'}</div>`;
  } else {
    box.innerHTML = `<div class="an-head">📚 观点应用洞察（实时匹配：计划 / 素材 / 灵感 / 复盘）</div>${matches.slice(0, 6).map(viewMatchHtml).join('')}`;
  }
  if (cfg && cfg.key) { box.insertAdjacentHTML('beforeend', '<div style="margin-top:8px"><button class="btn-ghost" id="learnAI">✨ AI 深度分析</button></div>'); const la = $('#learnAI'); if (la) la.addEventListener('click', analyzeLearningAI); }
}
function openBookForm(editId) {
  const books = load('books', []);
  const b = editId ? books.find((x) => x.id === editId) : null;
  const vp = b ? (b.viewpoints || []) : [];
  openModal(`<div class="modal-h">${b ? '编辑书籍' : '添加书籍'}</div>
    <label class="fld">书名 *</label><input id="bkTitle" class="modal-input" value="${escapeHtml(b ? b.title : '')}" placeholder="如：被讨厌的勇气">
    <label class="fld">作者</label><input id="bkAuthor" class="modal-input" value="${escapeHtml(b ? b.author : '')}">
    <label class="fld">类型</label>
    <select id="bkType" class="modal-input"><option ${b && b.type === '线上课程' ? '' : 'selected'}>书</option><option ${b && b.type === '线上课程' ? 'selected' : ''}>线上课程</option></select>
    <label class="fld">平台 / 来源（课程选填，如 B站、得到、Coursera）</label><input id="bkPlatform" class="modal-input" value="${escapeHtml(b ? b.platform : '')}" placeholder="选填">
    <label class="fld">状态</label>
    <select id="bkStatus" class="modal-input"><option ${b && b.status === '在读' ? 'selected' : ''}>在读</option><option ${b && b.status === '已读完' ? 'selected' : ''}>已读完</option></select>
    <label class="fld">评分</label>
    <select id="bkRating" class="modal-input">${[0, 1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${b && b.rating === n ? 'selected' : ''}>${n} 星</option>`).join('')}</select>
    <label class="fld">封面图（可选）</label>
    <input type="file" id="bkCover" accept="image/*" class="modal-file">
    <label class="fld">读书笔记</label>
    <textarea id="bkNotes" class="modal-textarea" placeholder="核心内容、金句、你的感悟…">${escapeHtml(b ? b.notes : '')}</textarea>
    <label class="fld">笔记配图（可选，可多张）</label>
    <input type="file" id="bkNoteImgs" accept="image/*" multiple class="modal-file">
    <div class="modal-actions"><button class="btn-ghost" id="bkCancel">取消</button><button class="btn-primary" id="bkSave">保存</button></div>`);
  $('#bkSave').addEventListener('click', async () => {
    const title = $('#bkTitle').value.trim(); if (!title) { alert('请填写书名'); return; }
    let cover = b ? b.cover : '';
    const coverFile = $('#bkCover').files[0];
    if (coverFile) cover = await new Promise((res) => readImage(coverFile, res));
    let noteImgs = b ? (b.noteImgs || []) : [];
    const niFiles = $('#bkNoteImgs').files;
    if (niFiles && niFiles.length) { for (const f of niFiles) { const d = await new Promise((res) => readImage(f, res)); noteImgs.push(d); } }
    if (cover && cover.indexOf('data:') === 0) cover = await storeImg(cover);
    noteImgs = await storeImgs(noteImgs);
    const obj = { id: b ? b.id : uid(), title, author: $('#bkAuthor').value.trim(), type: $('#bkType').value, platform: $('#bkPlatform').value.trim(), status: $('#bkStatus').value, rating: Number($('#bkRating').value), cover, notes: $('#bkNotes').value, noteImgs, viewpoints: vp, ts: b ? b.ts : Date.now() };
    const arr = load('books', []);
    if (b) { const i = arr.findIndex((x) => x.id === editId); arr[i] = obj; } else arr.push(obj);
    save('books', arr); closeModal(); renderLearn();
  });
  $('#bkCancel').addEventListener('click', closeModal);
}
async function openBookDetail(id) {
  const books = load('books', []);
  const b = books.find((x) => x.id === id); if (!b) return;
  const vp = b.viewpoints || [];
  const cover = await resolveImg(b.cover);
  const noteImgs = await resolveImgs(b.noteImgs || []);
  const vpHtml = vp.length ? vp.map((v) => `<div class="vp ${v.key ? 'key' : ''}">
      <div class="vp-top"><span class="vp-text">${v.key ? '★ ' : ''}${escapeHtml(v.text)}</span>
        <span class="vp-actions"><button class="vp-edit" data-vid="${v.id}">改</button><button class="vp-del" data-vid="${v.id}">删</button></span></div>
      <div class="vp-tags">${(v.tags || []).map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join('') || '<span class="muted">未打标签</span>'}</div>
      ${v.useWhere ? `<div class="vp-use">可用在：${escapeHtml(v.useWhere)}</div>` : ''}
    </div>`).join('') : '<div class="empty">还没有拆解观点，点下方「➕ 添加观点」。</div>';
  openModal(`<div class="modal-h">${escapeHtml(b.title)}</div>
    <div class="book-detail">
      <div class="bd-head">
        <div class="bd-cover">${cover ? `<img src="${cover}" alt="">` : '<span class="ph">📕</span>'}</div>
        <div class="bd-meta">${escapeHtml(b.author || '未知作者')} ｜ ${escapeHtml(b.type || '书')}${b.platform ? ' ｜ ' + escapeHtml(b.platform) : ''} ｜ ${escapeHtml(b.status || '在读')}${b.rating ? ' ｜ ' + '★'.repeat(b.rating) : ''}</div>
      </div>
      <div class="bd-notes">${escapeHtml(b.notes || '（暂无笔记）')}</div>
      ${noteImgs.length ? `<div class="bd-imgs">${noteImgs.filter(Boolean).map((s) => `<img src="${s}" alt="">`).join('')}</div>` : ''}
      <div class="bd-vp-head">🧩 核心观点拆解（${vp.length}）</div>
      <div class="vp-list">${vpHtml}</div>
      <button class="btn-primary" id="vpAdd" style="margin-top:10px;width:100%">➕ 添加观点</button>
      <div class="modal-actions"><button class="btn-ghost" id="bkEdit">编辑书籍</button><button class="btn-ghost" id="bkDel">删除</button><button class="btn-primary" id="bkRead">📖 开始阅读</button><button class="btn-primary" id="bkClose">关闭</button></div>
    </div>`);
  $('#vpAdd').addEventListener('click', () => openVpForm(id, null));
  $('#bkRead').addEventListener('click', () => openReader(b.title, b.notes));
  $('#bkEdit').addEventListener('click', () => openBookForm(id));
  $('#bkDel').addEventListener('click', () => { if (confirm('确定删除《' + b.title + '》？此操作不可恢复。')) { const arr = load('books', []); save('books', arr.filter((x) => x.id !== id)); closeModal(); renderLearn(); } });
  $('#bkClose').addEventListener('click', closeModal);
  openModalVpHandlers(id);
}
function openModalVpHandlers(id) {
  document.querySelectorAll('.vp-edit').forEach((el) => el.addEventListener('click', () => openVpForm(id, el.dataset.vid)));
  document.querySelectorAll('.vp-del').forEach((el) => el.addEventListener('click', () => {
    if (confirm('删除该观点？')) { const arr = load('books', []); const b = arr.find((x) => x.id === id); if (b) { b.viewpoints = (b.viewpoints || []).filter((v) => v.id !== el.dataset.vid); save('books', arr); openBookDetail(id); } }
  }));
}
function openVpForm(id, vid) {
  const books = load('books', []);
  const b = books.find((x) => x.id === id); if (!b) return;
  const v = vid ? (b.viewpoints || []).find((x) => x.id === vid) : null;
  const tags = v ? (v.tags || []) : [];
  openModal(`<div class="modal-h">${v ? '编辑观点' : '添加核心观点'}</div>
    <label class="fld">核心观点 *</label><textarea id="vpText" class="modal-textarea" placeholder="一句话提炼，如：课题分离——只对自己的课题负责">${escapeHtml(v ? v.text : '')}</textarea>
    <label class="fld">适用标签（可多选，用于自动匹配你的计划/工作）</label>
    <div class="vp-tags-pick" id="vpTags">${LEARN_TAGS.map((t) => `<span class="chip-pick ${tags.includes(t) ? 'on' : ''}" data-t="${t}">${t}</span>`).join('')}</div>
    <label class="chk"><input type="checkbox" id="vpKey" ${v && v.key ? 'checked' : ''}> 标记为「重点」（分析中优先展示）</label>
    <label class="fld">可以用在哪？</label><input id="vpUse" class="modal-input" value="${escapeHtml(v ? v.useWhere : '')}" placeholder="如：和情绪化的客户沟通 / 每周复盘时反思">
    <div class="modal-actions"><button class="btn-ghost" id="vpCancel">取消</button><button class="btn-primary" id="vpSave">保存</button></div>`);
  const picked = new Set(tags);
  document.querySelectorAll('#vpTags .chip-pick').forEach((el) => el.addEventListener('click', () => { el.classList.toggle('on'); if (el.classList.contains('on')) picked.add(el.dataset.t); else picked.delete(el.dataset.t); }));
  $('#vpSave').addEventListener('click', () => {
    const text = $('#vpText').value.trim(); if (!text) { alert('请填写观点'); return; }
    const arr = load('books', []); const bb = arr.find((x) => x.id === id); bb.viewpoints = bb.viewpoints || [];
    if (v) { const i = bb.viewpoints.findIndex((x) => x.id === vid); bb.viewpoints[i] = { ...bb.viewpoints[i], text, tags: [...picked], key: $('#vpKey').checked, useWhere: $('#vpUse').value.trim() }; }
    else bb.viewpoints.push({ id: uid(), text, tags: [...picked], key: $('#vpKey').checked, useWhere: $('#vpUse').value.trim() });
    save('books', arr); openBookDetail(id);
  });
  $('#vpCancel').addEventListener('click', () => openBookDetail(id));
}
async function analyzeLearningAI() {
  const books = load('books', []) || [];
  const tasks = load('tasks', []).map(normTask);
  const rev = load('review_' + currentWeek, {}) || {};
  const ctx = JSON.stringify({ tasks, review: rev, books: books.map((b) => ({ title: b.title, viewpoints: (b.viewpoints || []).map((v) => ({ text: v.text, tags: v.tags, useWhere: v.useWhere, key: v.key })) })) }, null, 2);
  const sys = '你是一个读书复盘教练。根据用户读过的书、拆解的观点、当前每日计划与周复盘，指出哪些观点最适合在本周的工作/生活中落地，并给出 2-3 条具体践行建议。中文、简洁、直接。';
  openModal('<div class="modal-h">✨ AI 深度分析</div><div class="modal-loading">正在分析，请稍候…</div>');
  try {
    const r = await callAI([{ role: 'system', content: sys }, { role: 'user', content: ctx }]);
    openModal(`<div class="modal-h">✨ AI 深度分析</div><div class="modal-text">${escapeHtml(r)}</div><div class="modal-actions"><button class="btn-primary" id="mc">知道了</button></div>`);
    $('#mc').addEventListener('click', closeModal);
  } catch (e) { openModal(`<div class="modal-h">⚠️ AI 分析失败</div><div class="modal-text">${escapeHtml(e.message)}</div><div class="modal-actions"><button class="btn-primary" id="mc">关闭</button></div>`); const x = $('#mc'); if (x) x.addEventListener('click', closeModal); }
}

/* ===================== AI 分析设置与通用调用 ===================== */
function loadAICfg() { return load('ai_cfg', {}) || {}; }
function openAICfg() {
  const cfg = loadAICfg();
  openModal(`<div class="modal-h">⚙️ AI 分析设置</div>
    <p class="muted" style="margin:2px 0 10px">默认使用 DeepSeek，兼容 OpenAI 格式。密钥仅保存在你本机浏览器，不会上传到任何服务器。</p>
    <label class="fld">接口地址</label><input id="aiBase" class="modal-input" value="${escapeHtml(cfg.base || 'https://api.deepseek.com/v1/chat/completions')}">
    <label class="fld">模型名</label><input id="aiModel" class="modal-input" value="${escapeHtml(cfg.model || 'deepseek-chat')}">
    <label class="fld">API Key</label><input id="aiKey" class="modal-input" type="password" placeholder="sk-..." value="${escapeHtml(cfg.key || '')}">
    <div class="modal-actions"><button class="btn-ghost" id="aiCancel">取消</button><button class="btn-primary" id="aiSave">保存</button></div>`);
  $('#aiSave').addEventListener('click', () => {
    save('ai_cfg', { base: $('#aiBase').value.trim(), model: $('#aiModel').value.trim(), key: $('#aiKey').value.trim() });
    closeModal(); flash($('#aiCfgBtn'), '已保存');
    if (loadAICfg().key) { const r = $('#aiReview'); if (r) r.style.display = ''; renderLearnInsight(); }
  });
  $('#aiCancel').addEventListener('click', closeModal);
}
function callAI(messages) {
  const cfg = loadAICfg();
  if (!cfg.key) throw new Error('未配置 API Key，请先到「学习复盘 → ⚙️ AI 分析设置」填写。');
  const base = cfg.base || 'https://api.deepseek.com/v1/chat/completions';
  const model = cfg.model || 'deepseek-chat';
  return fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
    body: JSON.stringify({ model, messages, temperature: 0.6, max_tokens: 800 }),
  }).then((r) => r.json().then((j) => {
    if (j.error) throw new Error((j.error.message) || 'API 返回错误');
    return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '（无返回内容）';
  }));
}
/* 视觉模型：传入图片 dataURL，让多模态模型看图估算（仅已配置 API Key 时可用，失败返回 null 以便回落离线估算） */
async function callAIVision(prompt, imageDataUrl) {
  const cfg = loadAICfg();
  if (!cfg.key || !imageDataUrl) return null;
  const base = cfg.base || 'https://api.deepseek.com/v1/chat/completions';
  const model = cfg.model || 'deepseek-chat';
  const messages = [{ role: 'user', content: [
    { type: 'text', text: prompt },
    { type: 'image_url', image_url: { url: imageDataUrl } },
  ] }];
  try {
    const r = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key }, body: JSON.stringify({ model, messages, max_tokens: 400 }) });
    const j = await r.json();
    if (j.error) return null;
    return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || null;
  } catch (e) { return null; }
}

/* ===================== AI 助手（悬浮入口 + 对话） ===================== */
function initAIChat() {
  if (document.getElementById('aiFab')) return;
  const fab = document.createElement('button');
  fab.id = 'aiFab'; fab.className = 'ai-fab'; fab.innerHTML = '🤖';
  fab.title = 'AI 助手';
  fab.addEventListener('click', openAIChat);
  document.body.appendChild(fab);
}
let aiChatHist = [];
function openAIChat() {
  if (document.getElementById('aiChatOv')) return;
  const cfg = loadAICfg();
  const ov = document.createElement('div');
  ov.id = 'aiChatOv'; ov.className = 'ai-chat-ov';
  ov.innerHTML = `<div class="ai-chat">
    <div class="ai-chat-h">🤖 AI 助手 <span class="muted" style="font-weight:400;font-size:12px">${cfg && cfg.key ? '已连接' : '未配置 Key'}</span>
      <button class="ai-chat-x" id="aiChatClose">✕</button></div>
    <div class="ai-chat-body" id="aiChatBody"></div>
    <div class="ai-chat-quick" id="aiChatQuick">
      <button data-q="帮我把这段话润色得更口语化、更有网感：">润色文案</button>
      <button data-q="用三句话总结上面的今日热点，并给我一个可发的选题角度">总结热点</button>
      <button data-q="给我 3 个今天可以拍的短视频/图文选题，方向：手作治愈、女性成长、副业变现">选题灵感</button>
      <button data-q="把这句话翻译成英文，自然口语化：">中英翻译</button>
    </div>
    <div class="ai-chat-input">
      <textarea id="aiChatInput" placeholder="问 AI 任何事：写文案、翻译、总结、规划…（Enter 发送，Shift+Enter 换行）" rows="2"></textarea>
      <button class="btn-primary" id="aiChatSend">发送</button>
    </div>
    <div class="ai-chat-foot"><button class="btn-ghost" id="aiChatCfg">⚙️ AI 设置</button></div>
  </div>`;
  document.body.appendChild(ov);
  const body = $('#aiChatBody');
  const render = () => {
    body.innerHTML = aiChatHist.length ? aiChatHist.map((m) => `<div class="ai-msg ${m.role}">${m.role === 'user' ? '🙋' : '🤖'}<div>${escapeHtml(m.content).replace(/\n/g, '<br>')}</div></div>`).join('') : '<div class="ai-think">嗨～我是你的 AI 助手，可以帮你写文案、翻译、总结、找选题。试试下面的快捷按钮，或直接输入。</div>';
    body.scrollTop = body.scrollHeight;
  };
  render();
  const send = async () => {
    const ta = $('#aiChatInput'); const text = ta.value.trim(); if (!text) return;
    if (!loadAICfg().key) { alert('请先配置 AI Key：学习复盘 → ⚙️ AI 分析设置'); return; }
    aiChatHist.push({ role: 'user', content: text }); ta.value = ''; render();
    const thinking = document.createElement('div'); thinking.className = 'ai-msg assistant'; thinking.innerHTML = '🤖<div class="ai-think">思考中…</div>'; body.appendChild(thinking); body.scrollTop = body.scrollHeight;
    try {
      const sys = { role: 'system', content: '你是「Mickey 工作台」里的全能 AI 助手。用户是一位做裁缝定制/手作/生活内容创作的女生，关心女性成长、副业变现、穿搭审美、英语学习和效率。回答要口语化、有温度、可操作，以中文为主。' };
      const msgs = [sys].concat(aiChatHist.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({ role: m.role, content: m.content })));
      const r = await callAI(msgs);
      aiChatHist.push({ role: 'assistant', content: r });
      thinking.remove(); render();
    } catch (e) { thinking.remove(); aiChatHist.push({ role: 'assistant', content: '（出错了：' + e.message + '）' }); render(); }
  };
  $('#aiChatSend').addEventListener('click', send);
  $('#aiChatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  $('#aiChatClose').addEventListener('click', () => ov.remove());
  ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
  $('#aiChatCfg').addEventListener('click', () => { ov.remove(); openAICfg(); });
  $('#aiChatQuick').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { const ta = $('#aiChatInput'); ta.value = b.dataset.q; ta.focus(); }));
}

/* ===================== 3. 选题每日灵感（含抖音/小红书入口） ===================== */
function initInspiration() {
  const input = $('#ideaInput');
  const add = () => { const text = input.value.trim(); if (!text) return; const list = load('ideas', []); list.unshift({ id: uid(), text, ts: Date.now() }); save('ideas', list); input.value = ''; renderInspiration(); };
  $('#ideaAdd').addEventListener('click', add);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  $('#hotRefresh').addEventListener('click', () => renderHotTopics());
  $('#aiTopics').addEventListener('click', genAiTopics);
  $('#hotList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-save-hot]'); if (!b) return;
    const list = load('ideas', []); list.unshift({ id: uid(), text: b.dataset.saveHot, ts: Date.now() }); save('ideas', list); renderInspiration(); flash(b, '已存');
  });
  renderHotTopics();
  renderInspiration();
}
const HOT_POOL = [
  { t: '普通人的一天 vlog｜真实记录治愈感拉满', tag: '小红书' },
  { t: '10 元挑战 citywalk｜宝藏路线大公开', tag: '抖音' },
  { t: '小个子显高穿搭公式｜照着穿不出错', tag: '小红书' },
  { t: '旧衣服改造计划｜0 成本焕新衣橱', tag: '抖音' },
  { t: '手作慢生活｜一针一线的治愈瞬间', tag: '小红书' },
  { t: '副业月入 3000 的 5 个低门槛路子', tag: '通用' },
  { t: '裁缝日常｜接单到发货全流程拆解', tag: '抖音' },
  { t: '今日穿搭灵感｜通勤也能很出片', tag: '小红书' },
  { t: '摆摊日记｜线下市集一天能赚多少', tag: '抖音' },
  { t: '一人食｜低卡又好做的减脂餐', tag: '小红书' },
  { t: '新手缝纫入门｜5 件必买工具清单', tag: '通用' },
  { t: '周末去哪玩｜小众目的地种草', tag: '小红书' },
  { t: '改造闲置布料｜碎布也能变艺术品', tag: '抖音' },
  { t: '情绪价值拉满的 30 天自律打卡', tag: '通用' },
  { t: '面料科普｜怎么挑不踩雷的好布料', tag: '小红书' },
  { t: '下班后的两小时｜把爱好做成小生意', tag: '抖音' },
  { t: '租房改造｜租来的家也能很高级', tag: '小红书' },
  { t: '通勤穿搭 7 天不重样｜懒人公式', tag: '小红书' },
  { t: '手工定制｜私服改衣如何溢价接单', tag: '抖音' },
  { t: '0 基础学裁剪｜第一个作品做什么', tag: '通用' },
  { t: '副业避坑｜这 5 种兼职千万别碰', tag: '通用' },
  { t: '极简衣橱｜30 件单品搭出一个月', tag: '小红书' },
  { t: '宝妈重启事业｜从兴趣到小店', tag: '通用' },
  { t: '旧物新生｜针线活里的环保主义', tag: '抖音' },
  { t: '今日金句海报｜治愈系文案怎么写', tag: '小红书' },
  { t: '直播带货幕后｜一件衣服的链路', tag: '抖音' },
  { t: '轻食备餐｜周日 1 小时搞定整周', tag: '小红书' },
  { t: '量体定制科普｜为什么合身这么难', tag: '通用' },
  { t: '摆摊选品｜什么最好卖又不压货', tag: '抖音' },
  { t: '自律 vlog｜把日子过成想要的样子', tag: '小红书' },
  { t: '二手布料市场｜淘货攻略与避坑', tag: '通用' },
  { t: '送礼清单｜平价但有心意的 20 样', tag: '通用' },
  { t: '旗袍改良｜传统与日常的边界', tag: '小红书' },
  { t: '技能变现｜你会的不起眼本事能赚钱', tag: '通用' },
  { t: '周末市集探店｜哪个摊位最出片', tag: '抖音' },
  { t: '情绪日记｜和焦虑和平相处', tag: '通用' },
  { t: '穿搭色彩学｜黄黑皮显白配色', tag: '小红书' },
  { t: '接单话术｜客户说贵怎么回', tag: '抖音' },
  { t: '低成本创业｜先别辞职的 3 个理由', tag: '通用' },
];
function renderHotTopics(forceAi) {
  const dateEl = $('#hotDate'); if (dateEl) dateEl.textContent = '· ' + fmtDate(new Date());
  // 优先展示当日 AI 生成的专属选题（按日期缓存）
  const aiKey = 'ai_topics_' + todayStr();
  const aiCache = load(aiKey, null);
  if (aiCache && aiCache.length && !forceAi) {
    $('#hotList').innerHTML = aiCache.map((t) => `<div class="hot-item">
      <span class="hot-tag hot-ai">AI</span>
      <span class="hot-title">${escapeHtml(t)}</span>
      <button class="mini-btn" data-save-hot="${escapeHtml(t)}">存为灵感</button>
    </div>`).join('');
    return;
  }
  // 否则按「日期种子」确定性洗牌，保证每天换一批、同一天稳定
  const pool = [...HOT_POOL];
  let s = dateSeed(todayStr()) || 1;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const pick = pool.slice(0, 6);
  $('#hotList').innerHTML = pick.map((h) => `<div class="hot-item">
    <span class="hot-tag hot-${h.tag === '通用' ? 'g' : h.tag === '抖音' ? 'd' : 'x'}">${h.tag}</span>
    <span class="hot-title">${escapeHtml(h.t)}</span>
    <button class="mini-btn" data-save-hot="${escapeHtml(h.t)}">存为灵感</button>
  </div>`).join('');
}
async function genAiTopics() {
  const cfg = loadAICfg();
  if (!cfg.key) { alert('还没配置 AI Key。请到「学习复盘 → ⚙️ AI 分析设置」填写 DeepSeek Key 后即可用 AI 生成当日专属灵感。'); return; }
  const btn = $('#aiTopics'); if (btn) { btn.disabled = true; btn.textContent = '生成中…'; }
  try {
    const r = await callAI([
      { role: 'system', content: '你是擅长内容选题的创意教练，面向一位做裁缝定制/手作/生活分享的创作者。' },
      { role: 'user', content: '请给我 6 个今天适合创作的短视频/图文选题，结合「女性成长、手作治愈、副业变现、穿搭」方向。每条一行，只给标题，不要编号和解释。' },
    ]);
    const list = r.split('\n').map((x) => x.replace(/^[\d\.、\-\s]+/, '').trim()).filter(Boolean).slice(0, 6);
    if (list.length) { save('ai_topics_' + todayStr(), list); renderHotTopics(true); }
  } catch (e) { alert('AI 生成失败：' + e.message); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '✨ 智能生成'; } }
}
async function genAiBooks() {
  const cfg = loadAICfg();
  if (!cfg.key) { alert('还没配置 AI Key。请到「学习复盘 → ⚙️ AI 分析设置」填写 DeepSeek Key 后即可用 AI 荐书。'); return; }
  const box = $('#recAiBox'); if (!box) return;
  box.style.display = '';
  box.innerHTML = '<div class="ai-think">🤖 AI 正在为你挑书…</div>';
  try {
    const r = await callAI([
      { role: 'system', content: '你是私人阅读顾问，面向一位做裁缝定制/手作/生活分享、关注女性成长与副业变现的创作者。' },
      { role: 'user', content: '请推荐今天值得读的 3 本书（虚构或非虚构皆可），贴合「女性成长、手作治愈、副业变现、穿搭审美、AI 工具」方向。\n每行格式：书名 | 一句话推荐理由。只输出内容，不要序号外的多余说明。' },
    ]);
    const list = r.split('\n').map((x) => x.trim()).filter(Boolean).map((line) => { const p = line.split('|'); return { title: (p[0] || '').replace(/^[\d\.、\-\s]+/, '').trim(), why: (p[1] || '').trim() }; }).filter((b) => b.title);
    if (!list.length) { box.innerHTML = '<div class="ai-think">AI 没有返回有效书目，换种问法再试～</div>'; return; }
    box.innerHTML = '<div class="ai-digest"><div class="ai-digest-h">🤖 AI 今日荐书</div>' + list.map((b) => `<div class="rec-ai-item"><b>${escapeHtml(b.title)}</b><span>${escapeHtml(b.why)}</span></div>`).join('') + '</div>';
  } catch (e) { box.innerHTML = '<div class="ai-think">AI 荐书失败：' + escapeHtml(e.message) + '</div>'; }
}
function renderInspiration() {
  const list = load('ideas', []); const box = $('#ideaList'); box.innerHTML = '';
  if (!list.length) { box.innerHTML = '<div class="empty">还没有灵感，记录第一个吧～</div>'; return; }
  list.forEach((it) => {
    const d = new Date(it.ts);
    const c = document.createElement('div'); c.className = 'item-card';
    c.innerHTML = `<div class="ic-top"><span class="ic-date">${fmtDate(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}</span><button class="ic-del" data-id="${it.id}">×</button></div><div class="ic-body">${escapeHtml(it.text)}</div>`;
    box.appendChild(c);
  });
  box.querySelectorAll('.ic-del').forEach((b) => b.addEventListener('click', () => { save('ideas', load('ideas', []).filter((x) => x.id !== b.dataset.id)); renderInspiration(); }));
}

/* ===================== 4. 裁缝日记 ===================== */
const TAILOR_TABS = [
  { v: 'mgallery', t: '物料图库' }, { v: 'pgallery', t: '成品档案' },
  { v: 'sales', t: '销售数据' }, { v: 'warn', t: '库存预警' }, { v: 'tutorial', t: '教程推荐' },
];
const SALE_CHANNELS = ['小红书', '微信', '线下', '抖音'];
const state = { tailorTab: 'mgallery' };
const EXPENSE_CATS = ['吃饭', '交通', '娱乐', '羽毛球', '台球', '下午茶', '裁缝物料', '转账', '话费', '宠物', '其他'];

function initTailor() {
  migrateMaterials();
  migrateMaterialCodes();
  migrateImages();
  const tabs = $('#tailorTabs');
  if (!tabs.dataset.bound) {
    tabs.addEventListener('click', (e) => { const b = e.target.closest('.subtab'); if (!b) return; state.tailorTab = b.dataset.view; renderTailor(); });
    tabs.dataset.bound = '1';
  }
  const ex = $('#tailorExport');
  if (ex && !ex.dataset.bound) {
    ex.dataset.bound = '1';
    ex.addEventListener('click', exportTailor);
    $('#tailorImport').addEventListener('click', () => $('#tailorImportFile').click());
    $('#tailorImportFile').addEventListener('change', (e) => { if (e.target.files[0]) importTailor(e.target.files[0]); e.target.value = ''; });
  }
  renderTailor();
}
function renderTailor() {
  $('#tailorTabs').innerHTML = TAILOR_TABS.map((t) => `<button class="subtab${t.v === state.tailorTab ? ' active' : ''}" data-view="${t.v}">${t.t}</button>`).join('');
  const body = $('#tailorBody');
  const map = { mgallery: renderMaterialGallery, pgallery: renderProductGallery, sales: renderSales, warn: renderWarn, tutorial: renderTutorial };
  (map[state.tailorTab] || renderMaterialGallery)(body);
  checkStockBanner();
}

/* 批量导出 / 导入备份（裁缝全模块：物料 + 成品 + 销售） */
async function exportTailor() {
  const materials = await Promise.all(load('materials', []).map(async (m) => ({ ...m, photo: await resolveImg(m.photo) })));
  const samples = await Promise.all(load('samples', []).map(async (s) => ({ ...s, photos: await resolveImgs(s.photos) })));
  const data = {
    _type: 'mickey-tailor-backup', _version: 2, _exportedAt: new Date().toISOString(),
    materials, samples, sales: load('sales', []),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'mickey-tailor-' + todayStr() + '.json';
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
}
async function importTailor(file) {
  const r = new FileReader();
  r.onload = () => {
    (async () => {
      try {
        const d = JSON.parse(r.result);
        if (!d || d._type !== 'mickey-tailor-backup') throw new Error('不是有效的裁缝备份文件');
        if (!confirm('导入会覆盖当前全部裁缝数据（物料 / 成品 / 销售），确定继续？')) return;
        const materials = await Promise.all((Array.isArray(d.materials) ? d.materials : []).map(async (m) => ({ ...m, photo: (m.photo && isImgLinkOrData(m.photo)) ? (m.photo.indexOf('data:') === 0 ? await storeImg(m.photo) : m.photo) : '' })));
        const samples = await Promise.all((Array.isArray(d.samples) ? d.samples : []).map(async (s) => ({ ...s, photos: await Promise.all((s.photos || []).map((p) => (p && isImgLinkOrData(p)) ? (p.indexOf('data:') === 0 ? storeImg(p) : Promise.resolve(p)) : Promise.resolve(''))) })));
        save('materials', materials); save('samples', samples); save('sales', Array.isArray(d.sales) ? d.sales : []);
        renderTailor(); checkStockBanner();
        alert('裁缝数据导入成功 ✅');
      } catch (e) { alert('导入失败：' + e.message); }
    })();
  };
  r.readAsText(file);
}

/* 通用弹窗 */
function openModal(html) {
  closeModal();
  const ov = document.createElement('div'); ov.className = 'modal-ov'; ov.id = 'modalOv';
  ov.innerHTML = `<div class="modal">${html}<button class="modal-close" id="modalClose" aria-label="关闭">×</button></div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', (e) => { if (e.target === ov || e.target.id === 'modalClose') closeModal(); });
}
function closeModal() { const o = document.getElementById('modalOv'); if (o) o.remove(); }

/* 物料分类 → 编号序列（布料A / 边料B / 零件材料C / 辅料F / 盲盒布料D） */
const MAT_CATS = ['布料', '边料', '零件材料', '辅料', '盲盒布料'];
const MAT_CAT_CODE = { '布料': 'A', '边料': 'B', '零件材料': 'C', '辅料': 'F', '盲盒布料': 'D' };
function nextMaterialCode(cat, list) {
  const code = MAT_CAT_CODE[cat] || 'X';
  let max = 0;
  (list || load('materials', [])).forEach((m) => { const mt = (m.code || '').match(/^([A-Z])(\d+)$/); if (mt && mt[1] === code) max = Math.max(max, parseInt(mt[2], 10)); });
  return code + String(max + 1).padStart(3, '0');
}
function matKey(m) { return (m.cat || '') + '|' + (m.name || '') + '|' + (m.spec || ''); }
function materialTotalStock(key) { return load('materials', []).filter((m) => matKey(m) === key).reduce((s, m) => s + Number(m.qty || 0), 0); }
/* 旧数据迁移：price/stock → total/qty，并补 pdate */
function migrateMaterials() {
  const list = load('materials', []);
  let changed = false;
  list.forEach((m) => {
    if (m.stock !== undefined && m.qty === undefined) { m.qty = Number(m.stock) || 0; delete m.stock; changed = true; }
    if (m.price !== undefined && m.total === undefined) { m.total = (Number(m.price) || 0) * (Number(m.qty) || 0); delete m.price; changed = true; }
    if (m.pdate === undefined) { m.pdate = ''; changed = true; }
  });
  if (changed) save('materials', list);
}
/* 旧数据迁移：给没有采购编号的物料，按分类补一个正规编号（A/B/C/F/D 序列，仅执行一次） */
function migrateMaterialCodes() {
  if (load('codes_migrated', false)) return;
  const list = load('materials', []);
  let changed = false;
  list.forEach((m) => { if (!m.code) { m.code = nextMaterialCode(m.cat, list); changed = true; } });
  if (changed) save('materials', list);
  save('codes_migrated', true);
}
/* 整理编号：保留已有的、不重复的有效编号；把空编号 / 重复编号按分类重新续成 A001/A002…（不改动成品档案里按 id 的关联） */
function renumberMaterials() {
  const list = load('materials', []);
  if (!list.length) return false;
  const used = {};
  let changed = false;
  const sorted = list.slice().sort(matCodeSort);
  for (const m of sorted) {
    const mt = (m.code || '').match(/^([A-Z])(\d+)$/);
    if (mt && !used[m.code]) { used[m.code] = true; continue; }   // 已有且唯一的编号，保留
    const code = MAT_CAT_CODE[m.cat] || 'X';
    let n = 1;
    while (used[code + String(n).padStart(3, '0')]) n++;
    m.code = code + String(n).padStart(3, '0');
    used[m.code] = true;
    changed = true;
  }
  if (changed) { save('materials', list); renderTailor(); }
  return changed;
}
/* 旧数据迁移：把 localStorage 里遗留的 base64 图片挪进 IndexedDB（仅执行一次） */
async function migrateImages() {
  if (load('imgs_migrated', false)) return;
  try {
    const mats = load('materials', []);
    let changed = false;
    for (const m of mats) { if (m.photo && ('' + m.photo).indexOf('data:') === 0) { m.photo = await storeImg(m.photo); changed = true; } }
    const samples = load('samples', []);
    for (const s of samples) { if (s.photos && s.photos.length) { s.photos = await Promise.all(s.photos.map((p) => (p && ('' + p).indexOf('data:') === 0) ? storeImg(p) : Promise.resolve(p))); changed = true; } }
    if (changed) { save('materials', mats); save('samples', samples); }
    save('imgs_migrated', true);
  } catch (e) { save('imgs_migrated', true); } /* 失败也标记，避免反复重试 */
}

/* 年月日下拉 */
function dateSelects(prefix, val) {
  const cur = new Date();
  const parts = (val || '').split('-');
  const y0 = parts[0] || cur.getFullYear();
  const m0 = parts[1] || String(cur.getMonth() + 1).padStart(2, '0');
  const d0 = parts[2] || String(cur.getDate()).padStart(2, '0');
  let ys = ''; for (let yr = cur.getFullYear() - 5; yr <= cur.getFullYear() + 1; yr++) ys += `<option ${yr == y0 ? 'selected' : ''}>${yr}</option>`;
  let ms = ''; for (let i = 1; i <= 12; i++) { const v = String(i).padStart(2, '0'); ms += `<option ${v == m0 ? 'selected' : ''}>${v}</option>`; }
  let ds = ''; for (let i = 1; i <= 31; i++) { const v = String(i).padStart(2, '0'); ds += `<option ${v == d0 ? 'selected' : ''}>${v}</option>`; }
  return `<div class="grid-3"><div><label>年</label><select id="${prefix}_y">${ys}</select></div><div><label>月</label><select id="${prefix}_m">${ms}</select></div><div><label>日</label><select id="${prefix}_d">${ds}</select></div></div>`;
}

/* CSV 解析 / 模板下载 / 批量导入 */
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
    else { if (c === '"') inQ = true; else if (c === ',') { row.push(field); field = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; } else field += c; }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}
function csvCell(v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function downloadText(filename, content, mime) {
  const blob = new Blob(['\uFEFF' + content], { type: mime || 'text/plain;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
}
function pickFile(accept, cb) { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = accept; inp.onchange = (e) => { if (e.target.files[0]) cb(e.target.files[0]); }; inp.click(); }
function pickFiles(accept, cb) { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = accept; inp.multiple = true; inp.onchange = (e) => { if (e.target.files.length) cb([...e.target.files]); }; inp.click(); }

function downloadMaterialTemplate() {
  const headers = ['采购分类', '采购编号', '品名', '材质/规格/颜色', '供应渠道', '单位', '采购时间(YYYY-MM-DD)', '采购单价', '采购数量', '采购总价', '安全库存', '采购备注', '图片'];
  const sample = ['布料', '', '纯棉布料', '棉 1.5m / 藏青', '淘宝店', '米', todayStr(), '50', '5', '250', '2', '色号#3 物流3天', ''];
  downloadText('mickey-物料模板.csv', headers.map(csvCell).join(',') + '\n' + sample.map(csvCell).join(','), 'text/csv;charset=utf-8');
}
function downloadProductTemplate() {
  const headers = ['编号', '名字', '分类', '关联原材料(编号或名字,逗号分隔)', '用料数据', '花费', '工时', '人工', '建议卖价', '状态'];
  const sample = ['P001', '碎花裙', '裙装', 'A001,纯棉布料', '2米', '30', '3', '20', '120', '成品样品'];
  downloadText('mickey-成品模板.csv', headers.map(csvCell).join(',') + '\n' + sample.map(csvCell).join(','), 'text/csv;charset=utf-8');
}
function importMaterialsFlow() {
  pickFile('text/csv,.csv', (csvFile) => {
    const r = new FileReader();
    r.onload = () => {
      const text = r.result;
      const rows = parseCSV(text);
      const headers = rows[0] || [];
      const idx = (h) => headers.findIndex((x) => x.trim() === h);
      const getv = (row, h) => { const i = idx(h); return i >= 0 ? (row[i] || '').trim() : ''; };
      const hasImg = headers.some((h) => h.trim() === '图片');
      const needFiles = hasImg && rows.slice(1).some((row) => { const v = getv(row, '图片'); return v && !/^(https?:|data:)/i.test(v); });
      if (!needFiles) { doImportMaterials(text, {}); return; }
      if (!confirm('检测到图片列含文件名，是否选择本地图片文件一并导入？\n（取消则仅按图片链接导入，文件名无法匹配）')) { doImportMaterials(text, {}); return; }
      pickFiles('image/*', (files) => {
        let pending = files.length; const map = {};
        if (!pending) { doImportMaterials(text, {}); return; }
        files.forEach((f) => readImage(f, (d) => { map[f.name] = d; if (--pending === 0) doImportMaterials(text, map); }));
      });
    };
    r.readAsText(csvFile);
  });
}
async function doImportMaterials(text, imgMap) {
  try {
    const rows = parseCSV(text); const headers = rows.shift();
    const idx = (h) => headers.findIndex((x) => x.trim() === h);
    const get = (row, h) => { const i = idx(h); return i >= 0 ? (row[i] || '').trim() : ''; };
    const list = load('materials', []); let added = 0, imgUsed = 0;
    const newItems = [];
    rows.forEach((row) => {
      const cat = get(row, '采购分类'); if (!cat) return;
      let code = get(row, '采购编号'); if (!code) code = nextMaterialCode(cat, list);
      const qty = parseFloat(get(row, '采购数量')) || 0;
      let unitPrice = parseFloat(get(row, '采购单价')) || 0;
      let total = parseFloat(get(row, '采购总价')) || 0;
      if (!total && unitPrice && qty) total = unitPrice * qty;
      if (!unitPrice && total && qty) unitPrice = total / qty;
      let photo = '';
      const imgVal = get(row, '图片');
      if (imgVal) { if (/^(https?:|data:)/i.test(imgVal)) photo = imgVal; else if (imgMap[imgVal]) photo = imgMap[imgVal]; }
      if (photo) imgUsed++;
      const item = { id: uid(), code, cat, name: get(row, '品名'), spec: get(row, '材质/规格/颜色'), sup: get(row, '供应渠道'), unit: get(row, '单位'), pdate: get(row, '采购时间(YYYY-MM-DD)'), qty, total: total.toFixed(2), unitPrice: unitPrice.toFixed(2), safety: parseFloat(get(row, '安全库存')) || 0, note: get(row, '采购备注'), photo };
      newItems.push(item);
      list.unshift(item);   // 立即并入，使同一批次后续行能接着自动编号（避免出现重复的 001）
      added++;
    });
    if (!added) throw new Error('没有有效行（需含「采购分类」列）');
    /* 本地图片（data:）存入 IndexedDB，避免膨胀 localStorage */
    for (const m of newItems) { if (m.photo && m.photo.indexOf('data:') === 0) { try { m.photo = await storeImg(m.photo); } catch (e) { m.photo = ''; } } }
    save('materials', list); renderTailor(); checkStockBanner();
    alert('成功导入 ' + added + ' 条物料' + (imgUsed ? '，其中 ' + imgUsed + ' 张图片已附加 ✅' : ' ✅'));
  } catch (e) { alert('导入失败：' + e.message); }
}
function resolveMatIds(str) {
  const mats = load('materials', []);
  return str.split(/[,，]/).map((s) => s.trim()).filter(Boolean).map((t) => { const m = mats.find((x) => x.code === t) || mats.find((x) => x.name === t); return m ? m.id : t; });
}
function importProductsCSV(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const rows = parseCSV(r.result); const headers = rows.shift();
      const idx = (h) => headers.findIndex((x) => x.trim() === h);
      const get = (row, h) => { const i = idx(h); return i >= 0 ? (row[i] || '').trim() : ''; };
      const list = load('samples', []); let added = 0;
      rows.forEach((row) => {
        const name = get(row, '名字'); if (!name) return;
        list.unshift({ id: uid(), code: get(row, '编号'), name, cat: get(row, '分类'), photos: [], materialIds: resolveMatIds(get(row, '关联原材料(编号或名字,逗号分隔)')), usage: get(row, '用料数据'), cost: parseFloat(get(row, '花费')) || 0, hours: parseFloat(get(row, '工时')) || 0, labor: parseFloat(get(row, '人工')) || 0, price: parseFloat(get(row, '建议卖价')) || 0, status: get(row, '状态') || '成品样品' });
        added++;
      });
      if (!added) throw new Error('没有有效行（需含「名字」列）');
      save('samples', list); renderTailor();
      alert('成功导入 ' + added + ' 条成品 ✅');
    } catch (e) { alert('导入失败：' + e.message); }
  };
  r.readAsText(file);
}

/* ---- 4.1 物料图库 ---- */
function matCodeSort(a, b) {
  const pa = (a.code || '').match(/^([A-Za-z]+)(\d+)$/);
  const pb = (b.code || '').match(/^([A-Za-z]+)(\d+)$/);
  if (!pa && !pb) return 0;
  if (!pa) return 1;
  if (!pb) return -1;
  if (pa[1] !== pb[1]) return pa[1] < pb[1] ? -1 : 1;
  return parseInt(pa[2], 10) - parseInt(pb[2], 10);
}
async function renderMaterialGallery(body) {
  const list = load('materials', []).sort(matCodeSort);
  const cards = list.length ? await Promise.all(list.map(async (m) => {
    const src = await resolveImg(m.photo);
    return `<div class="mat-row" data-mat="${m.id}">
    ${src ? `<img src="${src}" class="mr-img" alt="">` : `<div class="mr-ph">🧵</div>`}
    <div class="mr-info">
      <div class="mr-name">${m.code ? `<span class="seq">${escapeHtml(m.code)}</span>` : ''}${escapeHtml(m.name || '未命名')}</div>
      <div class="mr-sub">${escapeHtml(m.cat || '未分类')}${m.spec ? ' · ' + escapeHtml(m.spec) : ''}</div>
    </div>
    <div class="mr-stock">库存 ${Number(m.qty || 0)}${m.unit ? ' ' + escapeHtml(m.unit) : ''}</div>
    <div class="mr-acts">
      <button class="mini-btn mr-edit" data-id="${m.id}">修改</button>
      <button class="mini-btn mr-del" data-id="${m.id}">删除</button>
    </div>
  </div>`;
  })) : '<div class="empty">还没有物料，点左上角 ＋ 添加～</div>';
  const prods = load('samples', []);
  const totalInvest = list.reduce((s, m) => s + Number(m.total || 0), 0);
  const usedCost = prods.reduce((s, p) => s + Number(p.cost || 0), 0);
  const remainCost = totalInvest - usedCost;
  const costCard = `<div class="card"><h3>💰 物料成本概览</h3><div class="summary" style="margin-bottom:0">
    <div class="sum-box"><div class="muted">总投入成本</div><div class="v">${money(totalInvest)}</div><div class="muted">库存总价值</div></div>
    <div class="sum-box"><div class="muted">已使用成本</div><div class="v">${money(usedCost)}</div><div class="muted">成品耗用材料</div></div>
    <div class="sum-box"><div class="muted">剩余未使用</div><div class="v"${remainCost < 0 ? ' style="color:#C0395A"' : ''}>${money(remainCost)}</div><div class="muted">未动用</div></div>
  </div></div>`;
  body.innerHTML = costCard + `    <div class="gal-tools">
      <button class="btn-ghost" id="matTpl">⬇️ 下载模板</button>
      <button class="btn-ghost" id="matImp">⬆️ 批量导入</button>
      <button class="btn-ghost" id="matRenumber">🔢 整理编号</button>
    </div>
    <div class="muted" style="font-size:12px;margin:0 0 12px">💡 批量导入：CSV「图片」列填 <b>图片链接</b> 或 <b>文件名</b>；若填文件名，导入时请在弹窗选择对应图片文件即可自动匹配。</div>
    <button class="fab-plus" id="matAdd" title="新增物料">＋</button>
    <div class="mat-rows" style="margin-top:6px">${cards}</div>`;
  $('#matAdd').addEventListener('click', openMaterialForm);
  $('#matTpl').addEventListener('click', downloadMaterialTemplate);
  $('#matImp').addEventListener('click', importMaterialsFlow);
  $('#matRenumber').addEventListener('click', () => {
    if (!confirm('将按分类把空编号 / 重复编号重新续成 A001、B001…（已有的唯一编号会保留）。继续？')) return;
    const ch = renumberMaterials();
    flash($('#matRenumber'), ch ? '已整理' : '无需整理');
  });
  body.querySelectorAll('.mr-edit').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); openMaterialForm(b.dataset.id); }));
  body.querySelectorAll('.mr-del').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const m = load('materials', []).find((x) => x.id === b.dataset.id) || {};
    if (confirm('确定删除「' + (m.name || m.code || '该物料') + '」？此操作不可恢复。')) { save('materials', load('materials', []).filter((x) => x.id !== b.dataset.id)); renderTailor(); checkStockBanner(); }
  }));
  body.querySelectorAll('[data-mat]').forEach((c) => c.addEventListener('click', () => openMaterialDetail(c.dataset.mat)));
}
async function openMaterialForm(editId) {
  const editM = editId ? load('materials', []).find((x) => x.id === editId) : null;
  const v = (x) => (x == null ? '' : x);
  const initPhoto = (editM && editM.photo) ? await resolveImg(editM.photo) : '';
  const cats = MAT_CATS.map((c) => `<option ${editM && editM.cat === c ? 'selected' : ''}>${c}</option>`).join('');
  openModal(`<h3>${editM ? '✏️ 修改物料' : '➕ 新增物料'}</h3>
    <label>采购时间</label>${dateSelects('m_p', editM ? editM.pdate : todayStr())}
    <div class="grid-2"><div><label>采购分类</label><select id="m_cat">${cats}</select></div><div><label>采购编号</label><input id="m_code" value="${escapeHtml(v(editM && editM.code))}"></div></div>
    <label>品名</label><input id="m_name" value="${escapeHtml(v(editM && editM.name))}" placeholder="如 纯棉布料">
    <label>材质/规格/颜色</label><input id="m_spec" value="${escapeHtml(v(editM && editM.spec))}" placeholder="棉 1.5m / 藏青">
    <label>供应渠道</label><input id="m_sup" value="${escapeHtml(v(editM && editM.sup))}" placeholder="供应商/店铺">
    <label>单位</label><input id="m_unit" value="${escapeHtml(v(editM && editM.unit))}" placeholder="米/个">
    <div class="grid-3"><div><label>采购单价(元)</label><input id="m_unitprice" type="number" min="0" step="0.01" value="${v(editM && editM.unitPrice)}"></div><div><label>采购数量</label><input id="m_qty" type="number" min="0" step="0.01" value="${v(editM && editM.qty)}"></div><div><label>采购总价(自动)</label><input id="m_total" readonly placeholder="自动算"></div></div>
    <label>安全库存</label><input id="m_safe" type="number" min="0" step="0.01" value="${v(editM && editM.safety)}">
    <label>物料图片</label>${initPhoto ? `<img class="modal-img" src="${initPhoto}" style="margin-bottom:8px"><div class="muted" style="font-size:12px;margin-bottom:6px">重新选图则替换，留空则保留原图</div>` : ''}<input id="m_photo" type="file" accept="image/*">
    <label>备注</label><input id="m_note" value="${escapeHtml(v(editM && editM.note))}" placeholder="选填 色号/物流周期">
    <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn-ghost" id="m_cancel">取消</button><button class="btn-primary" id="m_save">${editM ? '保存修改' : '保存'}</button></div>`);
  let photo = initPhoto; let photoChanged = false;
  $('#m_photo').addEventListener('change', (e) => { if (e.target.files[0]) readImage(e.target.files[0], (d) => { photo = d; photoChanged = true; }); });
  const catSel = $('#m_cat');
  if (!editM) {
    const fillCode = () => { $('#m_code').value = nextMaterialCode(catSel.value); };
    fillCode();
    catSel.addEventListener('change', fillCode);
  }
  const calc = () => { const u = parseFloat($('#m_unitprice').value) || 0; const q = parseFloat($('#m_qty').value) || 0; $('#m_total').value = (u && q) ? (u * q).toFixed(2) : ''; };
  $('#m_unitprice').addEventListener('input', calc); $('#m_qty').addEventListener('input', calc);
  if (editM) calc();
  $('#m_cancel').addEventListener('click', closeModal);
  $('#m_save').addEventListener('click', async () => {
    const g = (id) => $(id).value.trim();
    const pdate = `${$('#m_p_y').value}-${$('#m_p_m').value}-${$('#m_p_d').value}`;
    const unitPrice = parseFloat(g('#m_unitprice')) || 0; const qty = parseFloat(g('#m_qty')) || 0;
    /* 图片：未改则保留原引用；改了且是本地图(data:)则存入 IndexedDB 取回 id，链接原样保留 */
    let photoRef = editM ? editM.photo : '';
    if (photoChanged) {
      if (photo.indexOf('data:') === 0) { try { photoRef = await storeImg(photo); } catch (e) { photoRef = editM ? editM.photo : ''; } }
      else photoRef = photo;
    }
    const base = { code: g('#m_code'), cat: g('#m_cat'), name: g('#m_name'), spec: g('#m_spec'), sup: g('#m_sup'), unit: g('#m_unit'), safety: parseFloat(g('#m_safe')) || 0, photo: photoRef, pdate, qty, total: (unitPrice * qty).toFixed(2), unitPrice: unitPrice.toFixed(2), note: g('#m_note') };
    if (!base.name && !base.code) return flash($('#m_save'), '填品名或编号');
    const list = load('materials', []);
    if (editM) { const idx = list.findIndex((x) => x.id === editId); if (idx >= 0) { base.id = editId; list[idx] = base; } }
    else { base.id = uid(); list.unshift(base); }
    save('materials', list); closeModal(); renderTailor(); checkStockBanner();
    if ('Notification' in window && Notification.permission !== 'denied') Notification.requestPermission();
  });
}
async function openMaterialDetail(id) {
  const m = load('materials', []).find((x) => x.id === id); if (!m) return;
  const photo = await resolveImg(m.photo);
  const total = Number(m.total || 0);
  const qty = Number(m.qty || 0);
  const unit = Number(m.unitPrice || (qty ? total / qty : 0)).toFixed(2);
  const totalStock = materialTotalStock(matKey(m));
  const low = qty < Number(m.safety);
  const specColor = m.spec || (m.color ? '颜色：' + m.color : '') || '—';
  openModal(`<h3>🧷 物料详情</h3>
    ${photo ? `<img class="modal-img" src="${photo}">` : ''}
    <div class="kv"><span>采购编号</span><b>${escapeHtml(m.code || '—')}</b></div>
    <div class="kv"><span>采购分类</span><b>${escapeHtml(m.cat || '—')}</b></div>
    <div class="kv"><span>品名</span><b>${escapeHtml(m.name || '—')}</b></div>
    <div class="kv"><span>材质/规格/颜色</span><b>${escapeHtml(specColor)}</b></div>
    <div class="kv"><span>供应渠道</span><b>${escapeHtml(m.sup || '—')}</b></div>
    <div class="kv"><span>单位</span><b>${escapeHtml(m.unit || '—')}</b></div>
    <div class="kv"><span>采购时间</span><b>${escapeHtml(m.pdate || '—')}</b></div>
    <div class="kv"><span>采购单价</span><b>${money(unit)}</b></div>
    <div class="kv"><span>采购数量</span><b>${qty}</b></div>
    <div class="kv"><span>采购总价</span><b>${money(total)}</b></div>
    <div class="kv"><span>总的库存（同类合计）</span><b>${totalStock}</b></div>
    <div class="kv"><span>安全库存</span><b>${Number(m.safety || 0)}</b></div>
    <div class="kv"><span>库存状态</span><b><span class="pill ${low ? 'pill-low' : 'pill-ok'}">${low ? '库存紧缺' : '库存充足'}</span></b></div>
    <div class="kv"><span>备注</span><b>${escapeHtml(m.note || '—')}</b></div>
    <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="mini-btn" id="m_edit">修改</button><button class="mini-btn" id="m_del">删除</button><button class="btn-primary" id="m_close">关闭</button></div>`);
  $('#m_close').addEventListener('click', closeModal);
  $('#m_edit').addEventListener('click', () => { closeModal(); openMaterialForm(id); });
  $('#m_del').addEventListener('click', () => { save('materials', load('materials', []).filter((x) => x.id !== id)); closeModal(); renderTailor(); checkStockBanner(); });
}

/* ---- 4.2 成品档案 ---- */
async function renderProductGallery(body) {
  const list = load('samples', []);
  const cards = list.length ? await Promise.all(list.map(async (s, i) => {
    const src = await resolveImg(s.photos && s.photos[0]);
    return `<div class="gcard mat-card" data-prod="${s.id}">
    ${src ? `<img src="${src}">` : `<div class="ph">👗</div>`}
    <div class="cap">${s.code ? `<span class="seq">${escapeHtml(s.code)}</span>` : ''}${escapeHtml(s.name || '')}<div class="sub">${escapeHtml(s.cat || '')}</div></div>
  </div>`;
  })) : '<div class="empty">还没有成品，点左上角 ＋ 添加～</div>';
  body.innerHTML = `<div class="gal-tools">
      <button class="btn-ghost" id="prodTpl">⬇️ 下载模板</button>
      <button class="btn-ghost" id="prodImp">⬆️ 批量导入</button>
    </div>
    <button class="fab-plus" id="prodAdd" title="新增成品">＋</button><div class="gallery" style="margin-top:6px">${cards}</div>`;
  $('#prodAdd').addEventListener('click', openProductForm);
  $('#prodTpl').addEventListener('click', downloadProductTemplate);
  $('#prodImp').addEventListener('click', () => pickFile('text/csv,.csv', importProductsCSV));
  body.querySelectorAll('[data-prod]').forEach((c) => c.addEventListener('click', () => openProductDetail(c.dataset.prod)));
}
async function openProductForm(editId) {
  const editS = editId ? load('samples', []).find((x) => x.id === editId) : null;
  const v = (x) => (x == null ? '' : x);
  const mats = load('materials', []);
  const matOpts = mats.map((m) => {
    const chk = editS && (editS.materialIds || []).includes(m.id) ? 'checked' : '';
    return `<label class="row" style="gap:6px"><input type="checkbox" class="mat-chk" value="${m.id}" ${chk} style="width:auto"> ${escapeHtml(m.name || m.code)}</label>`;
  }).join('') || '<span class="muted">请先在物料图库添加物料</span>';
  const STATUSES = ['还在打样', '成品样品', '已经卖掉', '归档保存'];
  const statusOpts = STATUSES.map((st) => `<option ${editS && editS.status === st ? 'selected' : ''}>${st}</option>`).join('');
  openModal(`<h3>${editS ? '✏️ 修改成品' : '➕ 新增成品'}</h3>
    <div class="grid-2"><div><label>编号</label><input id="p_code" value="${escapeHtml(v(editS && editS.code))}"></div><div><label>名字</label><input id="p_name" value="${escapeHtml(v(editS && editS.name))}"></div></div>
    <label>分类</label><input id="p_cat" value="${escapeHtml(v(editS && editS.cat))}" placeholder="裙装/上衣/配饰…">
    <label>成品图片（可多张，留空则保留已有）</label><input id="p_photos" type="file" accept="image/*" multiple>
    <div class="thumbs" id="p_thumbs"></div>
    <label>关联用到的原材料（勾选）</label><div class="grid-2" style="gap:6px">${matOpts}</div>
    <div class="grid-2"><div><label>用料数据</label><input id="p_usage" value="${escapeHtml(v(editS && editS.usage))}" placeholder="如 2米 / 3颗扣"></div><div><label>花费(元)</label><input id="p_cost" type="number" min="0" step="0.01" value="${v(editS && editS.cost)}"></div></div>
    <div class="grid-3"><div><label>工时(小时)</label><input id="p_hours" type="number" min="0" step="0.1" value="${v(editS && editS.hours)}"></div><div><label>人工(元)</label><input id="p_labor" type="number" min="0" step="0.01" value="${v(editS && editS.labor)}"></div><div><label>建议卖价(元)</label><input id="p_price" type="number" min="0" step="0.01" value="${v(editS && editS.price)}"></div></div>
    <label>状态</label><select id="p_status">${statusOpts}</select>
    <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn-ghost" id="p_cancel">取消</button><button class="btn-primary" id="p_save">${editS ? '保存修改' : '保存'}</button></div>`);
  let photos = editS ? (editS.photos || []).slice() : [];
  if (editS && photos.length) { const ds = await resolveImgs(photos); ds.forEach((d) => { if (d) { const i = document.createElement('img'); i.src = d; $('#p_thumbs').appendChild(i); } }); }
  $('#p_photos').addEventListener('change', (e) => [...e.target.files].forEach((f) => readImage(f, (d) => { photos.push(d); const i = document.createElement('img'); i.src = d; $('#p_thumbs').appendChild(i); })));
  $('#p_cancel').addEventListener('click', closeModal);
  $('#p_save').addEventListener('click', async () => {
    const g = (id) => $(id).value.trim();
    const used = [...document.querySelectorAll('.mat-chk')].filter((c) => c.checked).map((c) => c.value);
    const finalPhotos = await storeImgs(photos); /* 本地图存 IDB，原 id/链接保留 */
    const s = { code: g('#p_code'), name: g('#p_name'), cat: g('#p_cat'), photos: finalPhotos, materialIds: used, usage: g('#p_usage'), cost: g('#p_cost'), hours: g('#p_hours'), labor: g('#p_labor'), price: g('#p_price'), status: $('#p_status').value };
    if (!s.name && !s.code) return flash($('#p_save'), '填名字或编号');
    const list = load('samples', []);
    if (editS) { const idx = list.findIndex((x) => x.id === editId); if (idx >= 0) { s.id = editId; list[idx] = s; } }
    else { s.id = uid(); list.unshift(s); }
    save('samples', list); closeModal(); renderTailor();
  });
}
async function openProductDetail(id) {
  const s = load('samples', []).find((x) => x.id === id); if (!s) return;
  const photos = await resolveImgs(s.photos);
  const total = (Number(s.cost) + Number(s.labor)).toFixed(2);
  const mats = load('materials', []);
  const matNames = (s.materialIds || []).map((mid) => { const m = mats.find((x) => x.id === mid); return m ? (m.name || m.code) : mid; });
  openModal(`<h3>👗 成品详情</h3>
    ${photos && photos.length ? `<div class="modal-imgs">${photos.map((p) => p ? `<img src="${p}">` : '').join('')}</div>` : ''}
    <div class="kv"><span>编号</span><b>${escapeHtml(s.code || '—')}</b></div>
    <div class="kv"><span>名字</span><b>${escapeHtml(s.name || '—')}</b></div>
    <div class="kv"><span>分类</span><b>${escapeHtml(s.cat || '—')}</b></div>
    <div class="kv"><span>关联原材料</span><b>${matNames.length ? escapeHtml(matNames.join('、')) : '—'}</b></div>
    <div class="kv"><span>用料数据</span><b>${escapeHtml(s.usage || '—')}</b></div>
    <div class="kv"><span>花费</span><b>${money(s.cost)}</b></div>
    <div class="kv"><span>工时</span><b>${s.hours || 0} 小时</b></div>
    <div class="kv"><span>人工</span><b>${money(s.labor)}</b></div>
    <div class="kv"><span>总成本</span><b>${money(total)}</b></div>
    <div class="kv"><span>建议卖价</span><b>${money(s.price)}</b></div>
    <div class="kv"><span>状态</span><b><span class="pill pill-status">${escapeHtml(s.status)}</span></b></div>
    <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="mini-btn" id="p_edit">修改</button><button class="mini-btn" id="p_del">删除</button><button class="btn-primary" id="p_close">关闭</button></div>`);
  $('#p_close').addEventListener('click', closeModal);
  $('#p_edit').addEventListener('click', () => { closeModal(); openProductForm(id); });
  $('#p_del').addEventListener('click', () => { save('samples', load('samples', []).filter((x) => x.id !== id)); closeModal(); renderTailor(); });
}

/* ---- 4.3 销售数据 ---- */
function renderSales(body) {
  const sales = load('sales', []);
  const amt = (arr) => arr.reduce((s, x) => s + Number(x.price) * Number(x.qty), 0);
  const cnt = (arr) => arr.reduce((s, x) => s + Number(x.qty), 0);
  const today = todayStr();
  const wkOf = (ds) => { const [y, m, d] = ds.split('-').map(Number); return weekKey(new Date(y, m - 1, d)); };
  const wk = wkOf(today);
  const ym = today.slice(0, 7); const y = today.slice(0, 4);
  const byDay = sales.filter((s) => s.date === today);
  const byWeek = sales.filter((s) => wkOf(s.date) === wk);
  const byMonth = sales.filter((s) => (s.date || '').slice(0, 7) === ym);
  const byYear = sales.filter((s) => (s.date || '').slice(0, 4) === y);
  const products = load('samples', []);
  const prodOpts = products.map((p) => `<option value="${p.id}">${escapeHtml(p.name || p.code)}</option>`).join('');
  const chOpts = SALE_CHANNELS.map((c) => `<option>${c}</option>`).join('');
  const overview = [
    { k: '本日', a: amt(byDay), n: cnt(byDay) }, { k: '本周', a: amt(byWeek), n: cnt(byWeek) },
    { k: '本月', a: amt(byMonth), n: cnt(byMonth) }, { k: '本年', a: amt(byYear), n: cnt(byYear) },
  ];
  const chCards = SALE_CHANNELS.map((c) => { const arr = sales.filter((s) => s.channel === c); return `<div class="stat-card"><div class="ch"><span>${c}</span><b>${money(amt(arr))}</b></div><div class="nums"><span>销量 <b>${cnt(arr)}</b></span><span>笔数 <b>${arr.length}</b></span></div></div>`; }).join('');
  const rows = sales.length ? sales.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((s) => {
    const p = products.find((x) => x.id === s.productId); const total = (Number(s.price) * Number(s.qty)).toFixed(2);
    return `<tr><td>${p ? escapeHtml(p.name || p.code) : '—'}</td><td>${money(s.price)}</td><td>${s.qty}</td><td><span class="pill pill-status">${escapeHtml(s.channel)}</span></td><td>${s.date}</td><td><b>${money(total)}</b></td><td><button class="mini-btn" data-del-sale="${s.id}">删</button></td></tr>`;
  }).join('') : '<tr><td colspan="7" class="empty">还没有售卖记录～</td></tr>';
  body.innerHTML = `
    <div class="summary"><h3 style="grid-column:1/-1;margin:0 0 4px">📈 销售情况</h3>${overview.map((o) => `<div class="sum-box"><div class="muted">${o.k}</div><div class="v">${money(o.a)}</div><div class="muted">销量 ${o.n}</div></div>`).join('')}</div>
    <div class="card"><h3>各渠道销售数据</h3>${chCards}</div>
    <div class="card"><h3>售卖情况</h3>
      <div class="grid-2"><div><label>关联成品</label><select id="s_prod"><option value="">未选</option>${prodOpts}</select></div><div><label>渠道</label><select id="s_chan">${chOpts}</select></div></div>
      <div class="grid-3"><div><label>售价</label><input id="s_price" type="number" min="0" step="0.01"></div><div><label>数量</label><input id="s_qty" type="number" min="1" step="1" value="1"></div><div><label>日期</label><input id="s_date" type="date" value="${today}"></div></div>
      <div class="row" style="margin-top:8px"><button class="btn-primary" id="s_add">添加售卖</button></div>
      <div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>成品</th><th>售价</th><th>数量</th><th>渠道</th><th>日期</th><th>总收款</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
  $('#s_add').addEventListener('click', () => {
    const price = parseFloat($('#s_price').value); const qty = parseInt($('#s_qty').value) || 1; if (!price) return flash($('#s_add'), '填售价');
    const sales2 = load('sales', []); sales2.unshift({ id: uid(), productId: $('#s_prod').value, channel: $('#s_chan').value, price, qty, date: $('#s_date').value || today }); save('sales', sales2); renderSales(body);
  });
  body.querySelectorAll('[data-del-sale]').forEach((b) => b.addEventListener('click', () => { save('sales', load('sales', []).filter((x) => x.id !== b.dataset.delSale)); renderSales(body); }));
}

/* ---- 4.4 库存预警 ---- */
function renderWarn(body) {
  const list = load('materials', []).filter((m) => Number(m.qty) < Number(m.safety));
  if (!list.length) { body.innerHTML = '<div class="card"><div class="empty">🎉 目前没有库存紧缺的物料，安心～</div></div>'; return; }
  body.innerHTML = `<div class="card"><h3>⚠️ 库存紧缺物料（${list.length}）</h3><div class="tbl-wrap"><table>
    <thead><tr><th>编号</th><th>名字</th><th>余量</th><th>安全库存</th><th>缺口</th><th>供应商</th></tr></thead>
    <tbody>${list.map((m) => `<tr><td>${escapeHtml(m.code)}</td><td><b>${escapeHtml(m.name)}</b></td><td style="color:#C0395A;font-weight:700">${m.qty}</td><td>${m.safety}</td><td>${(Number(m.safety) - Number(m.qty)).toFixed(2)}</td><td>${escapeHtml(m.sup)}</td></tr>`).join('')}</tbody></table></div></div>`;
}
function checkStockBanner() {
  const low = load('materials', []).filter((m) => Number(m.qty) < Number(m.safety)).length;
  const b = $('#stockBanner');
  if (low > 0) { b.style.display = 'block'; b.textContent = `⚠️ 库存预警：当前有 ${low} 种物料库存紧缺，请及时补货！`; if ('Notification' in window && Notification.permission === 'granted') { try { new Notification('Mickey 库存预警', { body: `有 ${low} 种物料库存紧缺，请及时补货` }); } catch (e) {} } }
  else b.style.display = 'none';
}

/* ---- 4.5 教程推荐 ---- */
const TUTORIAL_POOL = [
  { t: '零基础学缝纫｜第一件手缝布袋', lv: '入门', plat: '抖音', tag: '手缝' },
  { t: '如何自己打版做一条半身裙', lv: '进阶', plat: '小红书', tag: '打版' },
  { t: '锁边机使用全攻略', lv: '入门', plat: '抖音', tag: '机器' },
  { t: '旧衣改造｜T恤变抱枕', lv: '入门', plat: '小红书', tag: '改造' },
  { t: '法式复古连衣裙缝制教程', lv: '进阶', plat: '小红书', tag: '连衣裙' },
  { t: '手工盘扣做法详解', lv: '高阶', plat: '抖音', tag: '盘扣' },
  { t: '儿童汉服简易版型', lv: '进阶', plat: '小红书', tag: '汉服' },
  { t: '布料缩水率怎么算', lv: '入门', plat: '抖音', tag: '布料' },
  { t: '新手必学｜五种基础针法', lv: '入门', plat: '小红书', tag: '针法' },
  { t: '羽绒服局部修补技巧', lv: '高阶', plat: '抖音', tag: '修补' },
  { t: '定制旗袍量体要点', lv: '高阶', plat: '小红书', tag: '旗袍' },
  { t: '碎布拼布小钱包', lv: '入门', plat: '抖音', tag: '拼布' },
];
function renderTutorial() {
  const pool = [...TUTORIAL_POOL];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const pick = pool.slice(0, 6);
  const urlFor = (p) => (p.plat === '抖音' ? 'https://www.douyin.com/search/' : 'https://www.xiaohongshu.com/search_result?keyword=') + encodeURIComponent(p.t);
  $('#tailorBody').innerHTML = `<div class="card"><div class="hot-head"><h3 style="margin:0">📚 推荐裁缝手工制作教程</h3><button class="btn-ghost" id="tutRefresh">换一批</button></div>
    <p class="muted" style="margin:4px 0 10px">根据热门手作方向为你推荐，点「去学习」跳转对应平台搜索观看。</p>
    <div class="tut-list">${pick.map((p) => `<div class="tut-item"><div><div class="tut-title">${escapeHtml(p.t)}</div><span class="hot-tag hot-${p.plat === '通用' ? 'g' : p.plat === '抖音' ? 'd' : 'x'}">${p.plat}</span> <span class="tut-lv">${p.lv}</span> <span class="muted">#${p.tag}</span></div><a class="mini-btn" href="${urlFor(p)}" target="_blank" rel="noopener">去学习</a></div>`).join('')}</div></div>`;
  $('#tutRefresh').addEventListener('click', renderTutorial);
}

/* ===================== 5. 记账本 ===================== */
const ledgerState = { month: todayStr().slice(0, 7), day: todayStr(), catOpen: false, mode: 'expense', selCat: '', more: false };
function initLedger() { renderLedger(); }
function txs() { return load('tx', []) || []; }
function dayTx(d) { return txs().filter((t) => (t.date || '') === d); }
function renderLedger() {
  const ym = ledgerState.month;
  const tx = txs();
  const monthTx = tx.filter((t) => (t.date || '').slice(0, 7) === ym);
  const income = monthTx.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
  const expense = monthTx.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
  const budget = load('budget_' + ym, '');
  const assets = load('assets', { banks: [], wechat: 0, alipay: 0 });

  // —— 选中日期速记：可补记往日 ——
  const day = ledgerState.day;
  const tTx = dayTx(day);
  const tInc = tTx.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
  const tExp = tTx.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);

  // —— 月度分类统计 ——
  const catMap = {};
  monthTx.filter((t) => t.type === 'expense').forEach((t) => { const c = t.category || '其他'; catMap[c] = (catMap[c] || 0) + Number(t.amount); });
  const catArr = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
  const maxCat = catArr.length ? catArr[0][1] : 1;

  // —— 历史：按日期分组（当月，倒序）——
  const byDay = {};
  monthTx.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).forEach((t) => { (byDay[t.date] || (byDay[t.date] = [])).push(t); });

  const body = $('#ledgerBody');
  body.innerHTML = `
    <div class="ledger-today">
      <div class="lt-head"><div class="lt-date" id="lg_date_label">📅 ${dayLabel(ledgerState.day)}</div>
        <div class="lt-toggle"><button class="lt-mode ${ledgerState.mode === 'expense' ? 'on' : ''}" data-mode="expense">支出</button><button class="lt-mode ${ledgerState.mode === 'income' ? 'on' : ''}" data-mode="income">收入</button></div>
      </div>
      <div class="lt-datepick">
        <label class="ldp-label">记账日期</label>
        <input type="date" id="lg_date" class="ldp-input" value="${ledgerState.day}" max="${todayStr()}">
        <span class="ldp-hint muted">忘记可补记往日</span>
      </div>
      <div class="lt-sum">
        <div class="lt-box"><span class="muted">支出</span><b id="lg_sum_exp" style="color:var(--red)">${money(tExp)}</b></div>
        <div class="lt-box"><span class="muted">收入</span><b id="lg_sum_inc" style="color:var(--green)">${money(tInc)}</b></div>
        <div class="lt-box"><span class="muted">结余</span><b id="lg_sum_net" style="color:${tInc - tExp >= 0 ? 'var(--green)' : 'var(--red)'}">${money(tInc - tExp)}</b></div>
      </div>
      <div class="lt-entry">
        <input id="lg_item" class="modal-input" placeholder="${ledgerState.mode === 'expense' ? '消费项目，如 午餐/打车' : '收入来源，如 工资/兼职'}">
        <div class="lt-amt"><input id="lg_amt" type="number" min="0" step="0.01" placeholder="金额" inputmode="decimal"></div>
      </div>
      <div class="lt-cats" id="lg_cats">
        ${EXPENSE_CATS.map((c) => `<span class="cat-chip ${ledgerState.mode === 'expense' && (ledgerState.selCat || EXPENSE_CATS[0]) === c ? 'on' : ''}" data-cat="${c}">${c}</span>`).join('')}
        <input id="lg_cat_new" placeholder="自定义…" style="width:92px"><button class="mini-btn" id="lg_cat_add">+</button>
      </div>
      <button class="btn-primary" id="lg_add" style="width:100%;margin-top:8px">+ 记一笔</button>
      <div class="lt-list" id="lg_today_list"></div>
    </div>

    <div class="card" style="margin-top:16px"><h3>📊 本月消费统计</h3>
      <div class="ledger-monthhead"><span>共支出 <b style="color:var(--red)">${money(expense)}</b></span><span>共收入 <b style="color:var(--green)">${money(income)}</b></span><span>结余 <b style="color:${income - expense >= 0 ? 'var(--green)' : 'var(--red)'}">${money(income - expense)}</b></span></div>
      ${ledgerDonut(catArr)}
    </div>

    <div class="card" style="margin-top:16px">
      <div class="lh-row"><h3 style="margin:0">🗂 历史账单</h3><input type="month" id="lg_month" value="${ym}" style="width:auto"></div>
      <div class="hist-list" id="lg_hist">
        ${Object.entries(byDay).map(([d, arr]) => { const di = arr.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0); const de = arr.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0); return `<div class="hist-day"><div class="hd-head"><span class="hd-date">${d}</span><span class="hd-sum">收 ${money(di)} ｜ 支 ${money(de)}</span></div>${arr.map((t) => `<div class="item-card"><div class="ic-top"><span class="ic-title"><span class="tag">${escapeHtml(t.category || (t.type === 'income' ? '收入' : '其他'))}</span>${escapeHtml(t.note || '')}</span><span class="ic-date"><button class="ic-del" data-dt="${t.id}">×</button></span></div><div class="ic-body" style="color:${t.type === 'income' ? 'var(--green)' : 'var(--red)'};font-weight:700">${t.type === 'income' ? '+' : '-'}${money(t.amount)}</div></div>`).join('')}</div>`; }).join('') || '<div class="empty">本月还没有账单</div>'}
      </div>
    </div>

    <div class="collapse" style="margin-top:16px">
      <div class="collapse-head" id="lg_more_head"><h3 style="margin:0">⚙️ 预算 / 净资产（更多）</h3><span class="muted">${ledgerState.more ? '收起 ▲' : '展开 ▼'}</span></div>
      <div class="collapse-body${ledgerState.more ? ' open' : ''}" id="lg_more_body">
        <div class="card" style="box-shadow:none;border:1px solid var(--line)"><h3>本月预算</h3>
          <div class="grid-2"><div><label>预算金额</label><input id="lg_budget" type="number" min="0" step="0.01" value="${budget}"></div>
          <div><label>预算剩余</label><input value="${budget === '' ? '未设置' : money(Number(budget) - expense)}" disabled></div></div>
          <div class="row" style="margin-top:10px"><button class="btn-primary" id="lg_budget_save">保存预算</button></div>
        </div>
        <div class="card" style="box-shadow:none;border:1px solid var(--line)"><h3>净资产</h3>
          <label>银行卡（可多个）</label>
          <div id="lg_banks">${assets.banks.map((b, i) => `<div class="row" style="margin-bottom:8px"><input class="bk-name" value="${escapeHtml(b.name)}" placeholder="银行名" style="flex:1"><input class="bk-amt" type="number" min="0" step="0.01" value="${b.amount}" placeholder="金额" style="width:140px"><button class="mini-btn" data-bk="${i}">删</button></div>`).join('') || '<span class="muted">还没有银行卡</span>'}</div>
          <button class="btn-ghost" id="lg_bank_add" style="margin-top:6px">+ 添加银行卡</button>
          <div class="grid-2" style="margin-top:12px">
            <div><label>微信余额</label><input id="lg_wx" type="number" min="0" step="0.01" value="${assets.wechat || 0}"></div>
            <div><label>支付宝余额</label><input id="lg_ali" type="number" min="0" step="0.01" value="${assets.alipay || 0}"></div>
          </div>
          <div class="row" style="margin-top:10px;justify-content:space-between"><span class="muted">净资产合计：<b style="color:var(--ink)">${money(netTotal(assets))}</b></span><button class="btn-primary" id="lg_asset_save">保存净资产</button></div>
        </div>
      </div>
    </div>`;

  // —— 绑定事件 ——
  body.querySelectorAll('.lt-mode').forEach((b) => b.addEventListener('click', () => { ledgerState.mode = b.dataset.mode; ledgerState.selCat = ''; renderLedger(); }));
  if (!ledgerState.selCat) ledgerState.selCat = EXPENSE_CATS[0];
  body.querySelectorAll('#lg_cats [data-cat]').forEach((c) => c.addEventListener('click', () => { ledgerState.selCat = c.dataset.cat; body.querySelectorAll('#lg_cats [data-cat]').forEach((x) => x.classList.remove('on')); c.classList.add('on'); }));
  $('#lg_cat_add').addEventListener('click', () => { const v = $('#lg_cat_new').value.trim(); if (v && !EXPENSE_CATS.includes(v)) { EXPENSE_CATS.push(v); ledgerState.selCat = v; renderLedger(); } });
  $('#lg_add').addEventListener('click', () => {
    const amt = parseFloat($('#lg_amt').value); if (!amt) { flash($('#lg_add'), '请填金额'); return; }
    const item = $('#lg_item').value.trim();
    const cat = ledgerState.mode === 'expense' ? ledgerState.selCat : '收入';
    const list = txs();
    list.unshift({ id: uid(), type: ledgerState.mode, date: ledgerState.day, amount: amt, category: cat, note: item });
    save('tx', list); renderLedger();
    if (activeSection === 'home') renderHome();
  });
  const lgDate = $('#lg_date'); if (lgDate) lgDate.addEventListener('change', () => { ledgerState.day = lgDate.value || todayStr(); renderDayPanel(); });
  body.querySelectorAll('#lg_today_list [data-dt]').forEach((b) => b.addEventListener('click', () => { save('tx', load('tx', []).filter((x) => x.id !== b.dataset.dt)); renderLedger(); }));
  $('#lg_month').addEventListener('change', (e) => { ledgerState.month = e.target.value; renderLedger(); });
  $('#lg_more_head').addEventListener('click', () => { ledgerState.more = !ledgerState.more; renderLedger(); });
  $('#lg_budget_save').addEventListener('click', () => { save('budget_' + ym, $('#lg_budget').value); flash($('#lg_budget_save'), '已保存'); renderLedger(); });
  $('#lg_bank_add').addEventListener('click', () => { assets.banks.push({ name: '', amount: 0 }); save('assets', assets); renderLedger(); });
  body.querySelectorAll('[data-bk]').forEach((b) => b.addEventListener('click', () => { assets.banks.splice(Number(b.dataset.bk), 1); save('assets', assets); renderLedger(); }));
  $('#lg_asset_save').addEventListener('click', () => {
    assets.banks.forEach((b, i) => { b.name = body.querySelectorAll('.bk-name')[i].value; b.amount = body.querySelectorAll('.bk-amt')[i].value; });
    assets.wechat = $('#lg_wx').value; assets.alipay = $('#lg_ali').value; save('assets', assets); flash($('#lg_asset_save'), '已保存'); renderLedger();
  });
  body.querySelectorAll('#lg_hist [data-dt]').forEach((b) => b.addEventListener('click', () => { save('tx', load('tx', []).filter((x) => x.id !== b.dataset.dt)); renderLedger(); }));
  renderDayPanel();
}
function dayLabel(d) {
  if (d === todayStr()) return '今天';
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (d === fmtDate(y)) return '昨天';
  return d;
}
function renderDayPanel() {
  const day = ledgerState.day;
  const lbl = $('#lg_date_label'); if (lbl) lbl.textContent = '📅 ' + dayLabel(day);
  const arr = dayTx(day).slice().sort((a, b) => (b.id || '').localeCompare(a.id || ''));
  const di = arr.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
  const de = arr.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
  const exp = $('#lg_sum_exp'); if (exp) exp.textContent = money(de);
  const inc = $('#lg_sum_inc'); if (inc) inc.textContent = money(di);
  const net = $('#lg_sum_net'); if (net) { net.textContent = money(di - de); net.style.color = di - de >= 0 ? 'var(--green)' : 'var(--red)'; }
  const box = $('#lg_today_list'); if (!box) return;
  if (!arr.length) { box.innerHTML = `<div class="muted" style="font-size:12px;text-align:center;padding:8px 0">${dayLabel(day)}还没记账，记下第一笔吧～</div>`; return; }
  box.innerHTML = arr.map((t) => `<div class="item-card"><div class="ic-top"><span class="ic-title"><span class="tag">${escapeHtml(t.category || (t.type === 'income' ? '收入' : '其他'))}</span>${escapeHtml(t.note || '')}</span><span class="ic-date"><button class="ic-del" data-dt="${t.id}">×</button></span></div><div class="ic-body" style="color:${t.type === 'income' ? 'var(--green)' : 'var(--red)'};font-weight:700">${t.type === 'income' ? '+' : '-'}${money(t.amount)}</div></div>`).join('');
  box.querySelectorAll('[data-dt]').forEach((b) => b.addEventListener('click', () => { save('tx', load('tx', []).filter((x) => x.id !== b.dataset.dt)); renderLedger(); }));
}
function netTotal(a) { return (a.banks || []).reduce((s, b) => s + Number(b.amount), 0) + Number(a.wechat || 0) + Number(a.alipay || 0); }
// 本月支出分类甜甜圈饼图（纯 SVG，无外部依赖）
const DONUT_COLORS = ['#5B9BE8', '#7ED0C0', '#F4B183', '#B6A6E9', '#F6A6C1', '#86C98B', '#FFD17A', '#E08B8B', '#8FB9FF', '#C9B6E4', '#F2C14E', '#9CC8F8'];
function ledgerDonut(catArr) {
  if (!catArr.length) return '<div class="empty">本月暂无支出记录</div>';
  const total = catArr.reduce((s, [, v]) => s + Number(v), 0) || 1;
  const R = 54, C = 2 * Math.PI * R;
  let off = 0;
  const segs = catArr.map(([c, v], i) => {
    const len = (Number(v) / total) * C;
    const color = DONUT_COLORS[i % DONUT_COLORS.length];
    const s = `<circle cx="70" cy="70" r="${R}" fill="none" stroke="${color}" stroke-width="20" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 70 70)"></circle>`;
    off += len;
    return s;
  }).join('');
  const legend = catArr.map(([c, v], i) => `<div class="dn-leg"><span class="dn-dot" style="background:${DONUT_COLORS[i % DONUT_COLORS.length]}"></span><span class="dn-name">${escapeHtml(c)}</span><span class="dn-val">${money(v)}</span><span class="dn-pct">${((Number(v) / total) * 100).toFixed(1)}%</span></div>`).join('');
  return `<div class="donut-wrap">
    <div class="donut-box"><svg viewBox="0 0 140 140" class="donut-svg">
      <circle cx="70" cy="70" r="${R}" fill="none" stroke="var(--soft)" stroke-width="20"></circle>
      ${segs}
    </svg><div class="donut-center"><b>${money(total)}</b><span class="muted">总支出</span></div></div>
    <div class="donut-legend">${legend}</div>
  </div>`;
}

/* ===================== 6. 运动（原健康升级） ===================== */
const SPORT_TABS = [
  { v: 'checkin', t: '今日打卡' }, { v: 'plan', t: '运动计划' },
  { v: 'progress', t: '进度统计' }, { v: 'review', t: '阶段复盘' }, { v: 'meal', t: '饮食卡路里' },
];
const EX_VIDEO = {
  '跑步': 'https://search.bilibili.com/all?keyword=' + encodeURIComponent('跑步正确姿势教学'),
  '瑜伽': 'https://search.bilibili.com/all?keyword=' + encodeURIComponent('瑜伽入门教程'),
  '普拉提': 'https://search.bilibili.com/all?keyword=' + encodeURIComponent('普拉提入门'),
  '羽毛球': 'https://search.bilibili.com/all?keyword=' + encodeURIComponent('羽毛球基础教学'),
  '跳绳': 'https://search.bilibili.com/all?keyword=' + encodeURIComponent('跳绳减肥正确姿势'),
  '游泳': 'https://search.bilibili.com/all?keyword=' + encodeURIComponent('游泳教学入门'),
  '健身': 'https://search.bilibili.com/all?keyword=' + encodeURIComponent('居家健身训练'),
  '骑行': 'https://search.bilibili.com/all?keyword=' + encodeURIComponent('骑行入门'),
  '舞蹈': 'https://search.bilibili.com/all?keyword=' + encodeURIComponent('舞蹈基本功'),
  '拉伸': 'https://search.bilibili.com/all?keyword=' + encodeURIComponent('全身拉伸放松'),
};
const SPORT_TPL = {
  '减脂塑形': ['跑步', '跳绳', '普拉提'],
  '居家活力': ['健身', '瑜伽', '跳绳'],
  '户外有氧': ['跑步', '骑行', '游泳'],
  '舒展放松': ['瑜伽', '拉伸', '舞蹈'],
};
const sportState = { tab: 'checkin' };
function sportRec(d) { return load('sport_' + (d || todayStr()), { items: [], meals: { 早: [], 午: [], 晚: [], 加: [] }, weight: '' }); }
function sportBurn(rec) { return (rec.items || []).filter((i) => i.done).reduce((s, i) => s + Number(i.kcal || 0), 0); }
function sportIntake(rec) { const m = rec.meals || {}; return Object.values(m).flat().reduce((s, f) => s + Number(f.cals || 0), 0); }
/* 常见食物热量关键词表（每"一份"估算 kcal，离线兜底用） */
const FOOD_KCAL = {
  '米饭': 230, '面': 280, '面条': 280, '馒头': 220, '包子': 200, '饺子': 220, '粥': 80, '米粉': 250, '面包': 265, '吐司': 260, '麦片': 150,
  '鸡蛋': 70, '牛奶': 150, '豆浆': 30, '酸奶': 100, '奶酪': 120, '黄油': 100,
  '鸡肉': 165, '牛肉': 250, '猪肉': 290, '羊肉': 270, '鱼': 120, '虾': 90, '蟹': 95, '培根': 180, '香肠': 250,
  '蔬菜': 30, '青菜': 20, '西兰花': 35, '番茄': 20, '西红柿': 20, '黄瓜': 15, '土豆': 110, '红薯': 120, '玉米': 110, '胡萝卜': 35, '豆腐': 80, '菠菜': 20,
  '苹果': 95, '香蕉': 105, '橙子': 70, '橘子': 70, '葡萄': 70, '西瓜': 30, '草莓': 30, '芒果': 90, '梨': 80,
  '蛋糕': 350, '巧克力': 550, '饼干': 350, '薯条': 300, '汉堡': 500, '披萨': 270, '炸鸡': 400, '寿司': 200, '沙拉': 80,
  '可乐': 140, '咖啡': 5, '奶茶': 250, '果汁': 120, '啤酒': 150, '油': 900, '糖': 400, '坚果': 600, '花生': 580, '燕麦': 150,
};
function estimateMealCalsOffline(text) {
  const t = (text || '');
  let sum = 0, hit = false;
  Object.keys(FOOD_KCAL).forEach((k) => { if (t.indexOf(k) >= 0) { sum += FOOD_KCAL[k]; hit = true; } });
  return hit ? Math.round(sum) : 200; /* 没匹配到就给一个常见正餐估值 */
}
/* 综合估算：有图+已配 AI → 视觉模型；否则离线关键词 */
async function estimateMealCals(foodText, imageDataUrl) {
  if (imageDataUrl) {
    const ai = await callAIVision('请估算这顿餐食的总热量（大卡 kcal）。只返回一个整数数字，不要任何其它文字。', imageDataUrl);
    if (ai) { const n = parseInt((ai.match(/\d+/) || [])[0], 10); if (n > 0) return n; }
  }
  return estimateMealCalsOffline(foodText);
}
function initSports() { renderSports(); }
/* 把某个计划套用到「今天」的训练打卡（同日同计划去重，避免重复添加） */
function applyPlanToToday(plan) {
  if (!plan || !plan.items || !plan.items.length) return;
  const day = todayStr();
  const rec = sportRec(day);
  const items = rec.items || [];
  if (items.some((it) => it.planId === plan.id)) return;
  plan.items.forEach((it) => items.push({ name: it.name, minutes: it.minutes || 30, kcal: (it.minutes || 30) * 7, done: false, planId: plan.id }));
  rec.items = items; save('sport_' + day, rec);
  save('sport_applied_' + day, plan.id);
}
function renderSports() {
  $('#sportTabs').innerHTML = SPORT_TABS.map((t) => `<button class="subtab${t.v === sportState.tab ? ' active' : ''}" data-view="${t.v}">${t.t}</button>`).join('');
  $('#sportTabs').querySelectorAll('.subtab').forEach((b) => b.addEventListener('click', () => { sportState.tab = b.dataset.view; renderSports(); }));
  const body = $('#sportBody');
  ({ checkin: renderSportCheckin, plan: renderSportPlan, progress: renderSportProgress, review: renderSportReview, meal: renderSportMeal })[sportState.tab](body);
}
function renderSportCheckin(body) {
  const day = todayStr();
  const rec = sportRec(day);
  const plans = load('sport_plans', []);
  const goal = load('sport_goal', { prefTime: '晚上', note: '' });
  const burned = sportBurn(rec);
  const items = rec.items || [];
  /* 自动生成：当天尚无训练项、且当天未被手动清空过时，自动套用最新计划（真正的「创建计划后自动生成」） */
  if (!items.length && !load('sport_cleared_' + day, false)) {
    const latest = plans.slice().sort((a, b) => (b.created || 0) - (a.created || 0))[0];
    if (latest) { applyPlanToToday(latest); renderSports(); return; }
  }
  const planOpts = plans.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}（${p.items.map((i) => i.name).join('、')}）</option>`).join('');
  body.innerHTML = `
    <div class="card"><h3>🏃 今日训练打卡（${day}）</h3>
      <p class="muted" style="margin:0 0 10px">个人节奏：偏好 <b>${escapeHtml(goal.prefTime || '—')}</b>${goal.note ? ' · ' + escapeHtml(goal.note) : ''}。完成训练后自动累计今日运动消耗。</p>
      <div class="row" style="margin-bottom:10px">
        ${plans.length ? `<select id="sp_plan" class="modal-input" style="max-width:260px">${planOpts}</select><button class="btn-primary" id="sp_apply">⚡ 一键套用模板</button>` : '<span class="muted">还没有计划，先去「运动计划」创建</span>'}
        <button class="btn-ghost" id="sp_goal">⚙️ 个人节奏</button>
      </div>
      <div id="sp_items"></div>
      <div class="hero-stat" style="margin-top:12px">
        <div class="sum-box"><div class="muted">今日已消耗</div><div class="v" style="color:var(--green)">${burned} kcal</div></div>
        <div class="sum-box"><div class="muted">已完成项</div><div class="v">${items.filter((i) => i.done).length}/${items.length}</div></div>
        <div class="sum-box"><div class="muted">训练项</div><div class="v">${items.length}</div></div>
      </div>
    </div>`;
  const persist = () => { const r = sportRec(day); r.items = items; save('sport_' + day, r); };
  const draw = () => {
    const box = $('#sp_items');
    if (!items.length) { box.innerHTML = '<div class="empty">今天还没有训练项，点「一键套用模板」或从计划添加～</div>'; return; }
    box.innerHTML = items.map((it, idx) => `<div class="ex-row" data-i="${idx}">
      <button class="check ${it.done ? 'on' : ''}" data-act="done">${it.done ? '✓' : ''}</button>
      <div class="ex-main">
        <div class="ex-name">${escapeHtml(it.name)} ${it.kcal ? `<span class="ex-kcal">${it.kcal} kcal</span>` : ''}</div>
        <div class="ex-ctrl">
          <input type="number" min="0" value="${it.minutes || 30}" class="ex-min" data-i="${idx}" title="时长(分钟)"> 分钟
          <button class="mini-btn" data-act="vid" data-vid="${encodeURIComponent(it.name)}">🎬 指导视频</button>
          <button class="mini-btn" data-act="del">删</button>
        </div>
      </div>
    </div>`).join('');
  };
  draw();
  if (plans.length) {
    $('#sp_apply').addEventListener('click', () => {
      const p = plans.find((x) => x.id === $('#sp_plan').value); if (!p) return;
      p.items.forEach((it) => items.push({ name: it.name, minutes: it.minutes || 30, kcal: (it.minutes || 30) * 7, done: false, planId: p.id }));
      persist(); renderSports();
    });
  }
  $('#sp_goal').addEventListener('click', () => {
    openModal(`<div class="modal-h">⚙️ 个人运动节奏</div>
      <label class="fld">偏好时间</label><select id="sg_t" class="modal-input"><option ${goal.prefTime === '清晨' ? 'selected' : ''}>清晨</option><option ${goal.prefTime === '上午' ? 'selected' : ''}>上午</option><option ${goal.prefTime === '下午' ? 'selected' : ''}>下午</option><option ${goal.prefTime === '晚上' ? 'selected' : ''}>晚上</option><option ${goal.prefTime === '碎片时间' ? 'selected' : ''}>碎片时间</option></select>
      <label class="fld">备注（如：膝盖需注意 / 喜欢低强度）</label><input id="sg_n" class="modal-input" value="${escapeHtml(goal.note || '')}">
      <div class="modal-actions"><button class="btn-ghost" id="sg_c">取消</button><button class="btn-primary" id="sg_s">保存</button></div>`);
    $('#sg_s').addEventListener('click', () => { save('sport_goal', { prefTime: $('#sg_t').value, note: $('#sg_n').value.trim() }); closeModal(); renderSports(); });
    $('#sg_c').addEventListener('click', closeModal);
  });
  const box = $('#sp_items');
  box.addEventListener('click', (e) => {
    const row = e.target.closest('.ex-row'); if (!row) return; const idx = Number(row.dataset.i);
    const act = e.target.dataset.act;
    if (act === 'done') { items[idx].done = !items[idx].done; if (items[idx].done) items[idx].ts = Date.now(); items[idx].kcal = (Number(items[idx].minutes) || 30) * 7; persist(); renderSports(); }
    else if (act === 'vid') { window.open(EX_VIDEO[decodeURIComponent(e.target.dataset.vid)] || ('https://search.bilibili.com/all?keyword=' + encodeURIComponent(e.target.dataset.vid)), '_blank'); }
    else if (act === 'del') { items.splice(idx, 1); if (!items.length) save('sport_cleared_' + day, true); persist(); renderSports(); }
  });
  box.addEventListener('input', (e) => {
    if (e.target.classList.contains('ex-min')) { const idx = Number(e.target.dataset.i); items[idx].minutes = Number(e.target.value) || 0; items[idx].kcal = items[idx].minutes * 7; persist(); }
  });
}
function renderSportPlan(body) {
  const plans = load('sport_plans', []);
  body.innerHTML = `
    <div class="card"><h3>➕ 新建长期运动计划</h3>
      <label class="fld">计划名称</label><input id="pl_name" class="modal-input" placeholder="如：12月减脂计划">
      <div class="grid-2"><div><label class="fld">周期</label><select id="pl_cycle" class="modal-input"><option>日</option><option>周</option><option>月</option></select></div>
      <div><label class="fld">频率（每周期几次）</label><input id="pl_freq" type="number" min="1" value="3" class="modal-input"></div></div>
      <label class="fld">快速套用模板</label>
      <div class="cat-list" id="pl_tpl">${Object.keys(SPORT_TPL).map((k) => `<span class="cat-chip" data-tpl="${k}">${k}</span>`).join('')}</div>
      <label class="fld">训练项目（名称 + 时长分钟）</label>
      <div id="pl_items"></div>
      <button class="btn-ghost" id="pl_add_item" style="margin-top:6px">＋ 添加项目</button>
      <div class="modal-actions"><button class="btn-primary" id="pl_save">保存计划</button></div>
    </div>
    <div id="pl_list"></div>`;
  let plItems = [];
  const drawItems = () => {
    $('#pl_items').innerHTML = plItems.map((it, i) => `<div class="row" style="margin-bottom:6px"><input class="pl-iname" value="${escapeHtml(it.name)}" placeholder="项目名" style="flex:1"><input class="pl-imin" type="number" min="0" value="${it.minutes}" placeholder="分钟" style="width:90px"><button class="mini-btn" data-di="${i}">×</button></div>`).join('') || '<span class="muted">还没有项目</span>';
    $('#pl_items').querySelectorAll('[data-di]').forEach((b) => b.addEventListener('click', () => { plItems.splice(Number(b.dataset.di), 1); drawItems(); }));
  };
  drawItems();
  $('#pl_add_item').addEventListener('click', () => { plItems.push({ name: '', minutes: 30 }); drawItems(); });
  body.querySelectorAll('[data-tpl]').forEach((c) => c.addEventListener('click', () => {
    plItems = (SPORT_TPL[c.dataset.tpl] || []).map((n) => ({ name: n, minutes: 30 })); drawItems();
    $('#pl_name').value = $('#pl_name').value || (c.dataset.tpl + '计划');
  }));
  $('#pl_save').addEventListener('click', () => {
    const name = $('#pl_name').value.trim(); if (!name) return flash($('#pl_save'), '填名称');
    plItems = plItems.map((it) => ({ name: (it.name || '').trim(), minutes: Number(it.minutes) || 30 })).filter((it) => it.name);
    if (!plItems.length) return flash($('#pl_save'), '加项目');
    const plans2 = load('sport_plans', []);
    const newPlan = { id: uid(), name, cycle: $('#pl_cycle').value, freq: Number($('#pl_freq').value) || 1, items: plItems, created: Date.now() };
    plans2.push(newPlan); save('sport_plans', plans2);
    applyPlanToToday(newPlan);   // 创建后自动把训练项生成到今天的打卡
    renderSports();
  });
  $('#pl_list').innerHTML = plans.length ? plans.map((p) => `<div class="item-card"><div class="ic-top"><span class="ic-title">${escapeHtml(p.name)}</span><button class="ic-del" data-pd="${p.id}">×</button></div><div class="ic-body">周期：${p.cycle} ｜ 频率：每${p.cycle}${p.freq}次 ｜ 项目：${p.items.map((i) => i.name + ' ' + i.minutes + '分').join('、')}</div></div>`).join('') : '<div class="empty">还没有长期计划</div>';
  $('#pl_list').querySelectorAll('[data-pd]').forEach((b) => b.addEventListener('click', () => { save('sport_plans', load('sport_plans', []).filter((x) => x.id !== b.dataset.pd)); renderSports(); }));
}
function renderSportProgress(body) {
  const plans = load('sport_plans', []);
  const periodDays = (c) => (c === '日' ? 14 : c === '周' ? 28 : 60);
  let html = '';
  if (!plans.length) html = '<div class="empty">还没有计划，先去「运动计划」创建</div>';
  else {
    html = plans.map((p) => {
      const pd = periodDays(p.cycle);
      let doneDays = 0;
      for (let i = 0; i < pd; i++) { const d = fmtDate(addDays(todayStr(), -i)); const r = sportRec(d); if ((r.items || []).some((it) => it.done && it.planId === p.id)) doneDays++; }
      const pct = Math.min(100, Math.round(doneDays / pd * 100));
      return `<div class="card"><div class="ic-top"><b>${escapeHtml(p.name)}</b><span class="muted">近 ${pd} 天 完成 ${doneDays} 天</span></div>
        <div class="progress" style="margin:10px 0 0"><div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div><span>${pct}%</span></div></div>`;
    }).join('');
  }
  body.innerHTML = `<div class="page-head"><h3>📈 计划完成进度</h3></div>${html}`;
}
function renderSportReview(body) {
  const wk = weekKey(new Date());
  let sessions = 0, mins = 0, burned = 0;
  for (let i = 0; i < 7; i++) { const d = fmtDate(addDays(todayStr(), -i)); if (weekKey(new Date(d)) !== wk) continue; const r = sportRec(d); (r.items || []).forEach((it) => { if (it.done) { sessions++; mins += Number(it.minutes) || 0; burned += Number(it.kcal) || 0; } }); }
  const plans = load('sport_plans', []);
  const lowPlans = plans.filter((p) => { let done = 0; for (let i = 0; i < 7; i++) { const d = fmtDate(addDays(todayStr(), -i)); const r = sportRec(d); if ((r.items || []).some((it) => it.done && it.planId === p.id)) done++; } return done < p.freq; });
  const tips = [];
  if (!sessions) tips.push('本周还没有完成训练，挑一个今天能做的低强度项目先动起来～');
  else if (sessions < 3) tips.push(`本周已完成 ${sessions} 次训练，接近目标但还差一点，明天安排一次吧。`);
  else tips.push(`本周 ${sessions} 次训练，节奏很稳，保持住！`);
  if (lowPlans.length) tips.push(`以下计划本周未完成目标次数：${lowPlans.map((p) => p.name).join('、')}，可适当降低频率或换更喜欢的动作。`);
  body.innerHTML = `<div class="card"><h3>🔁 阶段性运动复盘（本周）</h3>
    <div class="hero-stat">
      <div class="sum-box"><div class="muted">训练次数</div><div class="v">${sessions}</div></div>
      <div class="sum-box"><div class="muted">总时长</div><div class="v">${mins} 分</div></div>
      <div class="sum-box"><div class="muted">消耗</div><div class="v" style="color:var(--green)">${burned} kcal</div></div>
    </div>
    <div class="an-tips"><b>💡 建议</b><ul>${tips.map((t) => '<li>' + escapeHtml(t) + '</li>').join('')}</ul></div>
  </div>`;
}
function renderSportMeal(body) {
  const day = todayStr();
  const rec = sportRec(day);
  if (!rec.meals) rec.meals = { 早: [], 午: [], 晚: [], 加: [] };
  const cats = ['早', '午', '晚', '加'];
  const burned = sportBurn(rec);
  const intake = sportIntake(rec);
  const net = intake - burned;
  const mealBlocks = cats.map((c) => {
    const list = rec.meals[c] || [];
    const items = list.length ? list.map((f, i) => `<div class="food-item">
        ${f.img ? `<img class="food-thumb" data-img="${f.img}" alt="">` : ''}
        <span class="food-name">${escapeHtml(f.name || '食物')}</span>
        <span class="food-cal">${f.cals} kcal</span>
        ${f.ts ? `<span class="food-time">${fmtTime(f.ts)}</span>` : ''}
        <button class="mini-btn" data-mc="${c}" data-mi="${i}">删</button>
      </div>`).join('') : '<div class="empty">还没记录</div>';
    return `<div class="card"><h3>${c === '早' ? '🌅' : c === '午' ? '☀️' : c === '晚' ? '🌙' : '🍬'} ${c}餐（${list.reduce((s, f) => s + Number(f.cals || 0), 0)} kcal）</h3>
      <div id="meal_${c}">${items}</div>
      <button class="btn-ghost meal-add" data-madd="${c}" style="margin-top:8px">＋ 添加一餐</button>
    </div>`;
  }).join('');
  body.innerHTML = `<div class="card"><h3>🍽 每日饮食 · 卡路里（${day}）</h3>
    <p class="muted" style="margin:0 0 10px">填食物描述、上传饮食图片，点「自动估算」即可根据图文生成卡路里（也可手动修改）。</p>
    <div class="hero-stat">
      <div class="sum-box"><div class="muted">今日摄入</div><div class="v">${intake} kcal</div></div>
      <div class="sum-box"><div class="muted">运动消耗</div><div class="v" style="color:var(--green)">${burned} kcal</div></div>
      <div class="sum-box"><div class="muted">净摄入</div><div class="v" style="color:${net > 0 ? 'var(--red)' : 'var(--green)'}">${net} kcal</div></div>
    </div>
    ${net > 0 ? '<div class="compare over">今日净摄入 +' + net + ' kcal，注意控制或加练～</div>' : '<div class="compare under">今日净摄入 ' + net + ' kcal，在消耗范围内 ✅</div>'}
  </div>${mealBlocks}`;
  body.querySelectorAll('[data-img]').forEach((el) => resolveImg(el.dataset.img).then((u) => { if (u) el.src = u; }));
  body.querySelectorAll('[data-madd]').forEach((b) => b.addEventListener('click', () => openMealModal(b.dataset.madd)));
  body.querySelectorAll('[data-mc]').forEach((b) => b.addEventListener('click', () => {
    const c = b.dataset.mc, i = Number(b.dataset.mi); const r = sportRec(day); r.meals[c].splice(i, 1); save('sport_' + day, r); renderSports();
  }));
}
function openMealModal(cat) {
  let mealImg = '';
  openModal(`<div class="modal-h">🍽 添加一餐（${cat}）</div>
    <label class="fld">餐别</label><select id="ml_cat" class="modal-input"><option ${cat === '早' ? 'selected' : ''}>早</option><option ${cat === '午' ? 'selected' : ''}>午</option><option ${cat === '晚' ? 'selected' : ''}>晚</option><option ${cat === '加' ? 'selected' : ''}>加</option></select>
    <label class="fld">吃了什么？（描述越具体，估算越准）</label><textarea id="ml_food" class="modal-textarea" placeholder="如：一碗米饭、一个鸡蛋、一杯牛奶、几片西兰花"></textarea>
    <label class="fld">饮食图片（可选，上传后点「自动估算」看图算卡路里）</label>
    <input type="file" id="ml_img" accept="image/*" class="modal-input">
    <div id="ml_prev" class="img-prev"></div>
    <div class="row" style="margin-top:6px;align-items:flex-end">
      <div style="flex:1"><label class="fld">卡路里 (kcal)</label><input id="ml_cals" type="number" min="0" placeholder="点自动估算或手动填" class="modal-input"></div>
      <button class="btn-ghost" id="ml_auto">✨ 自动估算</button>
    </div>
    <div id="ml_hint" class="muted" style="min-height:18px"></div>
    <div class="modal-actions"><button class="btn-ghost" id="ml_cancel">取消</button><button class="btn-primary" id="ml_save">保存</button></div>`);
  $('#ml_img').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    readImage(f, (url) => { mealImg = url; $('#ml_prev').innerHTML = '<img src="' + url + '" style="max-width:120px;border-radius:10px;margin-top:6px">'; });
  });
  $('#ml_auto').addEventListener('click', async () => {
    const btn = $('#ml_auto'); btn.disabled = true; $('#ml_hint').textContent = '估算中…';
    const cals = await estimateMealCals($('#ml_food').value, mealImg);
    $('#ml_cals').value = cals;
    const cfg = loadAICfg();
    $('#ml_hint').textContent = mealImg && cfg.key ? '已结合图片视觉估算 ✅' : '已按食物关键词离线估算（未配 AI 或没传图）';
    btn.disabled = false;
  });
  $('#ml_cancel').addEventListener('click', closeModal);
  $('#ml_save').addEventListener('click', () => {
    const c = $('#ml_cat').value; const cals = parseFloat($('#ml_cals').value); if (!cals) return flash($('#ml_save'), '先估算或填卡路里');
    const done = (imgId) => {
      const r = sportRec(todayStr()); if (!r.meals) r.meals = { 早: [], 午: [], 晚: [], 加: [] };
      r.meals[c].push({ name: $('#ml_food').value.trim(), cals, img: imgId || '', ts: Date.now() });
      save('sport_' + todayStr(), r); closeModal(); renderSports();
    };
    if (mealImg) storeImg(mealImg).then(done).catch(() => done(mealImg)); else done('');
  });
}

/* ===================== 0. 首页 ===================== */
const HOME_QUOTES = [
  '自律给我自由。',
  '慢慢来，比较快。',
  '复利是世界第八奇迹。',
  '把每一天都过成想要的样子。',
  '温柔坚持，胜过激烈爆发。',
  '今天比昨天好一点点就好。',
  '不积跬步，无以至千里。',
  '种一棵树最好的时间是十年前，其次是现在。',
  '把注意力放在过程上，结果自然会来。',
  '每一次小进步，都值得被看见。',
  '允许自己慢一点，但不要停。',
  '今天不焦虑明天的事，先做眼前这一件。',
  '你不需要完美，你需要开始。',
  '心力 > 体力 > 能力。',
  '凡是过往，皆为序章。',
  '越自律，越自由。',
  '做难而正确的事。',
  '把期待降低，把行动拉满。',
  '持续的小赢，会积累成大胜。',
  '先完成，再完美。',
  '重要的不是跑得快，而是跑得久。',
  '日拱一卒，功不唐捐。',
  '保持热爱，奔赴山海。',
  '心定，则万事可成。',
  '善待自己，是最高的远见。',
  '别让「等一下」变成「再也不」。',
  '把生活调成喜欢的频道。',
  '今天的事，今天用心做。',
  '时间花在哪里，是看得见的。',
  '少即是多，慢即是快。',
];
const HOT_NEWS = [
  { cat: 'AI', title: 'GPT-5 即将发布，多模态与推理能力大幅升级', url: 'https://www.example.com/?news=gpt5' },
  { cat: 'AI', title: '国产大模型 DeepSeek-V4 训练成本降低 40%', url: 'https://www.example.com/?news=deepseek' },
  { cat: 'AI', title: 'AI 编程助手 Cursor 推出 Agent 模式', url: 'https://www.example.com/?news=cursor' },
  { cat: '科技', title: '苹果发布会定档 9 月，iPhone 17 Pro 影像再升级', url: 'https://www.example.com/?news=iphone17' },
  { cat: '科技', title: '华为 Mate 70 全系搭载鸿蒙 Next，生态全面升级', url: 'https://www.example.com/?news=mate70' },
  { cat: '科技', title: '小米 SU7 Ultra 量产版开放预订', url: 'https://www.example.com/?news=su7' },
  { cat: '经济', title: '美联储宣布维持利率不变，鲍威尔发言偏鸽', url: 'https://www.example.com/?news=fed' },
  { cat: '经济', title: 'A股三大指数集体高收，新能源板块领涨', url: 'https://www.example.com/?news=a-share' },
  { cat: '经济', title: '比特币突破 12 万美元，机构持仓创新高', url: 'https://www.example.com/?news=btc' },
  { cat: '经济', title: '黄金价格创历史新高，现货突破 2700 美元/盎司', url: 'https://www.example.com/?news=gold' },
  { cat: '职场', title: '远程办公成新常态，90 后成最大受益群体', url: 'https://www.example.com/?news=remote' },
  { cat: '职场', title: 'LinkedIn 报告：AI 技能需求同比增长 70%', url: 'https://www.example.com/?news=ai-skill' },
  { cat: '职场', title: '大厂校招启动，算法岗竞争比再创新高', url: 'https://www.example.com/?news=campus' },
  { cat: '健康', title: '国家卫健委发布最新睡眠指南，建议 7–8 小时', url: 'https://www.example.com/?news=sleep' },
  { cat: '健康', title: '新研究：每周 150 分钟运动降低抑郁风险 30%', url: 'https://www.example.com/?news=exercise' },
  { cat: '健康', title: '控糖饮食风潮兴起，专家建议因人而异', url: 'https://www.example.com/?news=sugar' },
  { cat: '生活', title: 'City Walk 成为年轻人新生活方式', url: 'https://www.example.com/?news=citywalk' },
  { cat: '生活', title: '早 C 晚 A 护肤公式风靡，小红书相关笔记超 500 万', url: 'https://www.example.com/?news=skincare' },
  { cat: '生活', title: '「多巴胺穿搭」持续走红，色彩心理学受关注', url: 'https://www.example.com/?news=dopamine' },
  { cat: '时尚', title: '极简风回潮，MUJI 无印良品同店销售创新高', url: 'https://www.example.com/?news=muji' },
  { cat: '时尚', title: '国潮品牌出海，SHEIN 蝉联全球快时尚第一', url: 'https://www.example.com/?news=shein' },
  { cat: '教育', title: '教育部发布「AI 素养」框架，将纳入中小学课程', url: 'https://www.example.com/?news=ai-edu' },
  { cat: '教育', title: '考研报名人数连降三年，专硕成新热门', url: 'https://www.example.com/?news=kaoyan' },
  { cat: '娱乐', title: '短剧出海爆款频出，《ReelShort》登顶美国 App Store', url: 'https://www.example.com/?news=short-drama' },
  { cat: '娱乐', title: '演唱会经济持续升温，二三线城市成新票仓', url: 'https://www.example.com/?news=concert' },
  { cat: '出行', title: '中秋国庆双节叠加，国内旅游订单同比增 35%', url: 'https://www.example.com/?news=holiday' },
  { cat: '出行', title: '高铁「优选一等座」上线，多档票价任选', url: 'https://www.example.com/?news=hsr' },
  { cat: '房产', title: '一线城市二手房成交量企稳，挂牌均价小幅回升', url: 'https://www.example.com/?news=house' },
  { cat: '汽车', title: '新能源车渗透率突破 55%，燃油车加速退场', url: 'https://www.example.com/?news=nev' },
  { cat: '女性', title: '「她经济」持续升级，女性消费决策权上升', url: 'https://www.example.com/?news=her-econ' },
  { cat: '女性', title: '女性创业者占比突破 35%，成新增长极', url: 'https://www.example.com/?news=her-startup' },
  { cat: '女性', title: '《2025 女性健康报告》：心理健康成为首要关注', url: 'https://www.example.com/?news=her-health' },
];
function dayIndex(d) {
  const x = d || new Date();
  return Math.floor((x - new Date(x.getFullYear(), 0, 0)) / 86400000);
}
function nextDailyAt(hour) {
  const n = new Date();
  const t = new Date(n.getFullYear(), n.getMonth(), n.getDate(), hour, 0, 0);
  if (t <= n) t.setDate(t.getDate() + 1);
  return t;
}
function homeGreetingText(h) {
  if (h < 5) return '夜深了，早点休息呀';
  if (h < 11) return '早安，新的一天开始啦';
  if (h < 14) return '中午好，记得好好吃饭';
  if (h < 18) return '下午好，保持节奏';
  if (h < 22) return '晚上好，今天辛苦啦';
  return '夜深了，早点休息呀';
}
function homeSubtitle(h) {
  if (h < 5) return '辛苦了，明天也要加油 🌙';
  if (h < 11) return '今天也是温柔坚持的一天 💪';
  if (h < 14) return '下午继续冲，你可以的 ☀️';
  if (h < 18) return '专注当下，慢慢来 🌿';
  if (h < 22) return '复盘一下，给自己一个肯定 🌆';
  return '明天又是新开始 ✨';
}
function greetingNow() {
  const h = new Date().getHours();
  return [homeGreetingText(h) + '，' + load('home_name', '勇敢小姐'), homeSubtitle(h)];
}
function recentActivity() {
  const out = [];
  const day = todayStr();
  const cats = ['早', '午', '晚', '加'];
  const rec = sportRec(day);
  cats.forEach((c) => (rec.meals[c] || []).forEach((f) => { if (f.cals) out.push({ icon: '🍽', text: c + '餐：' + (f.name || '食物') + ' ' + f.cals + ' kcal', ts: f.ts || 0 }); }));
  (rec.items || []).filter((i) => i.done && i.kcal).forEach((it) => out.push({ icon: '🏃', text: '运动：' + it.name + ' ' + it.kcal + ' kcal', ts: it.ts || 0 }));
  const mk = load('mood_' + day, {}); if (mk.mood) out.push({ icon: '💗', text: '心情：' + mk.mood + (mk.note ? '「' + mk.note.slice(0, 12) + (mk.note.length > 12 ? '…' : '') + '」' : ''), ts: mk.ts || 0 });
  const rl = load('read_log_' + day, {}); if (rl && rl.minutes) out.push({ icon: '📖', text: '阅读 ' + rl.minutes + ' 分钟', ts: rl.ts || 0 });
  const tx = load('tx', []).filter((x) => x.date === day); if (tx.length) out.push({ icon: '💰', text: '今日 ' + tx.length + ' 笔账单', ts: new Date(day + 'T12:00').getTime() });
  const tasks = load('tasks', []).map(normTask); const done = tasks.filter((x) => x.done).length; if (tasks.length) out.push({ icon: '📋', text: '待办完成 ' + done + '/' + tasks.length, ts: 0 });
  out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return out.slice(0, 8);
}
const homeState = { newsTab: 'zhihu', newsOffset: { zhihu: 0, douyin: 0, weibo: 0, finance: 0 }, newsCount: {}, quoteStart: 0, clockTimer: null, lastDayKey: '' };
function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function homeClockStr(d) { d = d || new Date(); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function homeDateStr(d) { d = d || new Date(); return (d.getMonth() + 1) + '月' + d.getDate() + '日 · ' + '周' + '日一二三四五六'[d.getDay()]; }
function pickQuoteForToday() {
  return HOME_QUOTES[dayIndex() % HOME_QUOTES.length];
}
function fmtHot(n) {
  if (!n) return '';
  if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿';
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  return String(n);
}
// 日期种子：同一天稳定、跨天变化，用于「每日智能更新」的确定性轮换
function dateSeed(str) { let h = 2166136261; for (let i = 0; i < String(str).length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function dailyRot(n) { return dateSeed(todayStr()) % (n || 1); }
// 实时热榜数据源：多源容错，浏览器可直接跨域请求
const NEWS_SOURCES = [
  { key: 'zhihu', label: '知乎', icon: '💡', viki: 'zhihu' },
  { key: 'douyin', label: '抖音', icon: '🎵', viki: 'douyin' },
  { key: 'weibo', label: '微博', icon: '🔥', viki: 'weibo' },
  { key: 'finance', label: '财经', icon: '📈', viki: 'toutiao' },
];
// 实时热榜策略：
// ① 可选「自托管后端」（用户在新闻卡片⚙里填的 Cloudflare Worker，服务端抓取真实数据、带 CORS）；
// ② 未配置后端时，主源用 60s-api（开源、CORS 开放、实时热榜）的多个公共实例（含大陆可达镜像）按顺序兜底；
// ③ 仍失败才回退到旧多源 / 精选。
const NEWS_BACKEND = () => load('news_api', '').trim();
const PROXY = 'https://api.allorigins.win/raw?url=';
const PROXY2 = 'https://api.codetabs.com/v1/proxy/?quest=';
function proxyUrl(u, p) { return (p || PROXY) + encodeURIComponent(u); }
// 60s-api 公共实例：前两个是大陆可达镜像（优先），末尾为官方主域作保底。均开放 CORS。
const VIKI_MIRRORS = [
  'https://60s.crystelf.top/v2',
  'https://60s.zellon.top/v2',
  'https://60s-api.viki.moe/v2',
];
async function fetchViki(tab) {
  const ep = (NEWS_SOURCES.find((s) => s.key === tab) || {}).viki;
  if (!ep) return [];
  for (const base of VIKI_MIRRORS) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 9000);
    try {
      const r = await fetch(base + '/' + ep, { signal: ctrl.signal });
      clearTimeout(to);
      if (!r.ok) continue;
      const j = await r.json();
      if (!j || j.code !== 200 || !Array.isArray(j.data) || !j.data.length) continue;
      const items = j.data.slice(0, 40).map((it) => {
        let url = it.link || it.url || '';
        if (!url && tab === 'zhihu') url = 'https://www.zhihu.com/search?type=content&q=' + encodeURIComponent(it.title || '');
        return { title: String(it.title || '').trim(), hot: Number(it.hot_value || it.hot || 0), url };
      }).filter((x) => x.title);
      if (items.length) return items;
    } catch (e) { try { clearTimeout(to); } catch (_) {} }
  }
  return [];
}
const NEWS_PROVIDERS = {
  zhihu: [
    { url: 'https://api-hot.imsyy.top/zhihu' },
    { url: 'https://api.vvhan.com/api/hotlist/zhihu' },
    { url: 'https://uapis.cn/v1/zhihuHot' },
    { url: 'https://api.oioweb.cn/api/common/HotList?type=zhihu' },
    { url: 'https://api.codelife.cc/api/top/list?id=zhihu' },
    { url: 'https://tenapi.cn/v2/zhihu' },
  ],
  douyin: [
    { url: 'https://api-hot.imsyy.top/douyin' },
    { url: 'https://api.vvhan.com/api/hotlist/douyin' },
    { url: 'https://uapis.cn/v1/douyinHot' },
    { url: 'https://api.oioweb.cn/api/common/HotList?type=douyin' },
    { url: 'https://api.codelife.cc/api/top/list?id=douyin' },
  ],
  weibo: [
    { url: 'https://api-hot.imsyy.top/weibo' },
    { url: 'https://api.vvhan.com/api/hotlist/weibo' },
    { url: 'https://uapis.cn/v1/weiboHot' },
    { url: 'https://api.oioweb.cn/api/common/HotList?type=weibo' },
    { url: 'https://api.codelife.cc/api/top/list?id=weibo' },
  ],
  finance: [
    { url: proxyUrl('https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2509&num=15&page=1'), proxy: true, name: '新浪财经' },
    { url: proxyUrl('https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2509&num=15&page=1', PROXY2), proxy: true, name: '新浪财经(代理2)' },
  ],
};
function extractNews(j) {
  const cands = [];
  if (Array.isArray(j)) cands.push(j);
  else if (j && typeof j === 'object') {
    ['data', 'list', 'rows', 'items'].forEach((k) => {
      const v = j[k];
      if (Array.isArray(v)) cands.push(v);
      else if (v && typeof v === 'object') {
        if (Array.isArray(v.data)) cands.push(v.data);
        else if (Array.isArray(v.list)) cands.push(v.list);
        else if (Array.isArray(v.items)) cands.push(v.items);
      }
    });
    if (j.result && Array.isArray(j.result.data)) cands.push(j.result.data);
  }
  const arr = cands[0] || [];
  if (!arr.length) return [];
  return arr.slice(0, 40).map((it) => {
    if (!it || typeof it !== 'object') return null;
    return {
      title: String(it.title || it.name || it.word || it.content || it.text || it.q || '').trim(),
      hot: Number(it.hot || it.heat || it.index || it.hotScore || it.score || it.num || it.show || 0),
      url: it.url || it.link || it.mobileUrl || it.href || it.mobile_url || '',
    };
  }).filter((x) => x && x.title);
}
async function fetchOneNews(spec) {
  const direct = async (u, ms) => {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), ms || 10000);
    try {
      const r = await fetch(u, { signal: ctrl.signal });
      clearTimeout(to);
      if (!r.ok) return [];
      let j; try { j = await r.json(); } catch (e) { return []; }
      return extractNews(j);
    } catch (e) { clearTimeout(to); return []; }
  };
  if (spec.proxy) return direct(spec.url, 18000);
  let items = await direct(spec.url, 12000);
  if (items.length) return items;
  // 直连失败（CORS / 网络），依次再经两个 CORS 代理取
  items = await direct(proxyUrl(spec.url, PROXY), 18000);
  if (items.length) return items;
  return direct(proxyUrl(spec.url, PROXY2), 18000);
}
function hotNewsCacheKey(tab) { return 'hotnews_' + tab; }
async function getHotNews(tab, force) {
  const ck = hotNewsCacheKey(tab);
  const now = Date.now();
  const cached = load(ck, null);
  if (!force && cached && cached.ts && now - cached.ts < 5 * 60 * 1000 && cached.items && cached.items.length) {
    return { items: cached.items, live: cached.live, fetchedAt: cached.fetchedAt || cached.ts, src: cached.src || '' };
  }
  // 1) 优先：用户自托管后端（服务端抓取真实数据，最稳）
  const backend = NEWS_BACKEND();
  if (backend) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 12000);
      const sep = backend.includes('?') ? '&' : '?';
      const r = await fetch(backend + sep + 'tab=' + encodeURIComponent(tab), { signal: ctrl.signal });
      clearTimeout(to);
      if (r.ok) { const j = await r.json(); const items = extractNews(j); if (items.length) { const fa = Date.now(); save(ck, { items, live: true, ts: fa, fetchedAt: fa, src: '后端' }); return { items, live: true, fetchedAt: fa, src: '后端' }; } }
    } catch (e) { /* 后端不可用，转前端兜底 */ }
  }
  // 2) 主源：60s-api 公共实例（CORS 开放、实时，无需后端）
  let items = await fetchViki(tab);
  let src = '实时热榜';
  let live = items.length > 0;
  // 3) 兜底：旧多源直连 + 多级代理
  if (!live) {
    const specs = NEWS_PROVIDERS[tab] || [];
    for (const sp of specs) { const r = await fetchOneNews(sp); if (r.length) { items = r; src = sp.name || '热榜'; live = true; break; } }
  }
  // 4) 末级：精选（仅在全部实时源不可达时）
  if (!live) {
    const fbAll = HOT_NEWS.slice();
    items = tab === 'finance' ? fbAll.filter((x) => /经济|财经|金融|股票|黄金|比特|基金/.test(x.cat)) : fbAll;
    src = '精选';
  }
  const fa = Date.now();
  save(ck, { items, live, ts: fa, fetchedAt: fa, src });
  return { items, live, fetchedAt: fa, src };
}
async function renderNewsList(force) {
  const listEl = $('#newsList'); if (!listEl) return;
  const tab = homeState.newsTab || 'zhihu';
  const badge = $('#newsBadge');
  const subEl = $('#newsSub');
  listEl.innerHTML = '<div class="news-loading">正在获取实时热点…</div>';
  let data;
  try { data = await getHotNews(tab, force); } catch (e) { data = { items: HOT_NEWS.slice(), live: false, fetchedAt: Date.now(), src: '' }; }
  const t = data.fetchedAt ? new Date(data.fetchedAt) : new Date();
  const tsLabel = pad2(t.getHours()) + ':' + pad2(t.getMinutes());
  if (badge) { badge.textContent = data.live ? '实时' : '精选'; badge.className = 'news-badge ' + (data.live ? 'live' : 'curated'); }
  if (subEl) {
    if (data.live) subEl.textContent = '实时热榜 · 更新于 ' + tsLabel + ' · 点击标题看原文';
    else if (!NEWS_BACKEND()) subEl.textContent = '实时源暂不可达，显示精选 · 点 ⚙ 配置后端即可看实时热榜 · 更新于 ' + tsLabel;
    else subEl.textContent = '后端暂不可用，显示精选 · 更新于 ' + tsLabel;
  }
  const per = 8;
  const off = homeState.newsOffset[tab] || 0;
  homeState.newsCount[tab] = data.items.length;
  const page = data.items.slice(off, off + per);
  if (!page.length) { listEl.innerHTML = '<div class="empty">暂无数据</div>'; return; }
  listEl.innerHTML = page.map((n, i) => `
    <a class="news-item" href="${escapeHtml(n.url || 'javascript:void(0)')}" target="_blank" rel="noopener">
      <span class="news-idx">${off + i + 1}</span>
      <span class="news-title">${escapeHtml(n.title)}</span>
      ${n.hot ? `<span class="news-hot">🔥${escapeHtml(fmtHot(n.hot))}</span>` : ''}
      <span class="news-go">›</span>
    </a>`).join('');
}
async function genAiNews() {
  const cfg = loadAICfg();
  if (!cfg.key) { alert('需要先配置 AI Key 才能用 AI 解读。请到「学习复盘 → ⚙️ AI 分析设置」填写 DeepSeek Key（很便宜，几块钱能用很久）。'); return; }
  const tab = homeState.newsTab || 'zhihu';
  const src = NEWS_SOURCES.find((s) => s.key === tab) || {};
  const cached = load(hotNewsCacheKey(tab), null);
  const items = (cached && cached.items) || [];
  if (!items.length) { alert('先点一下「🔄 刷新」拿到实时热榜，再让 AI 解读～'); return; }
  const box = $('#newsAiBox'); if (!box) return;
  box.style.display = '';
  box.innerHTML = '<div class="ai-think">🤖 AI 正在解读今日' + escapeHtml(src.label || '') + '热点…</div>';
  const top = items.slice(0, 10).map((x, i) => (i + 1) + '. ' + x.title).join('\n');
  try {
    const r = await callAI([
      { role: 'system', content: '你是时事解读助手，擅长把热榜变成普通人能懂、有温度的洞察，不啰嗦。' },
      { role: 'user', content: '以下是今天「' + (src.label || '热榜') + '」热榜前 10 条：\n' + top + '\n\n请输出：\n① 一句话概括今天大家最关心什么；\n② 挑 2 条最值得关注的，各用 1 句话说明「为什么热 / 和普通人有什么关系」；\n③ 给内容创作者 1 个可蹭的选题角度。\n口语化、有温度，不超过 220 字。' },
    ]);
    box.innerHTML = '<div class="ai-digest"><div class="ai-digest-h">🤖 AI 今日热点解读（' + escapeHtml(src.label || '') + '）</div>' + escapeHtml(r).replace(/\n/g, '<br>') + '</div>';
  } catch (e) { box.innerHTML = '<div class="ai-think">AI 解读失败：' + escapeHtml(e.message) + '</div>'; }
}function nextUpdateLabel() {
  const t = nextDailyAt(9);
  return (t.getMonth() + 1) + '/' + t.getDate() + ' 09:00';
}
async function renderHome() {
  const box = $('#homeBody'); if (!box) return;
  const name = load('home_name', '勇敢小姐');
  const now = new Date();
  const safeName = escapeHtml(name);
  const greeting = homeGreetingText(now.getHours()) + '，<span class="ht-name" id="htName" title="点击修改">' + safeName + '</span>';
  const sub = homeSubtitle(now.getHours());
  const clock = homeClockStr(now);
  const date = homeDateStr(now);
  const tasks = load('tasks', []).map(normTask);
  const todo = tasks.filter((t) => !t.done && !t.shelved).length;
  const done = tasks.filter((t) => t.done && !t.shelved).length;
  const total = tasks.filter((t) => !t.shelved).length;
  const donePct = total ? Math.round((done / total) * 100) : 0;
  const sp = sportRec(todayStr());
  const burned = sportBurn(sp);
  const checkinRate = total ? donePct : 0;
  const quote = HOME_QUOTES[homeState.quoteStart % HOME_QUOTES.length];
  const acts = recentActivity();
  const nextLbl = nextUpdateLabel();
  box.innerHTML = `
    <div class="home-top">
      <div class="ht-hi">${greeting}</div>
      <div class="ht-sub">${escapeHtml(sub)}</div>
      <div class="ht-time" id="htClock">${clock}</div>
      <div class="ht-date">${escapeHtml(date)}</div>
    </div>

    <div class="home-hero">
      <div class="hero-icon" aria-hidden="true">🎀</div>
      <div class="hero-title">${escapeHtml(name)}工作台</div>
      <div class="hero-tagline">「温柔坚持，复利成长」</div>
      <div class="hero-sub">小伴陪你把每一天都过成想要的样子</div>
    </div>

    <div class="quote-bar">
      <span class="quote-icon">💬</span>
      <div class="quote-text" id="homeQuote">${escapeHtml(quote)}</div>
      <button class="quote-refresh" id="quoteRefresh">🔄 换一句</button>
    </div>

    <div class="home-stats">
      <div class="stat-card stat-green"><div class="stat-num">${done}</div><div class="stat-label">今日完成</div></div>
      <div class="stat-card stat-blue"><div class="stat-num">${todo}</div><div class="stat-label">待办任务</div></div>
      <div class="stat-card stat-yellow"><div class="stat-num">${checkinRate}%</div><div class="stat-label">打卡进度</div></div>
    </div>

    <div class="home-news card">
      <div class="news-head">
        <h3>📰 今日热点</h3>
        <span class="news-badge curated" id="newsBadge">精选</span>
        <button class="btn-ghost news-ai" id="newsAi" title="AI 解读今日热点">✨ AI</button>
        <button class="btn-ghost news-gear" id="newsGear" title="配置实时热榜后端">⚙</button>
        <button class="btn-ghost news-refresh" id="newsRefresh">🔄 刷新</button>
      </div>
      <div class="news-tabs" id="newsTabs">
        ${NEWS_SOURCES.map((s) => `<button class="news-tab${s.key === homeState.newsTab ? ' active' : ''}" data-tab="${s.key}">${s.icon} ${s.label}</button>`).join('')}
      </div>
      <div class="news-list" id="newsList"></div>
      <div class="news-ai-box" id="newsAiBox" style="display:none"></div>
      <div class="news-sub muted" id="newsSub">实时热榜数据 · 点击标题查看原文</div>
    </div>

    <div class="card"><h3>🕒 最近动态</h3>${acts.length ? '<div class="act-list">' + acts.map((a) => `<div class="act"><span class="act-ic">${a.icon}</span><span class="act-tx">${escapeHtml(a.text)}</span>${a.ts ? `<span class="act-time">${fmtTime(a.ts)}</span>` : ''}</div>`).join('') + '</div>' : '<div class="empty">今天还没有动态，去记录点什么吧～</div>'}</div>

    <div class="card backup-card">
      <h3>💾 数据备份</h3>
      <p class="muted" style="font-size:12px;margin:4px 0 10px">你的数据保存在本机浏览器。换设备 / 清缓存前请先「导出备份」；「导入备份」可完整恢复全部数据与图片。</p>
      <div class="backup-btns">
        <button class="btn-ghost" id="btnExport">⬇️ 导出备份</button>
        <button class="btn-ghost" id="btnImport">⬆️ 导入备份</button>
        <input type="file" id="backupFile" accept="application/json" style="display:none">
      </div>
    </div>`;

  $('#quoteRefresh').addEventListener('click', () => { homeState.quoteStart++; const q = $('#homeQuote'); if (q) q.textContent = HOME_QUOTES[homeState.quoteStart % HOME_QUOTES.length]; });
  $('#newsRefresh').addEventListener('click', () => {
    homeState.newsOffset[homeState.newsTab] = 0;
    renderNewsList(true);
  });
  const aiNewsBtn = $('#newsAi'); if (aiNewsBtn) aiNewsBtn.addEventListener('click', genAiNews);
  const gear = $('#newsGear'); if (gear) gear.addEventListener('click', () => {
    const cur = NEWS_BACKEND();
    const v = prompt('配置实时热榜后端地址（Cloudflare Worker 等，返回带 CORS 的 JSON）。\n留空则用前端多源兜底。\n当前：' + (cur || '（未配置）'), cur);
    if (v === null) return;
    save('news_api', v.trim());
    renderNewsList(true);
  });
  document.querySelectorAll('#newsTabs .news-tab').forEach((b) => {
    b.addEventListener('click', () => {
      const t = b.getAttribute('data-tab');
      homeState.newsTab = t;
      document.querySelectorAll('#newsTabs .news-tab').forEach((x) => x.classList.toggle('active', x === b));
      renderNewsList();
    });
  });
  const nameEl = $('#htName'); if (nameEl) nameEl.addEventListener('click', () => { const v = prompt('给自己起个昵称吧～', load('home_name', '勇敢小姐')); if (v && v.trim()) { save('home_name', v.trim().slice(0, 12)); renderHome(); } });
  const expBtn = $('#btnExport'); if (expBtn) expBtn.addEventListener('click', exportBackup);
  const impBtn = $('#btnImport'); if (impBtn) impBtn.addEventListener('click', () => { const f = $('#backupFile'); if (f) f.click(); });
  const bf = $('#backupFile'); if (bf) bf.addEventListener('change', (e) => { const file = e.target.files && e.target.files[0]; importBackup(file); e.target.value = ''; });
  renderNewsList();

  const tick = () => { const c = $('#htClock'); if (c) c.textContent = homeClockStr(); const dt = $('#htDate'); if (dt) dt.textContent = homeDateStr(); const k = todayStr(); if (homeState.lastDayKey && homeState.lastDayKey !== k) { homeState.quoteStart = dayIndex(); homeState.lastDayKey = k; const q = $('#homeQuote'); if (q) q.textContent = HOME_QUOTES[homeState.quoteStart % HOME_QUOTES.length]; NEWS_SOURCES.forEach((s) => { save(hotNewsCacheKey(s.key), null); homeState.newsOffset[s.key] = 0; }); renderNewsList(); } homeState.lastDayKey = k; };
  if (homeState.clockTimer) clearInterval(homeState.clockTimer);
  homeState.clockTimer = setInterval(tick, 30000);
  tick();
}
function initHome() { renderHome(); }

/* ===================== 7. 每日英语 ===================== */
const ENG_THEMES = {
  '日常交际': {
    sentences: [
      ['Hi, how are you doing today?', '嗨，你今天过得怎么样？'],
      ['Could you please repeat that?', '你能再说一遍吗？'],
      ['I am just looking around, thanks.', '我只是随便看看，谢谢。'],
      ['Let us grab a coffee sometime.', '我们改天一起去喝杯咖啡吧。'],
      ['Sorry, I did not catch your name.', '抱歉，我没听清你的名字。'],
      ['That sounds like a great idea!', '这听起来是个好主意！'],
      ['Do you have any recommendations?', '你有什么推荐吗？'],
      ['I really appreciate your help.', '我非常感谢你的帮助。'],
      ['What do you usually do on weekends?', '你周末通常做什么？'],
      ['It was nice talking to you.', '很高兴和你聊天。'],
    ],
    words: [
      ['greeting', '问候', 'n.'], ['introduce', '介绍', 'v.'], ['friendly', '友好的', 'adj.'],
      ['conversation', '对话', 'n.'], ['suggest', '建议', 'v.'], ['polite', '礼貌的', 'adj.'],
      ['invite', '邀请', 'v.'], ['neighbor', '邻居', 'n.'], ['chat', '聊天', 'n./v.'],
      ['thanks', '谢谢', 'n.'], ['sorry', '抱歉', 'adj.'], ['understand', '理解', 'v.'],
      ['repeat', '重复', 'v.'], ['recommend', '推荐', 'v.'], ['appreciate', '感激', 'v.'],
      ['weekend', '周末', 'n.'], ['coffee', '咖啡', 'n.'], ['favorite', '最喜欢的', 'adj.'],
      ['habit', '习惯', 'n.'], ['relax', '放松', 'v.'],
    ],
  },
  '职场沟通': {
    sentences: [
      ['I will send you the file by email.', '我会用邮件把文件发给你。'],
      ['Could we schedule a meeting tomorrow?', '我们明天能安排个会议吗？'],
      ['Let me double-check the numbers.', '让我再核对一下数字。'],
      ['I am responsible for this project.', '我负责这个项目。'],
      ['Can you give me some feedback?', '你能给我一些反馈吗？'],
      ['We need to meet the deadline.', '我们需要赶上截止日期。'],
      ['I agree with your point.', '我同意你的观点。'],
      ['Please keep me updated.', '请随时让我了解进展。'],
      ['Let us brainstorm some ideas.', '我们来头脑风暴一下吧。'],
      ['I will follow up on this.', '我会跟进这件事。'],
    ],
    words: [
      ['deadline', '截止日期', 'n.'], ['feedback', '反馈', 'n.'], ['meeting', '会议', 'n.'],
      ['project', '项目', 'n.'], ['schedule', '安排', 'v.'], ['responsible', '负责的', 'adj.'],
      ['report', '报告', 'n./v.'], ['client', '客户', 'n.'], ['task', '任务', 'n.'],
      ['progress', '进展', 'n.'], ['agree', '同意', 'v.'], ['suggest', '建议', 'v.'],
      ['confirm', '确认', 'v.'], ['discuss', '讨论', 'v.'], ['improve', '改善', 'v.'],
      ['deadline', '截止', 'n.'], ['manager', '经理', 'n.'], ['team', '团队', 'n.'],
      ['goal', '目标', 'n.'], ['efficient', '高效的', 'adj.'],
    ],
  },
  '旅行出行': {
    sentences: [
      ['Where is the nearest subway station?', '最近的地铁站在哪？'],
      ['I would like to book a room.', '我想订一间房。'],
      ['How much does this cost?', '这个多少钱？'],
      ['Could you take a photo for us?', '能帮我们拍张照吗？'],
      ['Is breakfast included?', '含早餐吗？'],
      ['What time does it open?', '它几点开门？'],
      ['I am looking for the bus stop.', '我在找公交车站。'],
      ['Can I have the bill, please?', '请给我账单好吗？'],
      ['Excuse me, where is the restroom?', '打扰一下，洗手间在哪？'],
      ['I need a map of the city.', '我需要一张城市地图。'],
    ],
    words: [
      ['subway', '地铁', 'n.'], ['station', '车站', 'n.'], ['book', '预订', 'v.'],
      ['luggage', '行李', 'n.'], ['passport', '护照', 'n.'], ['flight', '航班', 'n.'],
      ['airport', '机场', 'n.'], ['ticket', '票', 'n.'], ['hotel', '酒店', 'n.'],
      ['restroom', '洗手间', 'n.'], ['map', '地图', 'n.'], ['guide', '指南', 'n.'],
      ['souvenir', '纪念品', 'n.'], ['currency', '货币', 'n.'], ['weather', '天气', 'n.'],
      ['beach', '海滩', 'n.'], ['temple', '寺庙', 'n.'], ['local', '当地的', 'adj.'],
      ['trip', '旅行', 'n.'], ['route', '路线', 'n.'],
    ],
  },
  '情感表达': {
    sentences: [
      ['I feel a bit stressed lately.', '我最近有点压力大。'],
      ['You mean a lot to me.', '你对我很重要。'],
      ['I am proud of what you did.', '我为你做的事感到骄傲。'],
      ['It is okay to not be okay.', '不开心也没关系。'],
      ['Thank you for being there.', '谢谢你一直都在。'],
      ['I miss you so much.', '我好想你。'],
      ['Let us talk about it.', '我们聊聊这件事吧。'],
      ['I trust your judgment.', '我信任你的判断。'],
      ['You made my day.', '你让我今天很开心。'],
      ['I am here for you.', '我陪着你。'],
    ],
    words: [
      ['stress', '压力', 'n.'], ['proud', '骄傲的', 'adj.'], ['miss', '想念', 'v.'],
      ['trust', '信任', 'v.'], ['lonely', '孤独的', 'adj.'], ['comfort', '安慰', 'n./v.'],
      ['grateful', '感激的', 'adj.'], ['calm', '平静的', 'adj.'], ['warm', '温暖的', 'adj.'],
      ['support', '支持', 'v./n.'], ['worry', '担心', 'v.'], ['happy', '开心的', 'adj.'],
      ['sad', '难过的', 'adj.'], ['angry', '生气的', 'adj.'], ['understand', '理解', 'v.'],
      ['share', '分享', 'v.'], ['care', '在乎', 'v.'], ['feel', '感觉', 'v.'],
      ['heart', '心', 'n.'], ['smile', '微笑', 'n./v.'],
    ],
  },
};
let engTheme = '日常交际';
// 每日金句池：按日期种子每天展示不同一句，保证「每日更新」
const ENG_DAILY_QUOTES = [
  'Small steps every day lead to big changes.', 'Progress, not perfection.', 'You are exactly where you need to be.',
  'Discipline is choosing what you want most over what you want now.', 'A little progress each day adds up to big results.',
  'Be gentle with yourself; you are doing your best.', 'Consistency beats intensity.', 'Today is a fresh start.',
  'The expert in anything was once a beginner.', 'Growth happens outside your comfort zone.', 'Rest is part of the work.',
  'You don’t have to be great to start, but you have to start to be great.', 'One task at a time, one day at a time.',
  'Your future self will thank you for today’s effort.', 'It’s okay to go slow, just don’t stop.', 'Show up for yourself daily.',
  'Small habits, remarkable results.', 'Confidence comes from doing the work.', 'Make peace with the pace.',
  'Every day is a chance to begin again.', 'Learn something new today, however small.', 'Kindness begins with yourself.',
  'Focus on progress, not comparison.', 'You are capable of more than you know.', 'Breathe, then begin.',
  'Dreams don’t work unless you do.', 'The best time to start was today.', 'Keep showing up; it compounds.',
];
function dailyEngHtml() {
  const seed = dateSeed(todayStr());
  const q = ENG_DAILY_QUOTES[seed % ENG_DAILY_QUOTES.length];
  const ai = load('ai_eng_' + todayStr(), null);
  const aiHtml = (ai && ai.sentences && ai.sentences.length) ? `<div class="card daily-ai"><div class="ic-top"><b>✨ AI 今日特供 · ${fmtDate(new Date())}</b></div>${ai.sentences.map((s) => `<div class="eng-sent"><div class="es-top"><span class="es-en">${escapeHtml(s.en)}</span><button class="mini-btn" data-spk="${encodeURIComponent(s.en)}">🔊</button></div><div class="es-zh">${escapeHtml(s.zh)}</div></div>`).join('')}</div>` : '';
  return `<div class="card daily-banner">
    <div class="ic-top"><b>📅 每日英语 · 已更新</b><span class="muted">${fmtDate(new Date())}</span></div>
    <div class="daily-quote">“${escapeHtml(q)}”</div>
    <button class="btn-ghost" id="engAi">✨ AI 生成今日特供</button>
  </div>${aiHtml}`;
}
async function genAiEng() {
  const cfg = loadAICfg();
  if (!cfg.key) { alert('还没配置 AI Key。请到「学习复盘 → ⚙️ AI 分析设置」填写 DeepSeek Key 后即可用 AI 生成当日专属英语。'); return; }
  const btn = $('#engAi'); if (btn) { btn.disabled = true; btn.textContent = '生成中…'; }
  try {
    const r = await callAI([
      { role: 'system', content: '你是英语老师，给用户每天 5 个实用英语句子（生活/职场场景），附带中文翻译。' },
      { role: 'user', content: '请输出 5 个今日英语句子。每行格式：英文 | 中文。只输出内容，不要序号外的多余说明。' },
    ]);
    const sentences = r.split('\n').map((x) => x.trim()).filter(Boolean).map((line) => { const p = line.split('|'); return { en: (p[0] || '').replace(/^[\d\.、\-\s]+/, '').trim(), zh: (p[1] || '').trim() }; }).filter((s) => s.en);
    if (sentences.length) { save('ai_eng_' + todayStr(), { sentences }); renderEnglish(); }
  } catch (e) { alert('AI 生成失败：' + e.message); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '✨ AI 生成今日特供'; } }
}
function engThemeOfDay() {
  const keys = Object.keys(ENG_THEMES);
  return keys[(new Date().getDate() + new Date().getMonth()) % keys.length];
}
function speakEn(text) {
  if (!('speechSynthesis' in window)) { alert('当前浏览器不支持语音朗读'); return; }
  const u = new SpeechSynthesisUtterance(text); u.lang = 'en-US'; u.rate = 0.92; window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
}
function engLoad() { return load('eng_' + todayStr(), { sentences: {}, words: {}, minutes: 0 }); }
function engSave(d) { save('eng_' + todayStr(), d); }
function engStreakInfo() {
  const s = load('eng_streak', { date: '', count: 0 });
  const t = todayStr();
  let count;
  if (s.date === t) count = s.count;
  else if (s.date === fmtDate(addDays(t, -1))) count = s.count + 1;
  else count = 1;
  if (s.date !== t) { save('eng_streak', { date: t, count }); }
  return count;
}
function normWords(s) { return (s || '').toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean); }
function evalSpeak(target, transcript) {
  const tgt = normWords(target), got = normWords(transcript);
  const gotSet = new Set(got);
  const missed = tgt.filter((w) => !gotSet.has(w));
  const score = tgt.length ? Math.round((tgt.length - missed.length) / tgt.length * 100) : 0;
  return { score, missed, transcript };
}
function initEnglish() { renderEnglish(); }
function renderEnglish() {
  if (!load('eng_theme', '')) save('eng_theme', engThemeOfDay());
  engTheme = load('eng_theme', engThemeOfDay());
  const d = engLoad();
  const streak = engStreakInfo();
  $('#engStreak').textContent = `🔥 连续学习 ${streak} 天 ｜ 今日 ${d.minutes} 分钟`;
  const theme = ENG_THEMES[engTheme];
  const sHtml = theme.sentences.map((s, i) => {
    const id = 's' + i; const done = d.sentences[id];
    return `<div class="eng-sent ${done ? 'learned' : ''}">
      <div class="es-top"><span class="es-en">${escapeHtml(s[0])}</span>
        <button class="mini-btn" data-spk="${encodeURIComponent(s[0])}">🔊</button>
        <button class="mini-btn" data-rec="${i}">🎙 跟读</button>
        <button class="mini-btn" data-sdone="${i}">${done ? '✅已学' : '标记已学'}</button></div>
      <div class="es-zh">${escapeHtml(s[1])}</div>
    </div>`;
  }).join('');
  const wHtml = theme.words.map((w, i) => {
    const id = 'w' + i; const done = d.words[id];
    return `<div class="word-card ${done ? 'learned' : ''}">
      <button class="spk" data-spk="${encodeURIComponent(w[0])}">🔊</button>
      <div class="w-word">${escapeHtml(w[0])}</div>
      <div class="w-mean">${escapeHtml(w[1])} <span class="muted">${escapeHtml(w[2] || '')}</span></div>
      <div class="w-learn" data-wdone="${i}">${done ? '✅ 已学' : '○ 标记已学'}</div>
    </div>`;
  }).join('');
  $('#engBody').innerHTML = `
    ${dailyEngHtml()}
    <div class="card"><div class="ic-top"><b>🗣 今日口语训练（10 句）</b><span class="muted">主题：${engTheme}</span></div>${sHtml}</div>
    <div class="card"><div class="ic-top"><b>📘 今日词汇训练（20 个）</b><span class="muted">点击 🔊 朗读</span></div><div class="word-grid">${wHtml}</div></div>`;
  const bump = (mins) => { const x = engLoad(); x.minutes += mins; engSave(x); renderEnglish(); };
  $('#engBody').querySelectorAll('[data-spk]').forEach((b) => b.addEventListener('click', () => speakEn(decodeURIComponent(b.dataset.spk))));
  $('#engBody').querySelectorAll('[data-sdone]').forEach((b) => b.addEventListener('click', () => { const x = engLoad(); const id = 's' + b.dataset.sdone; x.sentences[id] = !x.sentences[id]; engSave(x); if (x.sentences[id]) bump(1); else renderEnglish(); }));
  $('#engBody').querySelectorAll('[data-wdone]').forEach((b) => b.addEventListener('click', () => { const x = engLoad(); const id = 'w' + b.dataset.wdone; x.words[id] = !x.words[id]; engSave(x); if (x.words[id]) bump(1); else renderEnglish(); }));
  $('#engBody').querySelectorAll('[data-rec]').forEach((b) => b.addEventListener('click', () => startRec(b, Number(b.dataset.rec))));
  const engAiBtn = $('#engAi'); if (engAiBtn) engAiBtn.addEventListener('click', genAiEng);
  $('#engThemeBtn').addEventListener('click', () => {
    const keys = Object.keys(ENG_THEMES);
    openModal(`<div class="modal-h">🎯 选择学习主题</div><div class="cat-list">${keys.map((k) => `<span class="cat-chip" data-kt="${k}">${k}</span>`).join('')}</div><div class="modal-actions"><button class="btn-ghost" id="kt_c">取消</button></div>`);
    document.querySelectorAll('[data-kt]').forEach((c) => c.addEventListener('click', () => { save('eng_theme', c.dataset.kt); closeModal(); renderEnglish(); }));
    $('#kt_c').addEventListener('click', closeModal);
  });
  $('#engAllRead').addEventListener('click', () => { const lines = ENG_THEMES[engTheme].sentences.map((s) => s[0]); let i = 0; const next = () => { if (i >= lines.length) return; speakEn(lines[i++]); setTimeout(next, 2600); }; next(); });
}
function startRec(btn, idx) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { alert('当前浏览器不支持语音识别（跟读评定）。\n可在 Chrome / Edge 桌面端体验，或点击「标记已学」记录学习。'); return; }
  const rec = new SR(); rec.lang = 'en-US'; rec.interimResults = false; rec.continuous = false;
  btn.textContent = '🎙 听音中…';
  rec.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    const target = ENG_THEMES[engTheme].sentences[idx][0];
    const r = evalSpeak(target, transcript);
    const missedHtml = r.missed.length ? '未读准：<b style="color:var(--red)">' + r.missed.join(', ') + '</b>' : '全部读准啦，很棒！';
    openModal(`<div class="modal-h">🎯 跟读评定</div>
      <div class="modal-text">原句：<b>${escapeHtml(target)}</b><br>你读：<b>${escapeHtml(transcript)}</b><br><br>
      得分：<b style="font-size:22px;color:${r.score >= 80 ? 'var(--green)' : 'var(--amber)'}">${r.score} 分</b><br>${missedHtml}
      <br><br><span class="muted">小贴士：注意重读与连读，多跟读几遍会更自然。</span></div>
      <div class="modal-actions"><button class="btn-primary" id="rc_ok">知道了</button></div>`);
    $('#rc_ok').addEventListener('click', closeModal);
    const x = engLoad(); x.minutes += 2; engSave(x); renderEnglish();
  };
  rec.onerror = () => { alert('识别失败，请允许麦克风权限后重试。'); btn.textContent = '🎙 跟读'; };
  rec.onend = () => { btn.textContent = '🎙 跟读'; };
  try { rec.start(); } catch (e) { btn.textContent = '🎙 跟读'; }
}

/* ===================== 8. 今日心情 ===================== */
const MOOD_BIRTH = new Date(1999, 11, 23, 19, 0);
function zodiac(d) {
  const m = d.getMonth() + 1, day = d.getDate();
  if ((m === 12 && day >= 22) || (m === 1 && day <= 19)) return '摩羯座';
  if ((m === 1 && day >= 20) || (m === 2 && day <= 18)) return '水瓶座';
  if ((m === 2 && day >= 19) || (m === 3 && day <= 20)) return '双鱼座';
  if ((m === 3 && day >= 21) || (m === 4 && day <= 19)) return '白羊座';
  if ((m === 4 && day >= 20) || (m === 5 && day <= 20)) return '金牛座';
  if ((m === 5 && day >= 21) || (m === 6 && day <= 21)) return '双子座';
  if ((m === 6 && day >= 22) || (m === 7 && day <= 22)) return '巨蟹座';
  if ((m === 7 && day >= 23) || (m === 8 && day <= 22)) return '狮子座';
  if ((m === 8 && day >= 23) || (m === 9 && day <= 22)) return '处女座';
  if ((m === 9 && day >= 23) || (m === 10 && day <= 23)) return '天秤座';
  if ((m === 10 && day >= 24) || (m === 11 && day <= 22)) return '天蝎座';
  return '射手座';
}
const HORO_POOL = {
  '摩羯座': ['今天适合把拖延的事列个清单，一件件吃掉它。', '稳扎稳打的一天，别被别人的节奏带跑。', '工作上有小突破，记得肯定自己的努力。'],
  '水瓶座': ['脑子今天特别灵，适合想新点子。', '和朋友聊聊天，会有意外收获。', '保持你的独特，不必迎合所有人。'],
  '双鱼座': ['感性的一天，写写画画都不错。', '对在意的人温柔一点，也会更被爱。', '别把情绪都憋着，说出来会轻松。'],
  '白羊座': ['行动力爆棚，想做就去做。', '今天适合开启一件新事。', '冲动前先数三秒，会更稳。'],
  '金牛座': ['踏踏实实的一天，享受当下就好。', '犒劳自己一顿好吃的吧。', '财务上做点小规划，心里更稳。'],
  '双子座': ['好奇心强，适合学点新东西。', '多和朋友交流，能量会回来。', '别同时开太多头，专注一两件。'],
  '巨蟹座': ['家人和家让你安心，多陪陪他们。', '情绪细腻是天赋，也记得照顾自己。', '做点喜欢的小事，治愈一下。'],
  '狮子座': ['今天你很有感染力，大胆表达。', '被人认可的感觉不错，继续发光。', '适当示弱也没关系，真实更动人。'],
  '处女座': ['细节控上线，把事情理清楚很舒服。', '给自己留点弹性，别太苛求。', '完成比完美更重要。'],
  '天秤座': ['纠结时相信第一直觉。', '约上朋友聊聊天，平衡一下心情。', '美美地打扮，心情会更好。'],
  '天蝎座': ['专注力强，适合攻坚一件事。', '看人看事更通透，别轻易下结论。', '把心思说给信任的人听。'],
  '射手座': ['想出去走走，今天适合放松。', '乐观会传染，带带动身边人。', '定个小目标，玩着也能达成。'],
};
function horoscopeFor(sign, d) {
  const pool = HORO_POOL[sign] || ['今天也是值得期待的一天。'];
  const dayIdx = Math.floor(d.getTime() / 86400000);
  const lucky = LUCKY_COLORS[dayIdx % LUCKY_COLORS.length];
  const yi = YI_POOL[dayIdx % YI_POOL.length];
  const bu = BU_POOL[dayIdx % BU_POOL.length];
  const wk = isoWeek(d);
  const week = HORO_WEEK[wk % HORO_WEEK.length];
  return { today: pool[dayIdx % pool.length], lucky, yi, bu, week };
}
function isoWeek(d) {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = dt.getUTCDay() || 7; dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yr = dt.getUTCFullYear(); const jan1 = new Date(Date.UTC(yr, 0, 1));
  return Math.ceil((((dt - jan1) / 86400000) + 1) / 7);
}
const LUCKY_COLORS = [
  { name: '天蓝', hex: '#7EC8E3' }, { name: '草绿', hex: '#88C057' }, { name: '暖橙', hex: '#F4A261' },
  { name: '樱粉', hex: '#F7A8C4' }, { name: '薄荷绿', hex: '#9FE2BF' }, { name: '鹅黄', hex: '#FBE28A' },
  { name: '薰衣紫', hex: '#B9A6E3' }, { name: '珊瑚红', hex: '#FF7F6E' }, { name: '银灰', hex: '#C7CDD4' }, { name: '奶白', hex: '#F3EEE3' },
];
const YI_POOL = ['表白心意', '开启一项新计划', '整理房间', '约朋友小聚', '学个新技能', '运动出一身汗', '早点休息养护', '做件利他的事', '写日记复盘', '温柔地拒绝'];
const BU_POOL = ['冲动消费', '熬夜刷手机', '钻牛角尖', '勉强自己社交', '拖延要事', '和亲近的人置气', '过度自责', '空腹灌咖啡', '暴饮暴食', '反复纠结过去'];
const HORO_WEEK = [
  '本周贵人运上升，遇到难题多请教前辈。', '本周适合稳扎稳打，别轻易换赛道。', '本周人际回暖，多出门走走会有惊喜。',
  '本周财运小有进账，注意节制不必要的开销。', '本周精力充沛，适合攻坚一直拖着的大任务。', '本周情绪起伏偏大，记得给自己留白和喘息。',
  '本周学习运很旺，考证 / 读书效率会比平时高。', '本周宜慢生活，把节奏放下来反而更顺。',
];
const MOODS = [['😀', '开心'], ['😌', '平静'], ['🥰', '喜欢'], ['😟', '焦虑'], ['😢', '难过'], ['😡', '生气'], ['😴', '疲惫'], ['🤔', '思考']];
const COMFORT = {
  '😟': ['焦虑的时候，深呼吸三次，事情没你想的那么糟。', '把它写下来，焦虑会变小很多。'],
  '😢': ['哭出来也没关系，情绪需要出口。', '今天已经很不容易了，抱抱你。'],
  '😡': ['先离开现场几分钟，愤怒时的决定容易后悔。', '把火气说出来，而不是憋着。'],
  '😴': ['累了就休息，效率比硬撑重要。', '今晚早点睡，明天会轻松些。'],
  '🤔': ['想不通就先放一放，灵感常在放松时来。', '你已经在认真思考了，这本身很棒。'],
  '😀': ['保持这份好状态，把它传递给身边的人吧。', '开心的时候记得记录下来～'],
  '😌': ['平静也是一种力量，享受此刻。', '慢慢来，一切都刚刚好。'],
  '🥰': ['被喜欢的事包围真幸福，记在心里。', '把这份喜欢也分享出去吧。'],
};
function initMood() { renderMood(); }
function renderMood() {
  const sign = zodiac(MOOD_BIRTH);
  $('#moodSign').textContent = sign + ' · 生日 1999-12-23';
  const horo = horoscopeFor(sign, new Date());
  const day = todayStr();
  const rec = load('mood_' + day, {});
  const sel = rec.mood || '';
  $('#moodBody').innerHTML = `
    <div class="card"><h3>🌟 今日星座运势（${sign}）</h3>
      <div class="horo">${escapeHtml(horo.today)}</div>
      <div class="horo-grid">
        <div class="horo-cell"><div class="muted">幸运色</div><div class="lucky"><span class="lucky-dot" style="background:${horo.lucky.hex}"></span>${escapeHtml(horo.lucky.name)}</div></div>
        <div class="horo-cell"><div class="muted">宜</div><div class="yi-bu yi">${escapeHtml(horo.yi)}</div></div>
        <div class="horo-cell"><div class="muted">不宜</div><div class="yi-bu bu">${escapeHtml(horo.bu)}</div></div>
      </div>
      <div class="horo-week"><b>📅 本周运势</b><div>${escapeHtml(horo.week)}</div></div>
    </div>
    <div class="card"><h3>💗 今天心情怎么样？</h3>
      <div class="mood-grid">${MOODS.map((m) => `<button class="mood-btn ${sel === m[1] ? 'on' : ''}" data-mood="${m[1]}" data-emoji="${m[0]}">${m[0]}<span>${m[1]}</span></button>`).join('')}</div>
      <label class="fld">记录点事情（选填）</label>
      <textarea id="moodNote" class="modal-textarea" placeholder="今天发生了什么？">${escapeHtml(rec.note || '')}</textarea>
      <div class="row" style="margin-top:10px"><button class="btn-primary" id="moodSave">保存心情</button></div>
      <div id="moodComfort"></div>
    </div>`;
  if (rec.comfort) $('#moodComfort').innerHTML = `<div class="comfort">💌 ${escapeHtml(rec.comfort)}</div>`;
  $('#moodBody').querySelectorAll('.mood-btn').forEach((b) => b.addEventListener('click', () => {
    $('#moodBody').querySelectorAll('.mood-btn').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    const emoji = b.dataset.emoji, mood = b.dataset.mood;
    const pool = COMFORT[emoji] || ['今天也辛苦了，记得对自己好一点。'];
    const comfort = pool[Math.floor(Math.random() * pool.length)];
    $('#moodComfort').innerHTML = `<div class="comfort">💌 ${escapeHtml(comfort)}</div>`;
    const r = load('mood_' + day, {}); r.mood = mood; r.emoji = emoji; r.comfort = comfort; r.note = $('#moodNote').value; r.ts = Date.now(); save('mood_' + day, r);
  }));
  $('#moodSave').addEventListener('click', () => {
    const r = load('mood_' + day, {}); const mood = $('#moodBody').querySelector('.mood-btn.on');
    if (!mood && !$('#moodNote').value.trim()) return flash($('#moodSave'), '选心情或写点啥');
    if (mood) { r.mood = mood.dataset.mood; r.emoji = mood.dataset.emoji; const pool = COMFORT[mood.dataset.emoji] || ['今天也辛苦了。']; if (!r.comfort) r.comfort = pool[Math.floor(Math.random() * pool.length)]; }
    r.note = $('#moodNote').value; r.ts = Date.now(); save('mood_' + day, r);
    if (activeSection === 'home') renderHome();
    flash($('#moodSave'), '已保存');
  });
}


/* ===================== 启动 ===================== */
document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initPlan();
  initReview();
  initLearn();
  initInspiration();
  initTailor();
  initLedger();
  initSports();
  initEnglish();
  initMood();
  initHome();
  initAIChat();
  $('#topDate').textContent = todayStr();
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  // 跨标签页实时同步：同一浏览器多开标签时，一处数据变化，其他标签自动刷新当前板块
  window.addEventListener('storage', (e) => {
    if (e.key && e.key.indexOf('mickey_') === 0) {
      switch (activeSection) {
        case 'home': renderHome(); break;
        case 'plan': renderPlan(); break;
        case 'review': renderReview(); break;
        case 'learn': renderLearn(); break;
        case 'sports': renderSports(); break;
        case 'english': renderEnglish(); break;
        case 'mood': renderMood(); break;
        case 'inspiration': renderInspiration(); break;
        case 'tailor': renderTailor(); break;
        case 'ledger': renderLedger(); break;
      }
    }
  });
});
