const { getSupabase, cors } = require('../lib/supabase');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  const { action } = req.body;
  const supabase = getSupabase();

  if (action === 'create') {
    const { title, questions, allowPhoto } = req.body;
    const row = { id: String(Date.now()), title, questions, status: 'O', allow_photo: !!allowPhoto };
    let { error } = await supabase.from('surveys').insert(row);
    // allow_photo 컬럼이 없으면 fallback
    if (error && String(error.message || '').toLowerCase().includes('allow_photo')) {
      delete row.allow_photo;
      const r2 = await supabase.from('surveys').insert(row);
      error = r2.error;
    }
    if (error) return res.json({ success: false, msg: '등록 실패: ' + error.message });
    return res.json({ success: true, msg: '등록' });
  }

  if (action === 'vote') {
    const { studentId, surveyId, answers, fileData } = req.body;

    // 중복 체크
    const { data: existing } = await supabase
      .from('survey_logs').select('id')
      .eq('vote_id', surveyId)
      .eq('student_id', studentId);

    if (existing && existing.length > 0) {
      return res.json({ success: false, msg: '이미 참여함' });
    }

    // 사진 업로드 (있는 경우)
    let photoUrl = '';
    if (fileData && fileData.data) {
      try {
        const buffer = Buffer.from(fileData.data, 'base64');
        const ext = (fileData.mimeType && fileData.mimeType.includes('png')) ? 'png' : 'jpg';
        const fileName = `survey_${surveyId}_${studentId}_${Date.now()}.${ext}`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('survey-photos').upload(fileName, buffer, {
            contentType: fileData.mimeType || 'image/jpeg', upsert: false
          });
        if (!uploadError && uploadData) {
          const { data: urlData } = supabase.storage.from('survey-photos').getPublicUrl(fileName);
          photoUrl = urlData.publicUrl;
        }
      } catch (e) {
        console.error('photo upload error:', e);
      }
    }

    const logRow = { vote_id: surveyId, student_id: studentId, answer: answers, photo_url: photoUrl };
    let { error: logErr } = await supabase.from('survey_logs').insert(logRow);
    if (logErr && String(logErr.message || '').toLowerCase().includes('photo_url')) {
      delete logRow.photo_url;
      await supabase.from('survey_logs').insert(logRow);
    }

    // +100P
    const { data: user } = await supabase.from('users').select('points').eq('id', studentId).single();
    if (user) {
      await supabase.from('users').update({ points: Number(user.points) + 100 }).eq('id', studentId);
      await supabase.from('logs').insert({ teacher: 'System', student_id: studentId, item: '설문 참여', point: 100 });
    }
    return res.json({ success: true, msg: '완료' });
  }

  if (action === 'delete') {
    const { id } = req.body;
    await supabase.from('surveys').delete().eq('id', id);
    return res.json({ success: true, msg: '삭제되었습니다.' });
  }

  return res.json({ success: false, msg: '알 수 없는 action' });
};
