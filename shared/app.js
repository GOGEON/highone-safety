/* =============================================================
   시안 공통 로직 — 4개 디자인이 동일한 분석 결과를 공유하고
   달라지는 것은 오직 CSS 테마와 레이아웃뿐이다.
   ============================================================= */
window.APP = (function () {
  const M = window.MODEL, D = M.D, S = M.summary;
  const registry = [];

  // ---------- 필터 칩 ----------
  function chips(host, items, getVal, onSet, extraClass) {
    host.innerHTML = '';
    const made = [];
    items.forEach(it => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (extraClass ? ' ' + extraClass : '');
      b.textContent = it.t;
      b.setAttribute('aria-pressed', String(getVal() === it.v));
      b.addEventListener('click', () => onSet(it.v));
      host.appendChild(b);
      made.push({ b, v: it.v });
    });
    registry.push({ made, getVal });
  }
  function syncChips() {
    registry.forEach(g => g.made.forEach(x =>
      x.b.setAttribute('aria-pressed', String(g.getVal() === x.v))));
  }

  const crowdWord = ci =>
    ci >= 80 ? '매우 붐빔' : ci >= 55 ? '붐빔' : ci >= 30 ? '보통' : '한산';

  const MLABEL = m => m + '월';

  // ---------- 조건과 무관한 고정 차트 6종 ----------
  function staticCharts(id) {
    const $ = k => id[k] ? document.getElementById(id[k]) : null;
    const peakH = S.peakHour;

    /* 1. 시간대별 사고 분포 — 단일 계열이므로 범례 없이 제목이 계열을 지칭하고,
          직접 라벨은 최댓값 하나에만 붙인다. */
    if ($('hour')) CH.bars($('hour'), {
      title: '시간대별 사고 발생 분포',
      subtitle: `2024년 총 ${M.num(S.totalAccidents)}건. 오전 11시와 오후 3시에 두 개의 봉우리가 있고, ` +
                `17시는 주간→야간 전환 정비 시간대라 사실상 비어 있습니다.`,
      data: D.hourly.map(x => ({
        label: M.pad(x.hour), value: x.accidents, x,
        emphasis: x.hour === peakH.hour,
      })),
      height: 250, tickEvery: 1,
      directLabel: d => d.x.hour === peakH.hour,
      valueFmt: v => v + '건',
      tooltip: d => [
        [M.hrange(d.x.hour), ''],
        ['사고건수', d.value + '건'],
        ['전체 대비', d.x.share + '%'],
        ['운영 구분', M.session(d.x.hour).label],
      ],
      yFmt: v => String(Math.round(v)),
      xTitle: '시각',
      table: {
        cols: ['시각', '사고건수', '전체 대비', '운영 구분'],
        rows: D.hourly.map(x => [M.hrange(x.hour), x.accidents + '건', x.share + '%', M.session(x.hour).label]),
        caption: '출처: 강원랜드 스키장 시간대별 사고 발생 현황(2024)',
      },
    });

    if ($('noteHour')) $('noteHour').innerHTML =
      `<span class="ic" aria-hidden="true">◆</span><div>` +
      `사고의 <b>${(S.dayShare / S.totalAccidents * 100).toFixed(0)}%가 주간(09–16시)</b>에, ` +
      `<b>${(S.nightShare / S.totalAccidents * 100).toFixed(0)}%가 야간(18–22시)</b>에 발생합니다. ` +
      `단일 최다 시간대는 <b>${M.hrange(peakH.hour)}(${peakH.accidents}건, 전체의 ${peakH.share}%)</b>로, ` +
      `점심 이후 체력 저하·설질 연화가 겹치는 시간대로 풀이되지만, 원본 데이터에 사고 원인 정보가 없어 추정입니다.</div>`;

    /* 2. 월별 사고건수 — 사고율과 스케일이 다르므로 절대 같은 축에 겹치지 않는다 */
    if ($('monthAcc')) CH.bars($('monthAcc'), {
      title: '월별 사고건수',
      subtitle: '시즌 순서(12월→3월). 이용객이 가장 많은 1월에 사고도 가장 많습니다.',
      data: D.months.map(m => ({ label: MLABEL(m.month), value: m.accidents, m })),
      height: 200,
      directLabel: () => true,
      valueFmt: v => v + '건',
      tooltip: d => [
        [MLABEL(d.m.month), ''],
        ['사고건수', d.value + '건'],
        ['리프트권 발매', M.num(d.m.lift) + '매'],
        ['영업일', d.m.days + '일'],
      ],
      table: {
        cols: ['월', '사고건수', '리프트권 발매', '영업일'],
        rows: D.months.map(m => [MLABEL(m.month), m.accidents + '건', M.num(m.lift) + '매', m.days + '일']),
      },
    });

    /* 3. 월별 사고율 — 이 프로젝트에서 가장 중요한 발견.
          이야기가 값 하나(3월)이므로 강조 + 나머지는 흐리게. */
    const topRate = S.topRateMonth;
    if ($('monthRate')) CH.bars($('monthRate'), {
      title: '이용량 대비 사고율',
      subtitle: '리프트권 1,000매당 사고건수. 절대 건수와 순위가 뒤집힙니다.',
      data: D.months.map(m => ({
        label: MLABEL(m.month), value: m.rate, m,
        emphasis: m.month === topRate.month, dim: m.month !== topRate.month,
      })),
      height: 200, yTicks: 3,
      directLabel: () => true,
      valueFmt: v => v.toFixed(2),
      yFmt: v => v.toFixed(1),
      tooltip: d => [
        [MLABEL(d.m.month), ''],
        ['사고율', d.value.toFixed(2) + ' 건/1,000매'],
        ['사고건수', d.m.accidents + '건'],
        ['리프트권 발매', M.num(d.m.lift) + '매'],
        ['일평균 발매', M.num(Math.round(d.m.meanDaily)) + '매'],
      ],
      table: {
        cols: ['월', '사고율(건/1,000매)', '사고건수', '발매량'],
        rows: D.months.map(m => [MLABEL(m.month), m.rate.toFixed(2), m.accidents + '건', M.num(m.lift) + '매']),
        caption: '사고율 = 월 사고건수 ÷ 월 리프트권 발매량 × 1,000',
      },
    });

    if ($('noteRate')) $('noteRate').innerHTML =
      `<span class="ic" aria-hidden="true">◆</span><div>` +
      `<b>3월은 가장 한산하지만 가장 위험합니다.</b> 발매량은 1월의 ${(D.months.find(m=>m.month===3).lift / D.months.find(m=>m.month===1).lift * 100).toFixed(0)}% 수준인데 ` +
      `1,000매당 사고는 <b>${topRate.rate.toFixed(2)}건으로 1월보다 ${S.marchVsJan}% 높습니다.</b> ` +
      `기상 데이터에서 3월 평균기온은 ${D.weather.find(w=>w.month===3).tavg}℃로 유일하게 영상이고, ` +
      `종일 영하일이 ${D.weather.find(w=>w.month===3).freezeDays}일에 그칩니다. 낮에 녹고 밤에 어는 설면이 원인으로 추정됩니다. ` +
      `혼잡도만 보고 위험도를 판단하면 놓치는 구간입니다.</div>`;

    /* 4. 월 × 시간대 히트맵 — 연속 크기이므로 단일 색조 순차 램프 + 스케일 범례 */
    if ($('heat')) CH.heat($('heat'), {
      title: '월 × 시간대 사고 집중도',
      subtitle: '한 칸은 해당 월·시각의 2024년 사고건수입니다. 색이 진할수록 사고가 많습니다.',
      rows: D.months.map(m => ({ key: m.month, label: MLABEL(m.month) })),
      cols: D.hourly.map(x => ({ key: x.hour, label: M.pad(x.hour) })),
      value: (r, c) => D.hourly.find(x => x.hour === c.key).byMonth[String(r.key)] || 0,
      unit: '건',
      tooltip: (r, c, v) => [
        [`${MLABEL(r.key)} ${M.hrange(c.key)}`, ''],
        ['사고건수', v + '건'],
      ],
      table: {
        cols: ['월', ...D.hourly.map(x => M.pad(x.hour) + '시')],
        rows: D.months.map(m => [MLABEL(m.month),
          ...D.hourly.map(x => x.byMonth[String(m.month)] || 0)]),
        caption: '단위: 건 · 출처: 강원랜드 스키장 시간대별 사고 발생 현황(2024)',
      },
    });

    /* 5. 요일별 혼잡 — 리프트권 일평균 발매량 */
    const order = [0, 1, 2, 3, 4, 5, 6];
    const maxDow = Math.max(...D.dow.map(d => d.mean));
    if ($('dow')) CH.hbars($('dow'), {
      title: '요일별 리프트권 일평균 발매량',
      subtitle: `2024년 영업일 ${S.openDays}일 기준. 혼잡 보정 계수의 근거가 되는 값입니다.`,
      data: order.map(w => {
        const d = D.dow[w];
        return {
          label: M.DOW_KO[w] + '요일', value: d.mean, d, w,
          emphasis: d.mean === maxDow, dim: d.mean !== maxDow,
        };
      }),
      rowH: 26, labelW: 58,
      valueFmt: (v, it) => `${M.num(Math.round(v))}매  ×${it.d.factor.toFixed(2)}`,
      tooltip: d => [
        [M.DOW_KO[d.w] + '요일', ''],
        ['일평균 발매', M.num(Math.round(d.value)) + '매'],
        ['혼잡계수', '×' + d.d.factor.toFixed(2)],
        ['영업일 수', d.d.days + '일'],
      ],
      xTitle: '일평균 발매량(매) · 오른쪽 숫자는 전체 평균 대비 혼잡계수',
      table: {
        cols: ['요일', '일평균 발매량', '혼잡계수', '영업일'],
        rows: order.map(w => [M.DOW_KO[w] + '요일', M.num(Math.round(D.dow[w].mean)) + '매',
          '×' + D.dow[w].factor.toFixed(2), D.dow[w].days + '일']),
        caption: `전체 일평균 ${M.num(Math.round(S.meanDaily))}매 = 계수 1.00`,
      },
    });

    if ($('noteDow')) $('noteDow').innerHTML =
      `<span class="ic" aria-hidden="true">◆</span><div>` +
      `<b>토요일은 화~목 대비 ${S.satVsMidweek}배</b> 붐빕니다(일평균 ${M.num(Math.round(D.dow[5].mean))}매 대 ` +
      `${M.num(Math.round((D.dow[1].mean + D.dow[2].mean + D.dow[3].mean) / 3))}매). ` +
      `같은 15시라도 토요일과 화요일의 위험지수가 크게 벌어지는 이유입니다.</div>`;

    /* 6. 계절 기상 — 참고 지표. 사고·발매 데이터(2024)와 연도가 달라 결합하지 않고 별도로 둔다.
          기온과 일수는 단위가 다르므로 축을 공유하지 않고 차트를 나눈다. */
    if ($('wx')) {
      const host = $('wx');
      host.innerHTML = '';
      const a = document.createElement('div'), b = document.createElement('div');
      b.style.marginTop = '26px';
      host.append(a, b);

      CH.line(a, {
        title: '월평균 기온',
        subtitle: `하이원리조트 마운틴탑·벨리베이스 관측 ${D.meta.wxLocations.length}개 지점, ` +
                  `2017–2019년 평균. 사고·발매 데이터(2024)와 연도가 달라 위험지수 계산에는 넣지 않고 해석 참고용으로만 씁니다.`,
        data: D.weather.map(w => ({ label: MLABEL(w.month), value: w.tavg, w })),
        height: 210, area: true, yMin: -10, yMax: 5,
        directLabel: w => w.value > 0,
        valueFmt: v => v.toFixed(1) + '℃',
        yFmt: v => v.toFixed(0) + '℃',
        tooltip: d => [
          [MLABEL(d.w.month) + ' 기상 평균', ''],
          ['평균기온', d.w.tavg + '℃'],
          ['평균 최저', d.w.tmin + '℃'],
          ['평균 최고', d.w.tmax + '℃'],
          ['평균 풍속', d.w.wind + ' m/s'],
          ['관측일수', d.w.n + '일'],
        ],
        table: {
          cols: ['월', '평균기온', '평균최저', '평균최고', '평균풍속', '관측일수'],
          rows: D.weather.map(w => [MLABEL(w.month), w.tavg + '℃', w.tmin + '℃', w.tmax + '℃', w.wind + ' m/s', w.n + '일']),
          caption: '출처: 강원랜드 하이원리조트 계절기상 정보(2017–2019)',
        },
      });

      CH.bars(b, {
        title: '종일 영하일 비율',
        subtitle: '최고기온이 0℃ 아래로 유지된 날의 비율. 높을수록 설면이 하루 종일 얼어 있습니다.',
        data: D.weather.map(w => ({
          label: MLABEL(w.month), value: +(w.freezeDays / w.n * 100).toFixed(1), w,
          emphasis: w.month === 3, dim: w.month !== 3,
        })),
        height: 190, yMax: 60, yTicks: 3,
        directLabel: () => true,
        valueFmt: v => v.toFixed(0) + '%',
        yFmt: v => v.toFixed(0) + '%',
        tooltip: d => [
          [MLABEL(d.w.month), ''],
          ['종일 영하일', d.w.freezeDays + '일 / ' + d.w.n + '일'],
          ['비율', d.value + '%'],
          ['강수일', d.w.rainDays + '일'],
        ],
        table: {
          cols: ['월', '종일 영하일', '관측일수', '비율', '강수일'],
          rows: D.weather.map(w => [MLABEL(w.month), w.freezeDays + '일', w.n + '일',
            (w.freezeDays / w.n * 100).toFixed(1) + '%', w.rainDays + '일']),
        },
      });
    }

    if ($('noteWx')) {
      const w3 = D.weather.find(w => w.month === 3), w1 = D.weather.find(w => w.month === 1);
      $('noteWx').innerHTML =
        `<span class="ic" aria-hidden="true">◆</span><div>` +
        `1월은 관측일의 <b>${(w1.freezeDays / w1.n * 100).toFixed(0)}%</b>가 종일 영하지만 3월은 ` +
        `<b>${(w3.freezeDays / w3.n * 100).toFixed(0)}%</b>에 불과하고, 강수일은 ${w3.rainDays}일로 가장 많습니다. ` +
        `낮에 녹은 눈이 밤사이 얼어붙는 <b>해빙–결빙 반복</b> 구간이라 3월 사고율이 높다는 해석과 방향이 맞습니다. ` +
        `다만 기상은 2017–2019년, 사고는 2024년 자료라 인과가 아닌 <b>정황 근거</b>로만 제시합니다.</div>`;
    }

    // ---------- 출처 ----------
    if ($('srcList')) {
      $('srcList').innerHTML = D.meta.sources.map(s =>
        `<li><b>${s.name}</b> — ${s.period}, ${M.num(s.rows)}행 · ` +
        `<a href="${s.url}" target="_blank" rel="noopener">공공데이터포털</a></li>`).join('');
    }
    if ($('method')) {
      $('method').innerHTML =
        `<b>위험지수 산출식</b> = 시간대 사고지수 × (1 + 0.5 × (혼잡계수 − 1)) × 월 사고율계수, ` +
        `전체 조합의 최댓값을 100으로 정규화. 혼잡계수 = 월 혼잡계수 × 요일 혼잡계수(리프트권 일평균 발매량 기준). ` +
        `혼잡을 0.5로 감쇠시키는 이유는 붐빔이 사고 노출량을 늘리되 개인의 사고 확률과 1:1로 비례하지는 않기 때문이며, ` +
        `그 결과 한산하지만 사고율이 높은 3월이 과소평가되지 않습니다. ` +
        `등급 경계는 ${M.T1}점·${M.T2}점(안전/주의/위험)입니다. ` +
        `한계: 리프트권 발매량은 <b>일 단위</b>라 시간대별 실이용객 수는 알 수 없어, 시간대 축은 사고 절대건수로만 구성했습니다. ` +
        `또 사고 데이터에 부상 정도·사고 유형이 없어 모든 사고를 동일 가중으로 계산했습니다.`;
    }
  }

  return { chips, syncChips, crowdWord, staticCharts, MLABEL };
})();
