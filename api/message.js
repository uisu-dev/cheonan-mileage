const { getSupabase, cors, formatDate } = require('../lib/supabase');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  const { action } = req.body;
  const supabase = getSupabase();

  if (action === 'send') {
    const { senderId, senderName, teacherId, teacherName, content } = req.body;
    if (!senderId || !teacherId || !content || !content.trim()) {
      return res.json({ success: false, msg: '입력 누락' });
    }
    const trimmed = content.trim();

    // 같은 선생님께 이미 메시지를 보낸 적 있는지 확인 (적립 1회 제한)
    const { count: existingCount } = await supabase.from('teacher_messages')
      .select('id', { count: 'exact', head: true })
      .eq('sender_id', String(senderId))
      .eq('teacher_id', String(teacherId));

    // 메시지 저장
    const { error } = await supabase.from('teacher_messages').insert({
      sender_id: String(senderId), sender_name: senderName || '',
      teacher_id: String(teacherId), teacher_name: teacherName || '',
      content: trimmed, is_read: false
    });
    if (error) return res.json({ success: false, msg: '전송 실패: ' + error.message });

    // 적립 조건: 30자 이상 + 해당 선생님께 최초 메시지
    let rewardMsg = '';
    if (trimmed.length >= 30 && (existingCount || 0) === 0) {
      const { data: user } = await supabase.from('users')
        .select('points, penalty_total').eq('id', String(senderId)).single();
      if (user) {
        const onPenalty = Number(user.penalty_total) > 0;
        if (onPenalty) {
          await supabase.from('logs').insert({
            teacher: 'System', student_id: senderId,
            item: `감사 메시지 (${teacherName || ''}) (징계 중 점수 미반영)`, point: 0
          });
          rewardMsg = '\n(징계 중이므로 점수는 지급되지 않습니다.)';
        } else {
          await supabase.from('users')
            .update({ points: (Number(user.points) || 0) + 20 })
            .eq('id', String(senderId));
          await supabase.from('logs').insert({
            teacher: 'System', student_id: senderId,
            item: `감사 메시지 (${teacherName || ''})`, point: 20
          });
          rewardMsg = '\n+20P가 적립되었습니다! 🎉';
        }
      }
    } else if (trimmed.length >= 30 && (existingCount || 0) > 0) {
      rewardMsg = '\n(이 선생님께는 이미 점수를 받으셨어요. 마음만 전달됩니다 😊)';
    } else if (trimmed.length < 30) {
      rewardMsg = '\n(30자 이상 작성 시 +20P 적립되는데, 이번엔 적립되지 않았어요.)';
    }

    return res.json({ success: true, msg: '감사 메시지가 전달되었습니다 💌' + rewardMsg });
  }

  if (action === 'list') {
    const { teacherId } = req.body;
    const { data } = await supabase.from('teacher_messages')
      .select('*').eq('teacher_id', String(teacherId))
      .order('id', { ascending: false }).limit(200);
    return res.json({
      success: true,
      messages: (data || []).map(m => ({
        id: m.id, senderId: m.sender_id, senderName: m.sender_name,
        content: m.content, isRead: !!m.is_read,
        date: formatDate(m.created_at)
      }))
    });
  }

  if (action === 'markAllRead') {
    const { teacherId } = req.body;
    await supabase.from('teacher_messages')
      .update({ is_read: true }).eq('teacher_id', String(teacherId)).eq('is_read', false);
    return res.json({ success: true });
  }

  if (action === 'delete') {
    const { id } = req.body;
    await supabase.from('teacher_messages').delete().eq('id', id);
    return res.json({ success: true, msg: '삭제되었습니다.' });
  }

  return res.json({ success: false, msg: '알 수 없는 action' });
};
