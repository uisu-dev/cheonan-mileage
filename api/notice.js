const { getSupabase, cors } = require('../lib/supabase');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  const { action } = req.body;
  const supabase = getSupabase();

  if (action === 'create') {
    const { teacher, title, content } = req.body;
    if (!content || !content.trim()) return res.json({ success: false, msg: '내용을 입력하세요' });
    const { error } = await supabase.from('announcements').insert({
      teacher: teacher || '', title: title || '', content: content.trim(), status: 'O'
    });
    if (error) return res.json({ success: false, msg: '등록 실패: ' + error.message });
    return res.json({ success: true, msg: '공지사항이 등록되었습니다.' });
  }

  if (action === 'update') {
    const { id, title, content } = req.body;
    if (!content || !content.trim()) return res.json({ success: false, msg: '내용을 입력하세요' });
    const { error } = await supabase.from('announcements')
      .update({ title: title || '', content: content.trim() }).eq('id', id);
    if (error) return res.json({ success: false, msg: '수정 실패: ' + error.message });
    return res.json({ success: true, msg: '수정되었습니다.' });
  }

  if (action === 'close') {
    const { id } = req.body;
    const { error } = await supabase.from('announcements').update({ status: 'C' }).eq('id', id);
    if (error) return res.json({ success: false, msg: error.message });
    return res.json({ success: true, msg: '학생 화면에서 숨겨졌습니다.' });
  }

  if (action === 'reopen') {
    const { id } = req.body;
    await supabase.from('announcements').update({ status: 'O' }).eq('id', id);
    return res.json({ success: true, msg: '다시 게시되었습니다.' });
  }

  if (action === 'delete') {
    const { id } = req.body;
    await supabase.from('announcements').delete().eq('id', id);
    return res.json({ success: true, msg: '삭제되었습니다.' });
  }

  return res.json({ success: false, msg: '알 수 없는 action' });
};
