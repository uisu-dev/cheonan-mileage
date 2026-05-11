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
    const { error } = await supabase.from('teacher_messages').insert({
      sender_id: String(senderId), sender_name: senderName || '',
      teacher_id: String(teacherId), teacher_name: teacherName || '',
      content: content.trim(), is_read: false
    });
    if (error) return res.json({ success: false, msg: '전송 실패: ' + error.message });
    return res.json({ success: true, msg: '감사의 메시지가 전달되었습니다 💌' });
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
