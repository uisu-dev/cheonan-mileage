// 학급 출석부 (교시별) API — 교사/관리자 전용
// actions: load(시간표+명단+기록), getMarks(기록만), saveMarks(교시별 저장), applyStudent(한 학생 다교시 일괄)
const { getSupabase, cors } = require('../lib/supabase');
const { getNeisTimetable } = require('../lib/neis');
const PA = require('../lib/period-attendance');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false });
  try {
    const out = await PA.handle(req.body || {}, { supabase: getSupabase(), getNeisTimetable });
    return res.json(out);
  } catch (e) {
    return res.json({ success: false, msg: '서버 오류: ' + (e && e.message ? e.message : e) });
  }
};
