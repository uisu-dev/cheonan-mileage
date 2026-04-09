const { getSupabase, cors } = require('../lib/supabase');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  const { action } = req.body;
  const supabase = getSupabase();

  if (action === 'create') {
    const { teacherId, name } = req.body;
    await supabase.from('clubs').insert({
      id: 'C' + Date.now(), teacher_id: teacherId, name, members: []
    });
    return res.json({ success: true, msg: '생성 완료' });
  }

  if (action === 'updateMembers') {
    const { clubId, members } = req.body;
    await supabase.from('clubs').update({ members }).eq('id', clubId);
    return res.json({ success: true, msg: '저장 완료' });
  }

  if (action === 'saveAttendance') {
    const { clubId, date, data } = req.body;
    await supabase.from('club_logs').insert({
      club_id: clubId, date, data: typeof data === 'string' ? JSON.parse(data) : data
    });
    return res.json({ success: true, msg: '저장 완료' });
  }

  if (action === 'updateAttendance') {
    const { rowIndex, data } = req.body;
    await supabase.from('club_logs')
      .update({ data: typeof data === 'string' ? JSON.parse(data) : data })
      .eq('id', Number(rowIndex));
    return res.json({ success: true, msg: '출석 기록이 수정되었습니다.' });
  }

  return res.json({ success: false, msg: '알 수 없는 action' });
};
