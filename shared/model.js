/* =============================================================
   하이원 스키장 혼잡·사고 위험 통합 예보 — 공용 분석 모델
   4개 디자인 시안이 모두 이 파일 하나를 공유한다.
   전제: window.DATA (data/dataset.js) 가 먼저 로드되어 있을 것.
   ============================================================= */
window.MODEL = (function () {
  const D = window.DATA;

  const HOURS = D.hourly.map(h => h.hour);              // 9 ~ 22
  const MONTHS = D.months.map(m => m.month);            // [12, 1, 2, 3] 시즌 순
  const DOW_KO = ['월', '화', '수', '목', '금', '토', '일'];

  // ---- 축 1. 시간대 사고 프로파일 (기본 위험점수 0~100) ----
  const base = {}, accByHour = {};
  D.hourly.forEach(h => { base[h.hour] = h.base; accByHour[h.hour] = h.accidents; });

  // ---- 축 2. 월별 지표 ----
  const monthCrowdF = {},   // 혼잡계수 = 월 일평균 발매량 / 전체 일평균
        monthRateF = {},    // 사고율계수 = 월 사고율 / 평균 사고율
        monthInfo = {};
  const meanRate = D.months.reduce((s, m) => s + m.rate, 0) / D.months.length;
  D.months.forEach(m => {
    monthCrowdF[m.month] = m.factor;
    monthRateF[m.month] = +(m.rate / meanRate).toFixed(4);
    monthInfo[m.month] = m;
  });

  // ---- 축 3. 요일 혼잡계수 ----
  const dowF = {};
  D.dow.forEach(x => dowF[x.dow] = x.factor);

  /* -----------------------------------------------------------
     혼잡지수 : 얼마나 붐비는가 (대기시간 관점)
       crowd(월, 요일) = 월 혼잡계수 × 요일 혼잡계수
     -------------------------------------------------------- */
  const crowdRaw = (m, w) => monthCrowdF[m] * dowF[w];
  let CROWD_MAX = 0;
  MONTHS.forEach(m => DOW_KO.forEach((_, w) => { CROWD_MAX = Math.max(CROWD_MAX, crowdRaw(m, w)); }));
  const crowdIndex = (m, w) => Math.round(crowdRaw(m, w) / CROWD_MAX * 1000) / 10;

  /* -----------------------------------------------------------
     위험지수 : 얼마나 다치기 쉬운가
       raw(시각, 월, 요일)
         = 시간대 사고지수                     (언제 사고가 몰리나)
         × (1 + 0.5 × (혼잡계수 − 1))          (붐빌수록 충돌·대기 위험 ↑, 0.5로 감쇠)
         × 월 사고율계수                       (이용객 1인당 사고 확률 보정)

     혼잡을 그대로 곱하지 않고 0.5로 감쇠시키는 이유:
     혼잡은 사고의 '노출량'을 늘리지만 개인의 사고 확률과 1:1로 비례하지 않는다.
     반대로 3월은 한산하지만(혼잡계수 0.18) 리프트권 1,000매당 사고는 3.06건으로
     시즌 최고다. 두 힘을 분리해 곱해야 '한산해도 미끄러운 3월'이 사라지지 않는다.
     -------------------------------------------------------- */
  const DAMP = 0.5;
  const riskRaw = (h, m, w) => base[h] * (1 + DAMP * (crowdRaw(m, w) - 1)) * monthRateF[m];

  let RISK_MAX = 0, RISK_ARG = null;   // 100점 기준 조합을 하드코딩하지 않고 실제 최댓값에서 얻는다
  HOURS.forEach(h => MONTHS.forEach(m => DOW_KO.forEach((_, w) => {
    const v = riskRaw(h, m, w);
    if (v > RISK_MAX) { RISK_MAX = v; RISK_ARG = { hour: h, month: m, dow: w }; }
  })));
  const risk = (h, m, w) => Math.round(riskRaw(h, m, w) / RISK_MAX * 1000) / 10;
  /** "1월 토요일 15시" 형태 — 위험지수 100점의 기준 조합 라벨 */
  const riskMaxLabel =
    `${RISK_ARG.month}월 ${DOW_KO[RISK_ARG.dow]}요일 ${RISK_ARG.hour}시`;

  // ---- 3단계 신호등 (색만으로 구분하지 않도록 아이콘·라벨을 함께 정의) ----
  const T1 = 30, T2 = 58;
  const LEVELS = {
    safe:    { key: 'safe',    label: '안전',   short: '안전', icon: '✓', shape: 'circle',
               desc: '평소 수준. 여유롭게 이용할 수 있는 시간대', token: 'good' },
    caution: { key: 'caution', label: '주의',   short: '주의', icon: '!', shape: 'triangle',
               desc: '이용객이 늘고 사고가 잦아지는 시간대', token: 'warning' },
    danger:  { key: 'danger',  label: '위험',   short: '위험', icon: '✕', shape: 'square',
               desc: '사고가 집중되는 시간대. 속도를 줄이고 휴식 권장', token: 'critical' },
  };
  const level = s => s >= T2 ? LEVELS.danger : s >= T1 ? LEVELS.caution : LEVELS.safe;

  // ---- 운영 구분 (17시는 주간→야간 전환 정비 시간대라 사고·이용 모두 급감) ----
  const session = h => h <= 16 ? { key: 'day', label: '주간' }
                    : h === 17 ? { key: 'break', label: '전환' }
                    : { key: 'night', label: '야간' };

  /** 특정 월·요일의 시간대별 전체 프로파일 */
  function dayProfile(m, w) {
    return HOURS.map(h => {
      const s = risk(h, m, w);
      return {
        hour: h, score: s, level: level(s),
        accidents: accByHour[h],
        share: D.hourly.find(x => x.hour === h).share,
        session: session(h),
      };
    });
  }

  /** 추천 / 회피 시간대 — 전환 시간대(17시)는 제외.
   *  주간·야간은 이용 경험이 전혀 다르므로 각각의 최적 시간대도 함께 돌려준다
   *  (전체 최저가 야간 마감 시간으로 잡혀 "낮에 갈 사람"에게 쓸모없어지는 것을 막는다). */
  function recommend(m, w) {
    const p = dayProfile(m, w).filter(x => x.session.key !== 'break');
    const asc = [...p].sort((a, b) => a.score - b.score);
    const min = key => asc.find(x => x.session.key === key) || null;
    return {
      best: asc.slice(0, 3),
      worst: [...asc].reverse().slice(0, 3),
      bestDay: min('day'),
      bestNight: min('night'),
    };
  }

  /** 안전요원 집중 배치 추천 — 사고 절대건수 기준 상위 시간대 */
  function staffing(m, w) {
    const p = dayProfile(m, w);
    const total = p.reduce((s, x) => s + x.accidents, 0);
    return [...p].sort((a, b) => b.accidents - a.accidents).slice(0, 5)
      .map((x, i) => ({
        rank: i + 1, hour: x.hour, accidents: x.accidents,
        score: x.score, level: x.level,
        cover: +(x.accidents / total * 100).toFixed(1),
        crew: x.score >= T2 ? 3 : x.score >= T1 ? 2 : 1,   // 배치 등급(상대 가중)
      }));
  }

  // ---- 포맷 ----
  const pad = n => String(n).padStart(2, '0');
  const hhmm = h => `${pad(h)}:00`;
  const hrange = h => `${pad(h)}:00–${pad(h + 1)}:00`;
  const num = n => n.toLocaleString('ko-KR');

  // ---- 파생 요약치 ----
  const peakHour = D.hourly.reduce((a, b) => b.accidents > a.accidents ? b : a);
  const topRateMonth = D.months.reduce((a, b) => b.rate > a.rate ? b : a);
  const busiestDow = D.dow.reduce((a, b) => b.factor > a.factor ? b : a);
  const dayShare = D.hourly.filter(h => h.hour <= 16).reduce((s, h) => s + h.accidents, 0);
  const nightShare = D.hourly.filter(h => h.hour >= 18).reduce((s, h) => s + h.accidents, 0);

  return {
    D, HOURS, MONTHS, DOW_KO, LEVELS, T1, T2, riskMaxLabel,
    base, accByHour, monthCrowdF, monthRateF, monthInfo, dowF,
    crowdIndex, risk, level, session, dayProfile, recommend, staffing,
    hhmm, hrange, num, pad,
    summary: {
      peakHour, topRateMonth, busiestDow, dayShare, nightShare,
      totalAccidents: D.meta.totalAccidents,
      totalLift: D.meta.totalLift,
      openDays: D.meta.openDays,
      meanDaily: D.meta.meanDaily,
      /** 3월 사고율이 1월 대비 몇 % 높은가 */
      marchVsJan: +(((monthInfo[3].rate / monthInfo[1].rate) - 1) * 100).toFixed(0),
      satVsMidweek: +(D.dow[5].mean / ((D.dow[1].mean + D.dow[2].mean + D.dow[3].mean) / 3)).toFixed(2),
    },
  };
})();
