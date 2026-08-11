# -*- coding: utf-8 -*-
"""
강원랜드 공공데이터 3종 원본 CSV -> 프론트엔드용 dataset.json / dataset.js 생성

사용법
    python tools/build_data.py [원본_디렉터리]

원본_디렉터리를 생략하면 tools/raw/ 를 사용한다. 아래 파일이 있어야 한다
 (공공데이터포털에서 받은 파일명 그대로 두면 되고, 인코딩은 CP949/UTF-8 모두 처리한다):

    *시간대별 사고*.csv          강원랜드 스키장 시간대별 사고 발생 현황
    *리프트권 발매현황*.csv       하이원 스키장 리프트권 발매현황
    *기상자료*.csv (여러 해)      하이원리조트 계절기상 정보 (zip 을 풀어 둘 것)
"""
import csv, glob, os, io, sys, json, collections, datetime, statistics

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'raw')
OUT = os.path.join(ROOT, 'data', 'dataset.json')

MONTHS = [12, 1, 2, 3]      # 시즌 순서 (12월 -> 3월)
HOURS = list(range(9, 23))  # 운영 시간대


def read_text(path):
    raw = open(path, 'rb').read()
    for enc in ('utf-8-sig', 'cp949', 'utf-8'):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    raise SystemExit(f'인코딩을 판별할 수 없습니다: {path}')


def rows(path):
    return list(csv.DictReader(io.StringIO(read_text(path))))


def find_one(pattern):
    hits = glob.glob(os.path.join(RAW, pattern))
    if not hits:
        raise SystemExit(f'원본 파일을 찾을 수 없습니다: {RAW}/{pattern}')
    return hits[0]


def find_many(pattern):
    hits = sorted(glob.glob(os.path.join(RAW, pattern)))
    if not hits:
        raise SystemExit(f'원본 파일을 찾을 수 없습니다: {RAW}/{pattern}')
    return hits


# ------------------------------------------------------------------ 1. 사고
acc_rows = rows(find_one('*시간대별 사고*.csv'))
hour_total = collections.Counter()
month_total = collections.Counter()
hm = {m: collections.Counter() for m in MONTHS}
for r in acc_rows:
    mo, hr, n = int(r['월']), int(r['사고시각']), int(r['사고건수'])
    hour_total[hr] += n
    month_total[mo] += n
    hm[mo][hr] += n
total_acc = sum(hour_total.values())

# ------------------------------------------------------------------ 2. 리프트권
lift_rows = rows(find_one('*리프트권 발매현황*.csv'))
daily_lift = collections.Counter()      # 일일권(영업장 '리프트') = 방문 프록시
daily_season = collections.Counter()    # 시즌티켓 = 사전 판매라 방문과 무관
prod_total = collections.Counter()
for r in lift_rows:
    d, q = r['영업일자'], int(r['판매수량'])
    if r['영업장명'] == '리프트':
        daily_lift[d] += q
        prod_total[r['상품명']] += q
    else:
        daily_season[d] += q

days = sorted(daily_lift)
daily = []
for d in days:
    dt = datetime.date.fromisoformat(d)
    daily.append({'date': d, 'month': dt.month, 'dow': dt.weekday(),
                  'lift': daily_lift[d], 'season': daily_season.get(d, 0)})

overall_mean = statistics.mean(r['lift'] for r in daily)

dow_vals = collections.defaultdict(list)
for r in daily:
    dow_vals[r['dow']].append(r['lift'])
dow_stat = []
for w in range(7):
    v = dow_vals.get(w, [])
    mean = statistics.mean(v) if v else 0
    dow_stat.append({'dow': w, 'mean': round(mean, 1), 'days': len(v),
                     'factor': round(mean / overall_mean, 3) if overall_mean else 1})

month_lift = collections.Counter()
month_days = collections.Counter()
for r in daily:
    month_lift[r['month']] += r['lift']
    month_days[r['month']] += 1

month_stat = []
for m in MONTHS:
    lf, ac, dc = month_lift.get(m, 0), month_total.get(m, 0), month_days.get(m, 0)
    mean_day = lf / dc if dc else 0
    month_stat.append({
        'month': m, 'accidents': ac, 'lift': lf, 'days': dc,
        'meanDaily': round(mean_day, 1),
        'rate': round(ac / lf * 1000, 3) if lf else 0,      # 리프트권 1,000매당 사고
        'factor': round(mean_day / overall_mean, 3) if overall_mean else 1,
    })

