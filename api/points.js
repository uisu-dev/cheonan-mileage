const { getSupabase, cors, formatDate } = require('../lib/supabase');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  const { action } = req.body;
  const supabase = getSupabase();

  if (action === 'give') {
    const { teacher, ids, itemName, point } = req.body;

    // 1. 해당 학생들 정보 한번에 조회 (penalty 포함)
    const { data: users } = await supabase.from('users')
      .select('id, points, penalty_total, penalty_earned')
      .in('id', ids.map(id => String(id).trim()));
    if (!users || users.length === 0) return res.json({ success: true, msg: '0명 완료' });

    // 2. 로그 일괄 삽입
    const logRows = users.map(u => ({ teacher, student_id: u.id, item: itemName, point: Number(point) }));
    await supabase.from('logs').insert(logRows);

    // 3. 점수 + 징계 진행도 업데이트 병렬 처리
    const pt = Number(point);
    await Promise.all(users.map(u => {
      const newPoints = (Number(u.points) || 0) + pt;
      const upd = { points: newPoints };
      // 양수 점수이고 징계 진행 중이면 진행도 증가
      const pTotal = Number(u.penalty_total) || 0;
      const pEarned = Number(u.penalty_earned) || 0;
      if (pt > 0 && pTotal > 0) {
        const newEarned = pEarned + pt;
        if (newEarned >= pTotal) {
          // 해제
          upd.penalty_total = 0;
          upd.penalty_earned = 0;
        } else {
          upd.penalty_earned = newEarned;
        }
      }
      return supabase.from('users').update(upd).eq('id', u.id);
    }));

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

  // 교내봉사 징계 설정
  if (action === 'setPenalty') {
    const { teacher, studentId, amount, reason } = req.body;
    const total = Math.abs(Number(amount) || 0);
    if (total <= 0) return res.json({ success: false, msg: '유효한 점수 입력 필요' });
    const sid = String(studentId).trim();
    const { error } = await supabase.from('users')
      .update({ penalty_total: total, penalty_earned: 0 }).eq('id', sid);
    if (error) return res.json({ success: false, msg: error.message });
    await supabase.from('logs').insert({
      teacher: teacher || 'System', student_id: sid,
      item: '🚨 교내봉사 징계 설정: -' + total + 'P' + (reason ? ' (' + reason + ')' : ''),
      point: 0
    });
    return res.json({ success: true, msg: '징계 설정 완료' });
  }

  // 교내봉사 징계 해제
  if (action === 'clearPenalty') {
    const { teacher, studentId } = req.body;
    const sid = String(studentId).trim();
    await supabase.from('users').update({ penalty_total: 0, penalty_earned: 0 }).eq('id', sid);
    await supabase.from('logs').insert({
      teacher: teacher || 'System', student_id: sid, item: '🚨 교내봉사 징계 수동 해제', point: 0
    });
    return res.json({ success: true, msg: '해제 완료' });
  }

  return res.json({ success: false, msg: '알 수 없는 action' });
};
