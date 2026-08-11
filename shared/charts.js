/* =============================================================
   경량 SVG 차트 엔진 (의존성 없음)
   - 컨테이너의 실제 픽셀 폭에 맞춰 그리고 ResizeObserver 로 다시 그린다
     (viewBox 만 늘리면 모바일에서 글자가 5px 로 줄어든다)
   - 색은 전부 CSS 변수로 읽어오므로 시안마다 테마만 바꾸면 된다
   - 모든 차트에 hover 툴팁 + 표(table) 보기 쌍둥이가 기본 탑재
   ============================================================= */
window.CH = (function () {
  const NS = 'http://www.w3.org/2000/svg';

  function el(name, attrs, text) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function h(name, attrs, text) {
    const e = document.createElement(name);
    for (const k in (attrs || {})) {
      if (k === 'class') e.className = attrs[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    if (text != null) e.textContent = text;
    return e;
  }
  const V = (node, name, fb) =>
    (getComputedStyle(node).getPropertyValue(name).trim() || fb);

  // ---------- 툴팁 (문서 전체에 하나만) ----------
  let tip;
  function tipEl() {
    if (!tip) {
      tip = h('div', { class: 'ch-tip', role: 'status' });
      tip.style.cssText =
        'position:fixed;z-index:9999;pointer-events:none;opacity:0;transition:opacity .12s;' +
        'padding:8px 10px;border-radius:8px;font-size:12px;line-height:1.5;max-width:230px;' +
        'box-shadow:0 6px 20px rgba(0,0,0,.18)';
      document.body.appendChild(tip);
    }
    return tip;
  }
  function showTip(host, rows, ev) {
    const t = tipEl();
    t.style.background = V(host, '--viz-tip-bg', '#111');
    t.style.color = V(host, '--viz-tip-ink', '#fff');
    t.style.border = '1px solid ' + V(host, '--viz-tip-border', 'rgba(255,255,255,.15)');
    t.innerHTML = '';
    rows.forEach(([k, v], i) => {
      const line = h('div');
      line.style.cssText = i === 0
        ? 'font-weight:700;margin-bottom:4px'
        : 'display:flex;gap:10px;justify-content:space-between';
      if (i === 0) line.textContent = k;
      else {
        const a = h('span', null, k); a.style.opacity = '.75';
        const b = h('span', null, String(v)); b.style.fontWeight = '600';
        line.append(a, b);
      }
      t.appendChild(line);
    });
    t.style.opacity = '1';
    moveTip(ev);
  }
  function moveTip(ev) {
    if (!tip) return;
    const pad = 14, r = tip.getBoundingClientRect();
    let x = ev.clientX + pad, y = ev.clientY + pad;
    if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - pad;
    if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - pad;
    tip.style.left = Math.max(8, x) + 'px';
    tip.style.top = Math.max(8, y) + 'px';
  }
  function hideTip() { if (tip) tip.style.opacity = '0'; }

  /** 마크에 툴팁 + 키보드 포커스를 붙인다 (툴팁이 값의 유일한 통로가 되지 않도록 표 보기도 함께 제공) */
  function bindTip(node, host, rows) {
    node.style.cursor = 'default';
    node.addEventListener('mouseenter', e => showTip(host, rows, e));
    node.addEventListener('mousemove', moveTip);
    node.addEventListener('mouseleave', hideTip);
    node.setAttribute('tabindex', '0');
    node.setAttribute('role', 'img');
    node.setAttribute('aria-label', rows.map(r => r.join(' ')).join(', '));
    node.addEventListener('focus', () => {
      const b = node.getBoundingClientRect();
      showTip(host, rows, { clientX: b.left + b.width / 2, clientY: b.top });
    });
    node.addEventListener('blur', hideTip);
  }

  // ---------- 형태 헬퍼 ----------
  /** 바닥에 붙고 위쪽만 4px 둥근 막대 */
  function topRoundedPath(x, y, w, hh, r) {
    r = Math.max(0, Math.min(r, w / 2, hh));
    return `M${x},${y + hh}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}` +
           `H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + hh}Z`;
  }
  /** 왼쪽에 붙고 오른쪽만 둥근 막대 */
  function rightRoundedPath(x, y, w, hh, r) {
    r = Math.max(0, Math.min(r, hh / 2, w));
    return `M${x},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}` +
           `V${y + hh - r}A${r},${r} 0 0 1 ${x + w - r},${y + hh}H${x}Z`;
  }
  function niceMax(v, ticks) {
    if (v <= 0) return 1;
    const raw = v / ticks, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= raw) || 10 * mag;
    return step * ticks;
  }

  // ---------- 공통 껍데기: 제목 + 차트 + 표 보기 토글 ----------
  function frame(host, spec, drawFn) {
    host.innerHTML = '';
    host.classList.add('ch-root');

    if (spec.title || spec.note) {
      const head = h('div', { class: 'ch-head' });
      if (spec.title) head.appendChild(h('h3', { class: 'ch-title' }, spec.title));
      if (spec.subtitle) head.appendChild(h('p', { class: 'ch-sub' }, spec.subtitle));
      host.appendChild(head);
    }

    const plot = h('div', { class: 'ch-plot' });
    host.appendChild(plot);

    // 표 보기 쌍둥이 — 색·툴팁 없이도 모든 값에 접근 가능해야 한다
    if (spec.table) {
      const wrap = h('div', { class: 'ch-tablewrap' });
      wrap.hidden = true;
      const btn = h('button', {
        class: 'ch-toggle', type: 'button', 'aria-expanded': 'false',
        onclick: () => {
          const open = wrap.hidden;
          wrap.hidden = !open;
          btn.setAttribute('aria-expanded', String(open));
          btn.textContent = open ? '표 닫기' : '표로 보기';
        },
      }, '표로 보기');
      host.append(btn, wrap);
      spec._tableWrap = wrap;
    }

    let ro;
    const draw = () => {
      const w = plot.clientWidth || host.clientWidth || 600;
      if (!w) return;
      plot.innerHTML = '';
      const svg = drawFn(w, host, spec);
      plot.appendChild(svg);
      if (spec.table && spec._tableWrap && !spec._tableWrap.dataset.done) {
        spec._tableWrap.appendChild(buildTable(spec.table));
        spec._tableWrap.dataset.done = '1';
      }
    };
    draw();
    if (window.ResizeObserver) {
      let last = plot.clientWidth;
      ro = new ResizeObserver(() => {
        const w = plot.clientWidth;
        if (Math.abs(w - last) > 1) { last = w; draw(); }
      });
      ro.observe(plot);
    }
    return host;
  }

  function buildTable(t) {
    const table = h('table', { class: 'ch-table' });
    const thead = h('thead'), tr = h('tr');
    t.cols.forEach(c => tr.appendChild(h('th', { scope: 'col' }, c)));
    thead.appendChild(tr);
    const tb = h('tbody');
    t.rows.forEach(r => {
      const row = h('tr');
      r.forEach((c, i) => row.appendChild(
        i === 0 ? h('th', { scope: 'row' }, String(c)) : h('td', null, String(c))));
      tb.appendChild(row);
    });
    table.append(thead, tb);
    if (t.caption) table.appendChild(h('caption', null, t.caption));
    return table;
  }

  // =============================================================
  // 세로 막대
  // =============================================================
  function bars(host, spec) {
    return frame(host, spec, (W, root) => {
      const d = spec.data;
      const H = spec.height || 240;
      const m = Object.assign({ t: 18, r: 8, b: 34, l: 38 }, spec.margin);
      if (spec.glyph) m.t += 14;
      const pw = Math.max(10, W - m.l - m.r), ph = Math.max(10, H - m.t - m.b);
      const ink = V(root, '--viz-ink', '#111'), muted = V(root, '--viz-muted', '#898781');
      const grid = V(root, '--viz-grid', '#e1e0d9'), axis = V(root, '--viz-axis', '#c3c2b7');
      const svg = el('svg', {
        width: W, height: H, viewBox: `0 0 ${W} ${H}`,
        role: 'img', 'aria-label': spec.aria || spec.title || '막대 차트',
      });
      svg.style.display = 'block';

      const nTicks = spec.yTicks || 4;
      const max = spec.yMax || niceMax(Math.max(...d.map(x => x.value)), nTicks);
      const y = v => m.t + ph - (v / max) * ph;

      for (let i = 0; i <= nTicks; i++) {
        const val = max * i / nTicks, yy = y(val);
        svg.appendChild(el('line', {
          x1: m.l, x2: m.l + pw, y1: yy, y2: yy,
          stroke: i === 0 ? axis : grid, 'stroke-width': 1, 'shape-rendering': 'crispEdges',
        }));
        svg.appendChild(el('text', {
          x: m.l - 7, y: yy + 4, 'text-anchor': 'end', fill: muted,
          'font-size': 11, 'font-variant-numeric': 'tabular-nums',
        }, spec.yFmt ? spec.yFmt(val) : String(Math.round(val))));
      }

      const band = pw / d.length;
      const bw = Math.max(3, band - Math.max(2, band * 0.28));   // 2px 이상 서피스 간격
      const every = spec.tickEvery || (band < 26 ? 2 : 1);

      d.forEach((item, i) => {
        const bh = Math.max(0, (item.value / max) * ph);
        const x = m.l + band * i + (band - bw) / 2;
        const yy = m.t + ph - bh;
        const fill = spec.color ? spec.color(item, i) : V(root, '--viz-series', '#2a78d6');
        const p = el('path', { d: topRoundedPath(x, yy, bw, bh, 4), fill, opacity: item.dim ? 0.35 : 1 });
        bindTip(p, root, spec.tooltip ? spec.tooltip(item, i) : [[item.label, ''], ['값', item.value]]);
        svg.appendChild(p);

        // 색 이외의 2차 부호화 — 상태를 나타내는 글리프
        if (spec.glyph) {
          const g = spec.glyph(item, i);
          if (g) svg.appendChild(el('text', {
            x: x + bw / 2, y: yy - 7, 'text-anchor': 'middle',
            fill: spec.glyphColor ? spec.glyphColor(item, i) : ink,
            'font-size': 11, 'font-weight': 700,
          }, g));
        }
        // 직접 라벨은 선별적으로만 (전 지점에 숫자를 찍지 않는다)
        if (spec.directLabel && spec.directLabel(item, i)) {
          svg.appendChild(el('text', {
            x: x + bw / 2, y: yy - (spec.glyph ? 21 : 7), 'text-anchor': 'middle',
            fill: ink, 'font-size': 11, 'font-weight': 700,
          }, spec.valueFmt ? spec.valueFmt(item.value) : String(item.value)));
        }
        if (i % every === 0) {
          svg.appendChild(el('text', {
            x: x + bw / 2, y: m.t + ph + 15, 'text-anchor': 'middle',
            fill: item.emphasis ? ink : muted, 'font-size': 11,
            'font-weight': item.emphasis ? 700 : 400,
            'font-variant-numeric': 'tabular-nums',
          }, item.label));
        }
      });

      if (spec.xTitle) svg.appendChild(el('text', {
        x: m.l + pw, y: H - 3, 'text-anchor': 'end', fill: muted, 'font-size': 10,
      }, spec.xTitle));
      return svg;
    });
  }

  // =============================================================
  // 가로 막대
  // =============================================================
  function hbars(host, spec) {
    return frame(host, spec, (W, root) => {
      const d = spec.data;
      const rowH = spec.rowH || 30, gap = 6;
      const H = d.length * (rowH + gap) + 26;
      const m = Object.assign({ t: 6, r: 46, b: 20, l: spec.labelW || 46 }, spec.margin);
      const pw = Math.max(10, W - m.l - m.r);
      const ink = V(root, '--viz-ink', '#111'), muted = V(root, '--viz-muted', '#898781');
      const axis = V(root, '--viz-axis', '#c3c2b7');
      const svg = el('svg', {
        width: W, height: H, viewBox: `0 0 ${W} ${H}`,
        role: 'img', 'aria-label': spec.aria || spec.title || '가로 막대 차트',
      });
      svg.style.display = 'block';
      const max = spec.xMax || niceMax(Math.max(...d.map(x => x.value)), 4);

      d.forEach((item, i) => {
        const yy = m.t + i * (rowH + gap);
        const bw = Math.max(2, (item.value / max) * pw);
        const fill = spec.color ? spec.color(item, i) : V(root, '--viz-series', '#2a78d6');
        svg.appendChild(el('text', {
          x: m.l - 10, y: yy + rowH / 2 + 4, 'text-anchor': 'end',
          fill: item.emphasis ? ink : muted, 'font-size': 12,
          'font-weight': item.emphasis ? 700 : 500,
        }, item.label));
        const p = el('path', {
          d: rightRoundedPath(m.l, yy, bw, rowH, 4), fill, opacity: item.dim ? 0.4 : 1,
        });
        bindTip(p, root, spec.tooltip ? spec.tooltip(item, i) : [[item.label, ''], ['값', item.value]]);
        svg.appendChild(p);
        svg.appendChild(el('text', {
          x: m.l + bw + 8, y: yy + rowH / 2 + 4, fill: ink,
          'font-size': 12, 'font-weight': 700, 'font-variant-numeric': 'tabular-nums',
        }, spec.valueFmt ? spec.valueFmt(item.value, item) : String(item.value)));
      });
      svg.appendChild(el('line', {
        x1: m.l, x2: m.l, y1: m.t, y2: m.t + d.length * (rowH + gap) - gap,
        stroke: axis, 'stroke-width': 1, 'shape-rendering': 'crispEdges',
      }));
      if (spec.xTitle) svg.appendChild(el('text', {
        x: m.l, y: H - 4, fill: muted, 'font-size': 10,
      }, spec.xTitle));
      return svg;
    });
  }

  // =============================================================
  // 라인 (십자선 툴팁)
  // =============================================================
  function line(host, spec) {
    return frame(host, spec, (W, root) => {
      const d = spec.data;
      const H = spec.height || 220;
      const m = Object.assign({ t: 20, r: 16, b: 30, l: 42 }, spec.margin);
      const pw = Math.max(10, W - m.l - m.r), ph = Math.max(10, H - m.t - m.b);
      const ink = V(root, '--viz-ink', '#111'), muted = V(root, '--viz-muted', '#898781');
      const grid = V(root, '--viz-grid', '#e1e0d9'), axis = V(root, '--viz-axis', '#c3c2b7');
      const series = V(root, '--viz-series', '#2a78d6');
      const surface = V(root, '--viz-surface', '#fff');
      const svg = el('svg', {
        width: W, height: H, viewBox: `0 0 ${W} ${H}`,
        role: 'img', 'aria-label': spec.aria || spec.title || '선 차트',
      });
      svg.style.display = 'block';

      const vals = d.map(x => x.value);
      const lo = spec.yMin != null ? spec.yMin : Math.min(0, Math.min(...vals));
      const hi = spec.yMax != null ? spec.yMax : niceMax(Math.max(...vals), 4);
      const y = v => m.t + ph - ((v - lo) / (hi - lo)) * ph;
      const x = i => m.l + (d.length === 1 ? pw / 2 : (pw * i) / (d.length - 1));

      const nT = 4;
      for (let i = 0; i <= nT; i++) {
        const val = lo + (hi - lo) * i / nT, yy = y(val);
        svg.appendChild(el('line', {
          x1: m.l, x2: m.l + pw, y1: yy, y2: yy,
          stroke: Math.abs(val) < 1e-9 ? axis : grid, 'stroke-width': 1, 'shape-rendering': 'crispEdges',
        }));
        svg.appendChild(el('text', {
          x: m.l - 7, y: yy + 4, 'text-anchor': 'end', fill: muted,
          'font-size': 11, 'font-variant-numeric': 'tabular-nums',
        }, spec.yFmt ? spec.yFmt(val) : String(Math.round(val * 10) / 10)));
      }

      if (spec.area) {
        const ap = d.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join('') +
          `L${x(d.length - 1)},${m.t + ph}L${x(0)},${m.t + ph}Z`;
        svg.appendChild(el('path', { d: ap, fill: series, opacity: 0.10 }));
      }
      svg.appendChild(el('path', {
        d: d.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(''),
        fill: 'none', stroke: series, 'stroke-width': 2,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      }));

      d.forEach((p, i) => {
        // 겹치는 마크에는 2px 서피스 링
        svg.appendChild(el('circle', {
          cx: x(i), cy: y(p.value), r: 5, fill: series, stroke: surface, 'stroke-width': 2,
        }));
        svg.appendChild(el('text', {
          x: x(i), y: m.t + ph + 16, 'text-anchor': 'middle', fill: muted, 'font-size': 11,
        }, p.label));
        if (spec.directLabel && spec.directLabel(p, i)) {
          svg.appendChild(el('text', {
            x: x(i), y: y(p.value) - 12, 'text-anchor': 'middle', fill: ink,
            'font-size': 11, 'font-weight': 700,
          }, spec.valueFmt ? spec.valueFmt(p.value) : String(p.value)));
        }
        // 마크보다 큰 히트 영역 (최소 ~24px)
        const hitW = Math.max(24, pw / d.length);
        const hit = el('rect', {
          x: x(i) - hitW / 2, y: m.t, width: hitW, height: ph, fill: 'transparent',
        });
        bindTip(hit, root, spec.tooltip ? spec.tooltip(p, i) : [[p.label, ''], ['값', p.value]]);
        svg.appendChild(hit);
      });
      return svg;
    });
  }

  // =============================================================
  // 히트맵 (연속 크기 → 단일 색조 순차 램프 + 스케일 범례)
  // =============================================================
  function heat(host, spec) {
    return frame(host, spec, (W, root) => {
      const rows = spec.rows, cols = spec.cols;             // [{key,label}]
      const m = Object.assign({ t: 20, r: 6, b: 44, l: 40 }, spec.margin);
      const gap = 2;                                        // 서피스 간격
      const pw = Math.max(10, W - m.l - m.r);
      const cw = pw / cols.length;
      const chh = Math.min(34, Math.max(20, cw));
      const H = m.t + rows.length * chh + m.b;
      const muted = V(root, '--viz-muted', '#898781');
      const ink = V(root, '--viz-ink', '#111');
      const ramp = (V(root, '--viz-seq', '#cde2fb,#9ec5f4,#5598e7,#256abf,#0d366b')).split(',').map(s => s.trim());
      const svg = el('svg', {
        width: W, height: H, viewBox: `0 0 ${W} ${H}`,
        role: 'img', 'aria-label': spec.aria || spec.title || '히트맵',
      });
      svg.style.display = 'block';

      const max = Math.max(...rows.flatMap(r => cols.map(c => spec.value(r, c))));
      const stepOf = v => {
        if (v <= 0) return -1;
        const t = v / max;
        return Math.min(ramp.length - 1, Math.floor(t * ramp.length - 1e-9));
      };

      cols.forEach((c, j) => {
        if (cols.length > 16 && j % 2) return;
        svg.appendChild(el('text', {
          x: m.l + cw * j + cw / 2, y: m.t - 7, 'text-anchor': 'middle',
          fill: muted, 'font-size': 10, 'font-variant-numeric': 'tabular-nums',
        }, c.label));
      });

      rows.forEach((r, i) => {
        svg.appendChild(el('text', {
          x: m.l - 8, y: m.t + chh * i + chh / 2 + 4, 'text-anchor': 'end',
          fill: ink, 'font-size': 11, 'font-weight': 600,
        }, r.label));
        cols.forEach((c, j) => {
          const v = spec.value(r, c), s = stepOf(v);
          const cell = el('rect', {
            x: m.l + cw * j + gap / 2, y: m.t + chh * i + gap / 2,
            width: Math.max(1, cw - gap), height: Math.max(1, chh - gap), rx: 3,
            fill: s < 0 ? V(root, '--viz-empty', 'rgba(128,128,128,.10)') : ramp[s],
          });
          bindTip(cell, root, spec.tooltip(r, c, v));
          svg.appendChild(cell);
        });
      });

      // 스케일 범례 — 연속 색 부호화에는 반드시 스케일이 붙는다
      const ly = m.t + rows.length * chh + 18, lw = 15;
      svg.appendChild(el('text', { x: m.l, y: ly + 11, fill: muted, 'font-size': 10 }, '적음'));
      ramp.forEach((c, i) => svg.appendChild(el('rect', {
        x: m.l + 30 + i * (lw + 2), y: ly, width: lw, height: 10, rx: 2, fill: c,
      })));
      svg.appendChild(el('text', {
        x: m.l + 34 + ramp.length * (lw + 2), y: ly + 11, fill: muted, 'font-size': 10,
      }, `많음 (최대 ${max}${spec.unit || ''})`));
      return svg;
    });
  }

  return { bars, hbars, line, heat, frame, buildTable, el, h, V, showTip, hideTip, bindTip };
})();
