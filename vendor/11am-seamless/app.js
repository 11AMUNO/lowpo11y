/* 11AM-Seamless :: app v2 — library of collections, pipeline controls, viewport, export */
(function () {
  'use strict';
  const E = window.SeamlessEngine;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const LOOSE = 'UNSORTED';

  // ---- state -------------------------------------------------------------------
  const state = {
    items: [],              // {id, file, base, name, col, thumb, settings, w, h}
    cols: new Map(),        // name -> {collapsed}
    active: null,
    res: null,              // {id, r, ms} result for the active file only (keeps memory flat)
    view: 'split', grid: 3, tsrc: 'result', seams: false, pixelated: false,
    divider: 0.5, pan: { x: 0, y: 0 }, zoom: 1,
    format: 'png', quality: 92,
    scope: 'all',
    sizes: new Set([1024, 512, 256, 128]),
  };
  let nextId = 1;
  const active = () => state.items.find(i => i.id === state.active) || null;

  // ---- utils ------------------------------------------------------------------
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const safeName = s => (s || '').trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '') || 'texture';
  const extOf = f => f === 'jpg' ? '.jpg' : f === 'webp' ? '.webp' : '.png';
  const mimeOf = f => f === 'jpg' ? 'image/jpeg' : f === 'webp' ? 'image/webp' : 'image/png';
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const tick = () => new Promise(r => setTimeout(r, 0));
  const bar = (v, min, max, cells = 12) => {
    const f = Math.round((v - min) / (max - min) * cells);
    return '<b>' + '█'.repeat(f) + '</b>' + '░'.repeat(cells - f);
  };
  let toastT;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = '> ' + msg;
    t.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('on'), 2400);
  }
  const store = {
    get(k, d) { try { const v = localStorage.getItem('11am.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('11am.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  const isCustom = it => Object.keys(E.DEFAULTS).some(k => it.settings[k] !== E.DEFAULTS[k]);
  const colNames = () => [...state.cols.keys()].sort((a, b) => a === LOOSE ? 1 : b === LOOSE ? -1 : collator.compare(a, b));
  const itemsIn = col => state.items.filter(i => i.col === col).sort((a, b) => collator.compare(a.base, b.base));
  const ordered = () => colNames().flatMap(itemsIn);

  // ---- sliders ----------------------------------------------------------------------
  const SLIDERS = [
    { key: 'flatten', box: 'source', name: 'FLATTEN LIGHT', min: 0, max: 100, unit: '%', tip: 'Removes big lighting gradients that make repeats obvious' },
    { key: 'width', box: 'tile', name: 'BLEND WIDTH', min: 2, max: 50, unit: '%', modes: ['blend', 'edge'], tip: 'How far in from each edge the heal reaches' },
    { key: 'strength', box: 'tile', name: 'BLEND STRENGTH', min: 0, max: 100, unit: '%', modes: ['blend', 'edge'], tip: 'Opacity of the heal. Below 100% the seam is only softened' },
    { key: 'jitter', box: 'tile', name: 'ORGANIC SEAM', min: 0, max: 100, unit: '%', modes: ['blend', 'edge'], tip: 'Breaks the straight blend band up with noise' },
    { key: 'offsetX', box: 'tile-adv', name: 'SEAM POSITION X', min: 10, max: 90, unit: '%', modes: ['blend', 'offset'], tip: 'Where the hidden seam sits horizontally' },
    { key: 'offsetY', box: 'tile-adv', name: 'SEAM POSITION Y', min: 10, max: 90, unit: '%', modes: ['blend', 'offset'], tip: 'Where the hidden seam sits vertically' },
    { key: 'keyTol', box: 'key', name: 'THRESHOLD', min: 0, max: 64, unit: '', tip: 'Brightest value (0-255) that still counts as background black' },
    { key: 'keySoft', box: 'key', name: 'SOFT EDGE', min: 0, max: 64, unit: '', tip: 'Fades pixels just above the threshold for anti-aliased edges. Off while PSX is on (hard 1-bit alpha)' },
    { key: 'psxColors', box: 'psx', name: 'COLOURS', min: 2, max: 256, unit: '', tip: 'Palette size. PS1 4-bit CLUT = 16, 8-bit CLUT = 256' },
    { key: 'psxDitherAmt', box: 'psx2', name: 'DITHER STRENGTH', min: 0, max: 100, unit: '%', tip: 'How strongly the dither breaks up banding' },
  ];
  function sliderEl(cfg, value, onInput) {
    const wrap = document.createElement('div');
    wrap.className = 'slider';
    wrap.title = cfg.tip || '';
    const id = 'sl-' + cfg.key;
    wrap.innerHTML =
      `<div class="slider-head"><label class="name" for="${id}">${cfg.name}</label>` +
      `<span class="bar" aria-hidden="true"></span><span class="val"></span></div>` +
      `<input id="${id}" type="range" min="${cfg.min}" max="${cfg.max}" step="1" value="${value}">`;
    const input = wrap.querySelector('input');
    const paint = () => {
      const v = +input.value;
      wrap.querySelector('.bar').innerHTML = bar(v, cfg.min, cfg.max);
      wrap.querySelector('.val').textContent = v + cfg.unit;
    };
    input.addEventListener('input', () => { paint(); onInput(+input.value); });
    wrap.set = v => { input.value = v; paint(); };
    paint();
    return wrap;
  }
  const sliderEls = {};
  for (const cfg of SLIDERS) {
    const el = sliderEl(cfg, E.DEFAULTS[cfg.key], v => setParam(cfg.key, v));
    sliderEls[cfg.key] = el;
    $(`.sliders[data-box="${cfg.box}"]`).appendChild(el);
  }
  const qualityEl = sliderEl({ key: 'quality', name: 'QUALITY', min: 40, max: 100, unit: '%' }, state.quality, v => { state.quality = v; });
  $('#sliders-export').appendChild(qualityEl);

  // ---- settings controls ------------------------------------------------------------
  const SEGS = [
    ['#seg-size', 'size', 'size', Number],
    ['#seg-resample', 'resample', 'resample', String],
    ['#seg-mode', 'mode', 'mode', String],
    ['#seg-dir', 'direction', 'dir', String],
    ['#seg-falloff', 'falloff', 'falloff', String],
    ['#seg-dither', 'psxDither', 'dither', String],
  ];
  for (const [sel, key, attr, cast] of SEGS) {
    $$(`${sel} .tbtn`).forEach(b => b.addEventListener('click', () => setParam(key, cast(b.dataset[attr]))));
  }
  $$('[data-bool]').forEach(b => b.addEventListener('click', () => {
    const it = active(); if (it) setParam(b.dataset.bool, !it.settings[b.dataset.bool]);
  }));
  $$('[data-sw]').forEach(b => b.addEventListener('click', () => {
    const it = active(); if (!it) return;
    const k = b.dataset.sw;
    setParam(k, !it.settings[k]);
    const mod = b.closest('.mod');
    if (it.settings[k] && mod.classList.contains('collapsed')) toggleMod(mod, false);
  }));
  $('#btn-reseed').addEventListener('click', () => setParam('seed', (Math.random() * 1e6) | 0));

  // collapsible modules, remembered per browser
  const modState = store.get('mods', {});
  function toggleMod(mod, collapse) {
    const c = collapse === undefined ? !mod.classList.contains('collapsed') : collapse;
    mod.classList.toggle('collapsed', c);
    mod.querySelector('.mod-toggle').setAttribute('aria-expanded', !c);
    mod.querySelector('.chev').textContent = c ? '▸' : '▾';
    modState[mod.dataset.mod] = c; store.set('mods', modState);
  }
  $$('.mod').forEach(mod => {
    if (modState[mod.dataset.mod]) toggleMod(mod, true);
    mod.querySelector('.mod-toggle').addEventListener('click', () => toggleMod(mod));
  });

  function setParam(key, value) {
    const it = active();
    if (!it) return;
    it.settings[key] = value;
    syncControls();
    refreshRow(it);
    scheduleActive();
  }

  const MODE_DESC = {
    blend: 'Offset + heal. Natural, feathered seams. Best for wood, rust, stone, photos.',
    mirror: 'Kaleidoscope. Always seamless. Output is 2× unless MIRROR FIT is on.',
    edge: 'Heals only the borders. The center stays untouched.',
    offset: 'Wrap-shift only, to inspect or hand-paint the seam elsewhere.',
  };
  const DITHER_LBL = { none: 'NO DITHER', bayer4: 'DITHER 4×4', bayer8: 'DITHER 8×8', fs: 'DITHER F-S' };
  const press = (sel, attr, val) => $$(`${sel} .tbtn`).forEach(b => b.setAttribute('aria-pressed', String(b.dataset[attr]) === String(val)));

  function summaries(s) {
    const src = [s.size ? s.size + ' PX' : 'ORIGINAL SIZE'];
    if (s.resample === 'nearest') src.push('NEAREST');
    if (s.square) src.push('SQUARE');
    if (s.flatten) src.push('FLAT ' + s.flatten + '%');
    let tile = 'OFF';
    if (s.tile) {
      tile = s.mode === 'mirror' ? (s.mirrorFit ? 'MIRROR 1×' : 'MIRROR 2×')
        : s.mode === 'offset' ? 'OFFSET ONLY'
        : `${s.mode.toUpperCase()} ${s.width}% · ${s.strength}%`;
      if (s.direction !== 'both') tile += ' · ' + s.direction.toUpperCase() + ' ONLY';
    }
    const key = s.keyBlack ? `BLACK ≤ ${s.keyTol} · ${s.keyConnected ? 'EDGE' : 'ALL'}` : 'OFF';
    let psx = 'OFF';
    if (s.psx) {
      const p = [];
      if (s.psxLimit) p.push(s.psxColors + ' COL');
      if (s.psx15) p.push('15-BIT');
      psx = p.length ? p.join(' · ') + (s.psxDither !== 'none' ? ' · ' + DITHER_LBL[s.psxDither].replace('DITHER ', '') : '') : 'NOTHING PICKED';
    }
    return { source: src.join(' · '), tile, key, psx };
  }

  function syncControls() {
    const it = active();
    const s = it ? it.settings : E.DEFAULTS;
    press('#seg-size', 'size', s.size);
    press('#seg-resample', 'resample', s.resample);
    press('#seg-mode', 'mode', s.mode);
    press('#seg-dir', 'dir', s.direction);
    press('#seg-falloff', 'falloff', s.falloff);
    press('#seg-dither', 'dither', s.psxDither);
    $$('[data-bool]').forEach(b => b.setAttribute('aria-pressed', !!s[b.dataset.bool]));
    $$('[data-sw]').forEach(b => { const on = !!s[b.dataset.sw]; b.setAttribute('aria-pressed', on); b.textContent = on ? 'ON' : 'OFF'; });
    $('#mode-desc').textContent = MODE_DESC[s.mode];
    for (const cfg of SLIDERS) {
      sliderEls[cfg.key].set(s[cfg.key]);
      sliderEls[cfg.key].hidden = !!cfg.modes && !cfg.modes.includes(s.mode);
    }
    if (s.direction === 'y') sliderEls.offsetX.hidden = true;
    if (s.direction === 'x') sliderEls.offsetY.hidden = true;
    const healing = s.mode === 'blend' || s.mode === 'edge';
    $('#f-falloff').hidden = !healing;
    $('[data-bool="pixelSafe"]').hidden = !healing;
    $('[data-bool="mirrorFit"]').hidden = s.mode !== 'mirror';
    $('#btn-reseed').hidden = !healing || !s.jitter;
    $('#adv-tile').hidden = s.mode === 'mirror' && false;
    sliderEls.psxColors.hidden = !s.psxLimit;
    sliderEls.psxDitherAmt.hidden = s.psxDither === 'none';
    sliderEls.keySoft.hidden = E.psxActive(s);
    $('#key-warn').hidden = !(s.keyBlack && state.format === 'jpg');

    const sum = summaries(s);
    $('#sum-source').textContent = sum.source;
    $('#sum-tile').textContent = s.tile ? sum.tile : '';
    $('#sum-key').textContent = s.keyBlack ? sum.key : '';
    $('#sum-psx').textContent = s.psx ? sum.psx : '';
    $('.mod[data-mod="tile"]').classList.toggle('off', !s.tile);
    $('.mod[data-mod="key"]').classList.toggle('off', !s.keyBlack);
    $('.mod[data-mod="psx"]').classList.toggle('off', !s.psx);
    $('.rack').classList.toggle('disabled', !it);

    $('#in-name').value = it ? it.name : '';
    $('#in-name').disabled = !it;
    $('#ext').textContent = extOf(state.format);
    qualityEl.hidden = state.format === 'png';
    ['#btn-dl', '#btn-sample', '#btn-reset', '#btn-apply-col', '#btn-apply-all'].forEach(id => $(id).disabled = !it);
    ['#btn-zip', '#btn-pattern'].forEach(id => $(id).disabled = !state.items.length);
    $('[data-scope="collection"]').disabled = !it;
    renderEditing();
    renderTree();
  }

  // ---- editing card --------------------------------------------------------------------
  function renderEditing() {
    const it = active();
    const box = $('#ed-target');
    if (!it) { box.innerHTML = '<span class="ed-none">&gt; select a file in the library</span>'; }
    else {
      const dims = it.w ? `${it.w}×${it.h}` : '…';
      box.innerHTML = `<img src="${it.thumb}" alt=""><span><span class="ed-name">${esc(it.base)}</span>` +
        `<span class="ed-sub">${dims} // ${esc(it.col)}${isCustom(it) ? ' // CUSTOMISED' : ''}</span></span>`;
    }
    const nCol = it ? itemsIn(it.col).length : 0;
    $('#btn-apply-col').textContent = `COLLECTION${it ? ' (' + nCol + ')' : ''}`;
    $('#btn-apply-all').textContent = `EVERYTHING${state.items.length ? ' (' + state.items.length + ')' : ''}`;
    $('#view-for').textContent = it ? '// ' + it.base.toUpperCase() : '';
  }

  function applyTo(targets, label) {
    const it = active(); if (!it) return;
    const others = targets.filter(o => o !== it);
    if (!others.length) { toast('NOTHING ELSE TO APPLY TO'); return; }
    const custom = others.filter(isCustom).length;
    if (custom && !confirm(`Overwrite the settings of ${custom} customised file(s) in ${label}?`)) return;
    for (const o of others) o.settings = Object.assign({}, it.settings);
    renderLib();
    toast(`SETTINGS → ${others.length} FILE(S) IN ${label.toUpperCase()}`);
  }
  $('#btn-apply-col').addEventListener('click', () => { const it = active(); if (it) applyTo(itemsIn(it.col), it.col); });
  $('#btn-apply-all').addEventListener('click', () => applyTo(state.items, 'the whole library'));
  $('#btn-reset').addEventListener('click', () => {
    const it = active(); if (!it) return;
    it.settings = Object.assign({}, E.DEFAULTS);
    syncControls(); refreshRow(it); scheduleActive(0); toast('SETTINGS RESET');
  });

  // ---- loading ----------------------------------------------------------------------
  const IMG_RE = /\.(png|jpe?g|webp|bmp|gif|avif|tiff?)$/i;
  const isImage = f => (f.type && f.type.startsWith('image/')) || IMG_RE.test(f.name);

  async function decode(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file); } catch (e) { /* fall through */ }
    }
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('decode failed')); };
      img.src = url;
    });
  }
  // small LRU of decoded images so big libraries don't eat all memory
  const imgCache = new Map();
  async function getImg(it) {
    if (imgCache.has(it.id)) { const b = imgCache.get(it.id); imgCache.delete(it.id); imgCache.set(it.id, b); return b; }
    const b = await decode(it.file);
    it.w = b.width; it.h = b.height;
    imgCache.set(it.id, b);
    for (const [k, v] of imgCache) {
      if (imgCache.size <= 6) break;
      if (k === state.active || k === it.id) continue;
      imgCache.delete(k); if (v.close) v.close();
    }
    return b;
  }
  function dropImg(id) { const b = imgCache.get(id); if (b && b.close) b.close(); imgCache.delete(id); }

  // entries: [{file, col}]
  function ingest(entries, readFailed) {
    entries = entries.filter(e => !e.file.name.startsWith('.')); // .DS_Store and friends
    const files = entries.filter(e => isImage(e.file));
    if (!files.length) {
      if (readFailed) { toast('THIS BROWSER BLOCKED READING THE DROPPED FOLDER // USE + FOLDER INSTEAD'); return; }
      const exts = [...new Set(entries.map(e => (e.file.name.match(/\.[^.]+$/) || ['(no extension)'])[0].toLowerCase()))].slice(0, 5);
      toast(entries.length ? `NO SUPPORTED IMAGES IN ${entries.length} FILE(S) // FOUND ${exts.join(' ').toUpperCase()}` : 'NO FILES FOUND IN THAT FOLDER');
      return;
    }
    if (readFailed) toast('SOME FOLDERS COULD NOT BE READ // TRY + FOLDER FOR THOSE');
    let first = null;
    const touched = new Set();
    for (const { file, col } of files) {
      const c = col || LOOSE;
      if (!state.cols.has(c)) state.cols.set(c, { collapsed: false });
      touched.add(c);
      const base = file.name.replace(/\.[^.]+$/, '');
      const it = {
        id: nextId++, file, base, name: base, col: c,
        thumb: URL.createObjectURL(file),
        settings: Object.assign({}, E.DEFAULTS), w: 0, h: 0,
      };
      state.items.push(it);
      if (!first) first = it;
    }
    renderLib();
    if (!active()) select(itemsIn(colNames().find(c => touched.has(c)))[0].id);
    toast(`${files.length} FILE(S) // ${touched.size} COLLECTION(S)`);
  }

  // folder name a file belongs to: its parent directory
  const parentOf = path => { const p = path.split('/').filter(Boolean); return p.length > 1 ? p[p.length - 2] : null; };

  $('#btn-add-files').addEventListener('click', e => { e.stopPropagation(); $('#in-files').click(); });
  $('#btn-add-folder').addEventListener('click', e => { e.stopPropagation(); $('#in-folder').click(); });
  $('#drop').addEventListener('click', e => { if (e.target === e.currentTarget || e.target.closest('.drop-big,.drop-small')) $('#in-folder').click(); });
  $('#drop').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#in-folder').click(); } });
  $('#in-files').addEventListener('change', e => { ingest([...e.target.files].map(file => ({ file, col: LOOSE }))); e.target.value = ''; });
  $('#in-folder').addEventListener('change', e => {
    ingest([...e.target.files].map(file => ({ file, col: parentOf(file.webkitRelativePath || '') || LOOSE })));
    e.target.value = '';
  });

  // drag & drop, including whole folders (walks sub-folders).
  // Chrome blocks the old FileSystem entry API on file:// pages, so the File System Access
  // handle API is tried first and the entry API is only the fallback (Safari / Firefox).
  async function walkHandle(h, parent, out) {
    if (h.kind === 'file') { out.push({ file: await h.getFile(), col: parent || LOOSE }); return; }
    for await (const child of h.values()) await walkHandle(child, h.name, out);
  }
  function readEntry(entry, out, status) {
    return new Promise(resolve => {
      if (entry.isFile) {
        entry.file(file => { out.push({ file, col: parentOf(entry.fullPath) || LOOSE }); resolve(); }, () => { status.failed = true; resolve(); });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const batch = () => reader.readEntries(async list => {
          if (!list.length) { resolve(); return; }
          for (const child of list) await readEntry(child, out, status);
          batch();
        }, () => { status.failed = true; resolve(); });
        batch();
      } else resolve();
    });
  }
  const drop = $('#drop');
  let dragDepth = 0;
  window.addEventListener('dragenter', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; drop.classList.add('over'); } });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) drop.classList.remove('over'); });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', async e => {
    e.preventDefault(); dragDepth = 0; drop.classList.remove('over');
    const dt = e.dataTransfer; if (!dt) return;
    // everything on the DataTransfer must be grabbed synchronously, before the first await
    const items = [...(dt.items || [])].filter(i => i.kind === 'file');
    const handles = items.map(i => i.getAsFileSystemHandle ? i.getAsFileSystemHandle() : null);
    const entries = items.map(i => i.webkitGetAsEntry ? i.webkitGetAsEntry() : null);
    const loose = [...dt.files];
    if (!items.length && !loose.length) return;
    toast('READING FOLDERS…');
    const out = [], status = { failed: false };
    for (let k = 0; k < Math.max(items.length, loose.length); k++) {
      if (handles[k]) {
        try { const h = await handles[k]; if (h) { await walkHandle(h, null, out); continue; } } catch (err) { /* fall back */ }
      }
      if (entries[k]) await readEntry(entries[k], out, status);
      else if (loose[k]) out.push({ file: loose[k], col: LOOSE });
    }
    ingest(out, status.failed);
  });

  // ---- library ------------------------------------------------------------------------
  function rowSub(it) {
    const s = it.settings, tags = [];
    tags.push(s.tile ? s.mode.toUpperCase() : 'NO TILE');
    if (s.size) tags.push(s.size);
    if (s.keyBlack) tags.push('α');
    if (E.psxActive(s)) tags.push('PSX');
    return (it.w ? `${it.w}×${it.h} // ` : '') + tags.join(' · ');
  }
  function rowHTML(it) {
    const custom = isCustom(it);
    return `<img src="${it.thumb}" alt="" loading="lazy" decoding="async">` +
      `<span class="qmeta"><span class="qname">${esc(it.name)}${extOf(state.format)}</span>` +
      `<span class="qsub">${esc(rowSub(it))}</span></span>` +
      `<span><span class="qmark ${custom ? 'custom' : ''}" title="${custom ? 'Customised settings' : 'Default settings'}">${custom ? '✎' : '·'}</span>` +
      `<button class="qdel" title="Remove" aria-label="Remove ${esc(it.base)}">×</button></span>`;
  }
  function refreshRow(it) {
    const li = $(`.qitem[data-id="${it.id}"]`);
    if (li) li.innerHTML = rowHTML(it);
    updateStats();
  }
  function renderLib() {
    const lib = $('#lib');
    lib.innerHTML = '';
    for (const c of colNames()) {
      const items = itemsIn(c);
      if (!items.length) { state.cols.delete(c); continue; }
      const meta = state.cols.get(c);
      const sec = document.createElement('section');
      sec.className = 'col' + (meta.collapsed ? ' collapsed' : '');
      sec.dataset.col = c;
      const hasActive = items.some(i => i.id === state.active);
      sec.innerHTML =
        `<div class="col-head${hasActive ? ' has-active' : ''}">` +
        `<button class="col-toggle" aria-expanded="${!meta.collapsed}"><span class="chev">${meta.collapsed ? '▸' : '▾'}</span>` +
        `<span class="col-name">${esc(c)}</span></button>` +
        `<span class="col-count">${items.length}</span>` +
        `<button class="col-act" data-act="rename" title="Rename collection (used as the export folder name)">✎</button>` +
        `<button class="col-act" data-act="remove" title="Remove collection">×</button></div>` +
        `<ol class="col-items"></ol>`;
      const ol = sec.querySelector('.col-items');
      for (const it of items) {
        const li = document.createElement('li');
        li.className = 'qitem' + (it.id === state.active ? ' active' : '');
        li.dataset.id = it.id;
        li.innerHTML = rowHTML(it);
        ol.appendChild(li);
      }
      lib.appendChild(sec);
    }
    $('#empty-q').hidden = state.items.length > 0;
    $('#lib-tools').hidden = !state.items.length;
    updateStats();
    syncControls();
  }
  function updateStats() {
    $('#st-cols').textContent = state.cols.size;
    $('#st-files').textContent = state.items.length;
    $('#st-custom').textContent = state.items.filter(isCustom).length;
    const it = active();
    $('#st-active').textContent = it ? it.base.toUpperCase().slice(0, 28) : 'NONE';
  }

  $('#lib').addEventListener('click', e => {
    const head = e.target.closest('.col-head');
    if (head) {
      const c = head.parentElement.dataset.col;
      const act = e.target.closest('.col-act');
      if (!act) { const m = state.cols.get(c); m.collapsed = !m.collapsed; renderLib(); return; }
      if (act.dataset.act === 'rename') {
        const nn = prompt('Collection name (also the export folder name):', c);
        if (!nn || !nn.trim() || nn.trim() === c) return;
        const name = nn.trim();
        const meta = state.cols.get(c); state.cols.delete(c);
        if (!state.cols.has(name)) state.cols.set(name, meta);
        state.items.forEach(i => { if (i.col === c) i.col = name; });
        renderLib();
      } else if (act.dataset.act === 'remove') {
        const n = itemsIn(c).length;
        if (!confirm(`Remove collection "${c}" (${n} file(s)) from the library?`)) return;
        state.items.filter(i => i.col === c).forEach(i => removeItem(i.id, true));
        state.cols.delete(c);
        afterRemove();
      }
      return;
    }
    const li = e.target.closest('.qitem');
    if (!li) return;
    const id = +li.dataset.id;
    if (e.target.closest('.qdel')) { removeItem(id); return; }
    select(id);
  });

  $('#btn-collapse-all').addEventListener('click', () => { state.cols.forEach(m => m.collapsed = true); renderLib(); });
  $('#btn-expand-all').addEventListener('click', () => { state.cols.forEach(m => m.collapsed = false); renderLib(); });
  $('#btn-clear').addEventListener('click', () => {
    if (!state.items.length || !confirm(`Clear all ${state.items.length} file(s) from the library?`)) return;
    [...state.items].forEach(i => removeItem(i.id, true));
    state.cols.clear(); afterRemove();
  });

  function select(id) {
    if (state.active === id) return;
    const prev = state.active;
    state.active = id;
    state.pan = { x: 0, y: 0 };
    state.res = null;
    const it = active();
    if (it && state.cols.get(it.col).collapsed) { state.cols.get(it.col).collapsed = false; renderLib(); }
    else {
      $$('.qitem.active').forEach(el => el.classList.remove('active'));
      $$('.col-head.has-active').forEach(el => el.classList.remove('has-active'));
      const li = $(`.qitem[data-id="${id}"]`);
      if (li) { li.classList.add('active'); li.closest('.col').querySelector('.col-head').classList.add('has-active'); }
      updateStats(); syncControls();
    }
    const li = $(`.qitem[data-id="${id}"]`);
    if (li) li.scrollIntoView({ block: 'nearest' });
    if (prev !== null && prev !== id) { /* keep prev decoded in LRU */ }
    scheduleActive(0);
  }

  function removeItem(id, bulk) {
    const idx = state.items.findIndex(i => i.id === id);
    if (idx < 0) return;
    const list = ordered();
    const pos = list.findIndex(i => i.id === id);
    const [it] = state.items.splice(idx, 1);
    URL.revokeObjectURL(it.thumb);
    dropImg(id);
    if (state.active === id) {
      state.active = null; state.res = null;
      if (!bulk) { const rest = list.filter(i => i.id !== id); const nx = rest[Math.min(pos, rest.length - 1)]; if (nx) state.active = nx.id; }
    }
    if (!bulk) afterRemove();
  }
  function afterRemove() {
    if (state.active === null && state.items.length) state.active = ordered()[0].id;
    renderLib(); draw();
    if (active()) scheduleActive(0);
  }

  // ---- processing (active file only) ---------------------------------------------------
  let procTimer = null, procToken = 0;
  function scheduleActive(delay = 80) {
    clearTimeout(procTimer);
    if (!active()) { draw(); return; }
    setReadout('> PROCESSING…');
    procTimer = setTimeout(runActive, delay);
  }
  async function runActive() {
    const it = active(); if (!it) return;
    const tok = ++procToken;
    let img;
    try { img = await getImg(it); } catch (e) { toast('COULD NOT READ ' + it.file.name.toUpperCase()); return; }
    if (tok !== procToken || it !== active()) return;
    const t0 = performance.now();
    try {
      state.res = { id: it.id, r: E.process(img, it.settings), ms: 0 };
      state.res.ms = Math.round(performance.now() - t0);
    } catch (e) {
      console.error(e); toast('PROCESS FAILED: ' + e.message); return;
    }
    refreshRow(it); renderEditing(); draw();
  }

  // ---- viewport -----------------------------------------------------------------------
  const screen = $('#screen'), cv = $('#cv'), ctx = cv.getContext('2d');
  function setReadout(html) { $('#readout').innerHTML = html; }
  function fitCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(screen.clientWidth * dpr));
    const h = Math.max(1, Math.round(screen.clientHeight * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return dpr;
  }
  const curRes = () => { const it = active(); return it && state.res && state.res.id === it.id ? state.res : null; };

  function draw() {
    const dpr = fitCanvas();
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    const it = active();
    const res = curRes();
    $('#screen-empty').hidden = !!it;
    screen.classList.toggle('tile', state.view === 'tile' && !!it);
    const showSplit = state.view === 'split' && !!res;
    $('#divider').hidden = !showSplit;
    $('#lbl-l').hidden = !showSplit;
    $('#lbl-r').hidden = !showSplit;
    if (!it) { setReadout('> IDLE // DROP A TEXTURE FOLDER TO BEGIN'); return; }
    if (!res) { setReadout('> PROCESSING…'); return; }
    ctx.imageSmoothingEnabled = !state.pixelated;
    ctx.imageSmoothingQuality = 'high';
    const { canvas: out, source: src, metrics: m } = res.r;

    if (state.view === 'split') {
      const padPx = 16 * dpr;
      const k = Math.min((W - padPx * 2) / out.width, (H - padPx * 2) / out.height);
      const dw = out.width * k, dh = out.height * k;
      const x0 = (W - dw) / 2, y0 = (H - dh) / 2;
      const dx = x0 + dw * state.divider;
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, dx, H); ctx.clip();
      ctx.drawImage(src, x0, y0, dw, dh);
      ctx.restore();
      ctx.save(); ctx.beginPath(); ctx.rect(dx, 0, W - dx, H); ctx.clip();
      ctx.drawImage(out, x0, y0, dw, dh);
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(x0) + .5, Math.round(y0) + .5, Math.round(dw) - 1, Math.round(dh) - 1);
      $('#divider').style.left = (dx / dpr) + 'px';
    } else {
      const img = state.tsrc === 'source' ? src : out;
      const n = state.grid;
      const k = Math.min(W / (n * img.width), H / (n * img.height)) * state.zoom;
      const tw = img.width * k, th = img.height * k;
      const ox = (W - tw * n) / 2 + state.pan.x * dpr;
      const oy = (H - th * n) / 2 + state.pan.y * dpr;
      const sx = ox - Math.ceil(ox / tw) * tw, sy = oy - Math.ceil(oy / th) * th;
      for (let y = sy; y < H; y += th) {
        for (let x = sx; x < W; x += tw) {
          const x1 = Math.round(x), y1 = Math.round(y);
          ctx.drawImage(img, x1, y1, Math.round(x + tw) - x1, Math.round(y + th) - y1);
        }
      }
      if (state.seams) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1; ctx.setLineDash([4 * dpr, 4 * dpr]);
        ctx.beginPath();
        for (let x = sx; x < W; x += tw) { const p = Math.round(x) + .5; ctx.moveTo(p, 0); ctx.lineTo(p, H); }
        for (let y = sy; y < H; y += th) { const p = Math.round(y) + .5; ctx.moveTo(0, p); ctx.lineTo(W, p); }
        ctx.stroke(); ctx.restore();
      }
    }
    const s = it.settings;
    const chk = state.view === 'tile' && state.tsrc === 'source' ? ' // VIEWING SOURCE' : '';
    setReadout(
      `> SIZE <b>${m.width}×${m.height}</b> ` +
      (s.tile ? `// SEAM <b>${m.before.toFixed(2)}×</b> → <b>${m.after.toFixed(2)}×</b> <span title="Seam contrast vs. the texture's own pixel-to-pixel detail. Around 1.00× = invisible">(~1.00 = INVISIBLE)</span>` : '// <b>TILING OFF</b>') +
      ` // COLOURS <b>${m.colors.toLocaleString('en-US')}</b> // <b>${res.ms} MS</b>${chk}`
    );
  }
  new ResizeObserver(() => draw()).observe(screen);

  let dragDiv = false;
  function moveDivider(clientX) {
    const res = curRes(); if (!res) return;
    const r = screen.getBoundingClientRect();
    const out = res.r.canvas, padPx = 16;
    const k = Math.min((r.width - padPx * 2) / out.width, (r.height - padPx * 2) / out.height);
    const dw = out.width * k, x0 = (r.width - dw) / 2;
    state.divider = Math.min(1, Math.max(0, (clientX - r.left - x0) / dw));
    draw();
  }
  let pan = null;
  screen.addEventListener('pointerdown', e => {
    if (!active()) return;
    screen.setPointerCapture(e.pointerId);
    if (state.view === 'split') { dragDiv = true; moveDivider(e.clientX); return; }
    pan = { x: e.clientX, y: e.clientY, px: state.pan.x, py: state.pan.y };
    screen.classList.add('dragging');
  });
  screen.addEventListener('pointermove', e => {
    if (dragDiv) { moveDivider(e.clientX); return; }
    if (!pan) return;
    state.pan.x = pan.px + e.clientX - pan.x;
    state.pan.y = pan.py + e.clientY - pan.y;
    draw();
  });
  const endPan = () => { pan = null; dragDiv = false; screen.classList.remove('dragging'); };
  screen.addEventListener('pointerup', endPan);
  screen.addEventListener('pointercancel', endPan);
  screen.addEventListener('wheel', e => {
    if (state.view !== 'tile' || !active()) return;
    e.preventDefault();
    state.zoom = Math.min(16, Math.max(0.15, state.zoom * Math.exp(-e.deltaY * 0.0015)));
    draw();
  }, { passive: false });

  function setView(v) {
    state.view = v;
    $$('[data-view]').forEach(b => b.setAttribute('aria-pressed', b.dataset.view === v));
    $('#tile-bar').hidden = v !== 'tile';
    draw();
  }
  $$('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  $$('[data-grid]').forEach(b => b.addEventListener('click', () => {
    state.grid = +b.dataset.grid; state.zoom = 1; state.pan = { x: 0, y: 0 };
    $$('[data-grid]').forEach(x => x.setAttribute('aria-pressed', x === b)); draw();
  }));
  $$('[data-tsrc]').forEach(b => b.addEventListener('click', () => {
    state.tsrc = b.dataset.tsrc;
    $$('[data-tsrc]').forEach(x => x.setAttribute('aria-pressed', x === b)); draw();
  }));
  $('#tg-seams').addEventListener('click', e => { state.seams = !state.seams; e.currentTarget.setAttribute('aria-pressed', state.seams); draw(); });
  $('#tg-recenter').addEventListener('click', () => { state.pan = { x: 0, y: 0 }; state.zoom = 1; draw(); });
  $('#tg-pixel').addEventListener('click', e => { state.pixelated = !state.pixelated; e.currentTarget.setAttribute('aria-pressed', state.pixelated); draw(); });

  // ---- export -------------------------------------------------------------------------
  $$('#seg-format .tbtn').forEach(b => b.addEventListener('click', () => {
    state.format = b.dataset.format;
    press('#seg-format', 'format', state.format);
    renderLib();
    if (state.format === 'jpg' && state.items.some(i => i.settings.keyBlack)) toast('JPG HAS NO TRANSPARENCY // USE PNG OR WEBP');
  }));
  $$('#seg-scope .tbtn').forEach(b => b.addEventListener('click', () => {
    state.scope = b.dataset.scope; press('#seg-scope', 'scope', state.scope); renderTree();
  }));
  $$('#seg-sizes .tbtn').forEach(b => b.addEventListener('click', () => {
    const v = +b.dataset.esize;
    if (state.sizes.has(v)) state.sizes.delete(v); else state.sizes.add(v);
    b.setAttribute('aria-pressed', state.sizes.has(v));
    renderTree();
  }));
  $('#in-name').addEventListener('input', e => {
    const it = active(); if (!it) return;
    it.name = e.target.value;
    const q = $(`.qitem[data-id="${it.id}"] .qname`);
    if (q) q.textContent = it.name + extOf(state.format);
  });
  $('#in-name').addEventListener('change', e => {
    const it = active(); if (!it) return;
    it.name = safeName(e.target.value); e.target.value = it.name; refreshRow(it); renderTree();
  });

  const scopeItems = () => {
    const it = active();
    if (state.scope === 'collection' && it) return itemsIn(it.col);
    return ordered();
  };
  const sizeList = () => [...state.sizes].sort((a, b) => b - a);

  function renderTree() {
    const items = scopeItems();
    if (!items.length) { $('#tree').textContent = '> nothing to export yet'; $('#btn-zip').textContent = '[ EXPORT ZIP ]'; return; }
    const cols = [];
    for (const it of items) { if (!cols.includes(it.col)) cols.push(it.col); }
    const sizes = sizeList();
    const lines = [];
    const colLines = (indent, last) => cols.forEach((c, i) => {
      const n = items.filter(it => it.col === c).length;
      lines.push(`${indent}${i === cols.length - 1 ? '└─' : '├─'} <b>${esc(safeName(c))}/</b>  ${n} file${n > 1 ? 's' : ''}`);
    });
    if (sizes.length) {
      sizes.forEach((s, i) => {
        const lastS = i === sizes.length - 1;
        lines.push(`${lastS ? '└─' : '├─'} <b>${s}/</b>`);
        colLines(lastS ? '   ' : '│  ');
      });
    } else {
      lines.push('<i>no size ticked: each file exports at its own SOURCE size</i>');
      colLines('');
    }
    const total = items.length * Math.max(1, sizes.length);
    $('#tree').innerHTML = lines.join('\n');
    $('#btn-zip').textContent = `[ EXPORT ZIP // ${total} FILE${total > 1 ? 'S' : ''} ]`;
  }

  function toBlob(canvas) {
    return new Promise((res, rej) => {
      let c = canvas;
      if (state.format === 'jpg') { // JPG has no alpha: flatten on black
        c = E.makeCanvas(canvas.width, canvas.height);
        const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height); x.drawImage(canvas, 0, 0);
      }
      c.toBlob(b => b ? res(b) : rej(new Error('encode failed')), mimeOf(state.format), state.quality / 100);
    });
  }
  function save(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  async function activeResult() {
    const it = active(); if (!it) return null;
    if (!curRes()) { clearTimeout(procTimer); await runActive(); }
    return curRes();
  }
  function flash(sel) { const b = $(sel); b.classList.add('ok'); setTimeout(() => b.classList.remove('ok'), 700); }
  async function download() {
    const it = active(); if (!it) return;
    const res = await activeResult(); if (!res) return;
    const fn = safeName(it.name) + extOf(state.format);
    save(await toBlob(res.r.canvas), fn);
    flash('#btn-dl'); toast('SAVED ' + fn.toUpperCase());
  }
  $('#btn-dl').addEventListener('click', download);
  $('#btn-sample').addEventListener('click', async () => {
    const it = active(); if (!it) return;
    const res = await activeResult(); if (!res) return;
    const t = res.r.canvas;
    const k = Math.min(1, 4096 / (t.width * 3), 4096 / (t.height * 3));
    const tw = Math.round(t.width * k), th = Math.round(t.height * k);
    const c = E.makeCanvas(tw * 3, th * 3);
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) x.drawImage(t, i * tw, j * th, tw, th);
    const fn = safeName(it.name) + '_3x3' + extOf(state.format);
    save(await toBlob(c), fn);
    toast('SAVED ' + fn.toUpperCase());
  });

  // zip layout: <size>/<collection>/<name>.png, or <collection>/<name>.png with no size ticked
  $('#btn-zip').addEventListener('click', async () => {
    const items = scopeItems();
    if (!items.length) return;
    const sizes = sizeList();
    const passes = sizes.length ? sizes : [null];
    const btn = $('#btn-zip'); btn.disabled = true;
    try {
      const files = [], used = new Set();
      const total = items.length * passes.length;
      let k = 0;
      for (const it of items) {
        const img = await getImg(it);
        for (const size of passes) {
          k++;
          setReadout(`> RENDERING ${k}/${total} // ${esc(it.col.toUpperCase())} // ${esc(it.base.toUpperCase())}${size ? ' @ ' + size : ''}`);
          await tick();
          const r = E.process(img, size ? Object.assign({}, it.settings, { size }) : it.settings);
          const dir = (size ? size + '/' : '') + safeName(it.col) + '/';
          let fn = dir + safeName(it.name), n = 2;
          while (used.has((fn + extOf(state.format)).toLowerCase())) fn = dir + safeName(it.name) + '_' + n++;
          fn += extOf(state.format); used.add(fn.toLowerCase());
          const blob = await toBlob(r.canvas);
          files.push({ name: fn, data: new Uint8Array(await blob.arrayBuffer()) });
        }
      }
      // group entries folder by folder: size (largest first), then collection, then name
      const sizeRank = f => sizes.length ? -parseInt(f.name, 10) : 0;
      files.sort((a, b) => sizeRank(a) - sizeRank(b) || collator.compare(a.name, b.name));
      const scopeTag = state.scope === 'collection' && active() ? '_' + safeName(active().col).replace(/\s+/g, '_') : '';
      save(window.makeZip(files), `11am-seamless${scopeTag}_${new Date().toISOString().slice(0, 10)}.zip`);
      toast(`ZIP SAVED // ${files.length} FILE(S)`);
    } catch (e) {
      console.error(e); toast('EXPORT FAILED: ' + e.message);
    } finally {
      btn.disabled = false; draw();
    }
  });

  $('#btn-pattern').addEventListener('click', () => {
    const pat = $('#in-pattern').value || '{name}';
    const items = scopeItems();
    const counters = new Map();
    for (const it of items) {
      const n = (counters.get(it.col) || 0) + 1; counters.set(it.col, n);
      it.name = safeName(pat
        .replace(/\{name\}/g, it.base).replace(/\{n\}/g, pad(n))
        .replace(/\{collection\}/g, it.col).replace(/\{mode\}/g, it.settings.tile ? it.settings.mode : 'flat'));
    }
    renderLib(); toast(`RENAMED ${items.length} FILE(S)`);
  });

  // ---- keyboard -----------------------------------------------------------------------
  document.addEventListener('keydown', e => {
    if (e.target.closest('input[type=text], textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    const list = ordered();
    const idx = list.findIndex(i => i.id === state.active);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!list.length || e.target.matches('input[type=range]')) return;
      e.preventDefault();
      const n = (idx + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
      select(list[n].id);
    } else if (e.key === 'd' || e.key === 'D') { download(); }
    else if (e.key === 't' || e.key === 'T') { setView(state.view === 'tile' ? 'split' : 'tile'); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && state.active !== null && !e.target.matches('input')) { e.preventDefault(); removeItem(state.active); }
  });

  const clock = () => { $('#clock').textContent = 'SYS ' + new Date().toLocaleTimeString('en-GB'); };
  clock(); setInterval(clock, 1000);

  renderLib();
  draw();
  window.__seamless = { state, ingest }; // debug / test handle
})();
