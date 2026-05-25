const { getSupabase, cors } = require('../lib/supabase');

const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100MB

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  const { action } = req.body;
  const supabase = getSupabase();

  if (action === 'create') {
    const { title, questions, allowPhoto, allowVideo } = req.body;
    const row = { id: String(Date.now()), title, questions, status: 'O', allow_photo: !!allowPhoto, allow_video: !!allowVideo };

    let { error } = await supabase.from('surveys').insert(row);
    // 컬럼이 없는 경우 단계적 fallback
    if (error && String(error.message || '').toLowerCase().includes('allow_video')) {
      delete row.allow_video;
      const r2 = await supabase.from('surveys').insert(row);
      error = r2.error;
    }
    if (error && String(error.message || '').toLowerCase().includes('allow_photo')) {
      delete row.allow_photo;
      const r3 = await supabase.from('surveys').insert(row);
      error = r3.error;
    }
    if (error) return res.json({ success: false, msg: '등록 실패: ' + error.message });
    return res.json({ success: true, msg: '등록' });
  }

  // 영상 직접 업로드용 정보 발급 (학생 클라이언트가 Storage에 PUT)
  if (action === 'getVideoUploadInfo') {
    const { studentId, surveyId, fileName, fileSize } = req.body;
    if (!studentId || !surveyId) return res.json({ success: false, msg: '정보 누락' });
    if (Number(fileSize) > MAX_VIDEO_BYTES) {
      return res.json({ success: false, msg: '영상은 최대 100MB까지 업로드 가능합니다.' });
    }
    const supaUrl = process.env.SUPABASE_URL || '';
    const anonKey = process.env.SUPABASE_ANON_KEY || '';
    if (!supaUrl || !anonKey) {
      return res.json({ success: false, msg: '서버 설정 오류 (SUPABASE_ANON_KEY 필요)' });
    }
    const ext = String(fileName || 'mp4').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'mp4';
    const path = `videos/survey_${surveyId}_${studentId}_${Date.now()}.${ext}`;
    return res.json({
      success: true,
      uploadUrl: `${supaUrl}/storage/v1/object/survey-photos/${encodeURIComponent(path)}`,
      anonKey: anonKey,
      path: path
    });
  }

  if (action === 'vote') {
    const { studentId, surveyId, answers, fileData, videoPath } = req.body;

    // 중복 체크
    const { data: existing } = await supabase
      .from('survey_logs').select('id')
      .eq('vote_id', surveyId)
      .eq('student_id', studentId);

    if (existing && existing.length > 0) {
      return res.json({ success: false, msg: '이미 참여함' });
    }

    // 사진 업로드 (작은 이미지는 서버 경유로 그대로 진행)
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

    // 영상은 클라이언트가 이미 직접 업로드함 → 경로만 받아서 publicUrl 생성
    let videoUrl = '';
    if (videoPath) {
      const { data: urlData } = supabase.storage.from('survey-photos').getPublicUrl(videoPath);
      videoUrl = urlData.publicUrl;
    }

    const logRow = { vote_id: surveyId, student_id: studentId, answer: answers, photo_url: photoUrl, video_url: videoUrl };
    let { error: logErr } = await supabase.from('survey_logs').insert(logRow);
    // 컬럼 단계적 fallback
    if (logErr && String(logErr.message || '').toLowerCase().includes('video_url')) {
      delete logRow.video_url;
      const r2 = await supabase.from('survey_logs').insert(logRow);
      logErr = r2.error;
    }
    if (logErr && String(logErr.message || '').toLowerCase().includes('photo_url')) {
      delete logRow.photo_url;
      await supabase.from('survey_logs').insert(logRow);
    }

    // +100P (단, 징계 중인 학생은 점수 미반영)
    const { data: user } = await supabase.from('users').select('points, penalty_total').eq('id', studentId).single();
    if (user) {
      const onPenalty = Number(user.penalty_total) > 0;
      if (onPenalty) {
        await supabase.from('logs').insert({ teacher: 'System', student_id: studentId, item: '설문 참여 (징계 중 점수 미반영)', point: 0 });
        return res.json({ success: true, msg: '참여 완료 (징계 중이므로 점수는 지급되지 않습니다)' });
      }
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

  if (action === 'close') {
    const { id } = req.body;
    await supabase.from('surveys').update({ status: 'C' }).eq('id', id);
    return res.json({ success: true, msg: '마감되었습니다. 학생 화면에서 숨겨집니다.' });
  }

  if (action === 'reopen') {
    const { id } = req.body;
    await supabase.from('surveys').update({ status: 'O' }).eq('id', id);
    return res.json({ success: true, msg: '다시 공개되었습니다.' });
  }

  return res.json({ success: false, msg: '알 수 없는 action' });
};