# ------------------------------------------------------------------ 3. 기상
wx = []
for p in find_many('*기상자료*.csv'):
    for r in rows(p):
        try:
            wx.append({'date': r['날짜'], 'loc': r['측정위치'],
                       'tavg': float(r['평균온도']), 'tmin': float(r['최소온도']),
                       'tmax': float(r['최고온도']), 'wind': float(r['평균풍속']),
                       'gust': float(r['최고풍속']), 'hum': float(r['평균습도']),
                       'rain': float(r['강수량'])})
        except (ValueError, KeyError):
            continue

wx_month = collections.defaultdict(list)
for r in wx:
    wx_month[int(r['date'][5:7])].append(r)

weather_stat = []
for m in MONTHS:
    v = wx_month.get(m, [])
    if not v:
        continue
    weather_stat.append({
        'month': m, 'n': len(v),
        'tavg': round(statistics.mean(x['tavg'] for x in v), 1),
        'tmin': round(statistics.mean(x['tmin'] for x in v), 1),
        'tmax': round(statistics.mean(x['tmax'] for x in v), 1),
        'wind': round(statistics.mean(x['wind'] for x in v), 1),
        'gust': round(max(x['gust'] for x in v), 1),
        'hum': round(statistics.mean(x['hum'] for x in v), 1),
        'rainDays': sum(1 for x in v if x['rain'] > 0),
        'freezeDays': sum(1 for x in v if x['tmax'] < 0),   # 종일 영하 = 빙판 위험
    })

wx_years = sorted({r['date'][:4] for r in wx})
wx_locs = sorted({r['loc'] for r in wx})

# ------------------------------------------------------------------ 4. 시간대 지수
peak = max(hour_total.values())
hourly = [{
    'hour': h,
    'accidents': hour_total[h],
    'share': round(hour_total[h] / total_acc * 100, 2),
    'base': round(hour_total[h] / peak * 100, 1),           # 기본 위험점수 0~100
    'byMonth': {str(m): hm[m].get(h, 0) for m in MONTHS},
} for h in HOURS]

data = {
    'meta': {
        'generated': datetime.date.today().isoformat(),
        'sources': [
            {'name': '강원랜드 스키장 시간대별 사고 발생 현황', 'period': '2024',
             'rows': len(acc_rows), 'url': 'https://www.data.go.kr/data/15154035/fileData.do'},
            {'name': '강원랜드 하이원 스키장 리프트권 발매현황',
             'period': f'{days[0]} ~ {days[-1]} (영업일 {len(days)}일)',
             'rows': len(lift_rows), 'url': 'https://www.data.go.kr/data/15134076/fileData.do'},
            {'name': '강원랜드 하이원리조트 계절기상 정보',
             'period': f'{wx_years[0]} ~ {wx_years[-1]}',
             'rows': len(wx), 'url': 'https://www.data.go.kr/data/15054675/fileData.do'},
        ],
        'totalAccidents': total_acc,
        'totalLift': sum(daily_lift.values()),
        'totalSeason': sum(daily_season.values()),
        'openDays': len(days),
        'meanDaily': round(overall_mean, 1),
        'wxLocations': wx_locs,
    },
    'hourly': hourly,
    'months': month_stat,
    'dow': dow_stat,
    'daily': daily,
    'weather': weather_stat,
    'products': [{'name': k, 'qty': v} for k, v in prod_total.most_common(12)],
}

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=1)

# fetch 없이 file:// 에서도 로드되도록 JS 전역 버전도 함께 만든다
with open(OUT.replace('.json', '.js'), 'w', encoding='utf-8') as f:
    f.write('// 자동 생성 파일 — 직접 수정하지 말고 tools/build_data.py 를 실행하세요\nwindow.DATA = ')
    json.dump(data, f, ensure_ascii=False, indent=1)
    f.write(';\n')

print(f'사고 {total_acc}건 / 리프트권 {sum(daily_lift.values()):,}매 / 영업일 {len(days)}일')
print('생성:', OUT)
print('생성:', OUT.replace('.json', '.js'))
