// 천안중학교 NEIS 급식/시간표 조회 (충청남도교육청 N10 / 학교 8151023 - 단일 학교 고정)
const NEIS_ATPT = 'N10';
const NEIS_SCHOOL = '8151023';

function neisToday() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10).replace(/-/g, '');
}

// YYYYMMDD 형식만 허용 (없으면 오늘)
function normYmd(ymd) {
  const s = String(ymd || '').replace(/[^0-9]/g, '');
  return /^\d{8}$/.test(s) ? s : neisToday();
}

async function getNeisLunch(ymd) {
  const d = normYmd(ymd);
  const key = process.env.NEIS_API_KEY || '';
  const url = `https://open.neis.go.kr/hub/mealServiceDietInfo?Type=json&pIndex=1&pSize=10&ATPT_OFCDC_SC_CODE=${NEIS_ATPT}&SD_SCHUL_CODE=${NEIS_SCHOOL}&MLSV_YMD=${d}${key ? '&KEY=' + key : ''}`;
  const resp = await fetch(url);
  const json = await resp.json();
  if (json.mealServiceDietInfo) {
    return json.mealServiceDietInfo[1].row[0].DDISH_NM
      .replace(/<br\/>/g, ', ')
      .replace(/[0-9.]/g, '')
      .replace(/\(\)/g, '');
  }
  return '급식 없음';
}

async function getNeisTimetable(ymd, grade, classNm) {
  const d = normYmd(ymd);
  const key = process.env.NEIS_API_KEY || '';
  const url = `https://open.neis.go.kr/hub/misTimetable?Type=json&pIndex=1&pSize=30&ATPT_OFCDC_SC_CODE=${NEIS_ATPT}&SD_SCHUL_CODE=${NEIS_SCHOOL}&ALL_TI_YMD=${d}&GRADE=${grade}&CLASS_NM=${classNm}${key ? '&KEY=' + key : ''}`;
  const resp = await fetch(url);
  const json = await resp.json();
  if (json.misTimetable) {
    return json.misTimetable[1].row
      .map(r => ({ period: Number(r.PERIO) || 0, subject: String(r.ITRT_CNTNT || '').trim() }))
      .filter(x => x.subject)
      .sort((a, b) => a.period - b.period);
  }
  return [];
}

module.exports = { neisToday, getNeisLunch, getNeisTimetable };
