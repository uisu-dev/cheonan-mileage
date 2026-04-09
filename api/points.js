const { getSupabase, cors, formatDate } = require('../lib/supabase');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  const { action } = req.body;
  const supabase = getSupabase();

  if (action === 'give') {
    const { teacher, ids, itemName, point } = req.body;

    // 1. 해당 학생들 정보 한번에 조회
    const { data: users } = await supabase.from('users').select('id, points').in('id', ids.map(id => String(id).trim()));
    if (!users || users.length === 0) return res.json({ success: true, msg: '0명 완료' });

    // 2. 로그 일괄 삽입
    const logRows = users.map(u => ({ teacher, student_id: u.id, item: itemName, point: Number(point) }));
    await supabase.from('logs').insert(logRows);

    // 3. 점수 업데이트 병렬 처리
    await Promise.all(users.map(u =>
      supabase.from('users').update({ points: (Number(u.points) || 0) + Number(point) }).eq('id', u.id)
    ));

    return res.json({ success: true, msg: users.length + '명 완료' });
  }

  if (action === 'delete') {
    const { rowId, studentId, point } = req.body;
    try {
      await supabase.from('logs').delete().eq('id', Number(rowId));
      const { data: user } = await supabase.from('users').select('points').eq('id', String(studentId).trim()).single();
      if (user) {
        await supabase.from('users').update({ points: (Number(user.points) || 0) - Number(point) }).eq('id', String(studentId).trim());
      }
      return res.json({ success: true, msg: '삭제/회수 완료' });
    } catch (e) {
      return res.json({ success: false, msg: e.message });
    }
  }

  if (action === 'studentLogs') {
    const { studentId } = req.body;
    const { data: logs } = await supabase.from('logs').select('*')
      .eq('student_id', String(studentId).trim()).order('id', { ascending: false }).limit(50);
    return res.json((logs || []).map(l => ({ date: formatDate(l.date), item: l.item, point: Number(l.point) })));
  }

  if (action === 'redeem') {
    const { teacher, studentId, rewardName, cost } = req.body;
    const { data: user } = await supabase.from('users').select('points').eq('id', String(studentId).trim()).single();
    if (!user) return res.json({ success: false, msg: '학생 없음' });
    if ((Number(user.points) || 0) < cost) return res.json({ success: false, msg: '포인트 부족' });
    await supabase.from('users').update({ points: Number(user.points) - cost }).eq('id', String(studentId).trim());
    await supabase.from('logs').insert({ teacher, student_id: studentId, item: '교환: ' + rewardName, point: -cost });
    return res.json({ success: true, msg: '교환 완료' });
  }

  return res.json({ success: false, msg: '알 수 없는 action' });
};
