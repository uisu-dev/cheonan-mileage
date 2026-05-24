const { getSupabase, cors, formatDate } = require('../lib/supabase');

const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100MB

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  const { action } = req.body;
  const supabase = getSupabase();

  // 클라이언트가 직접 업로드할 수 있도록 공개 설정 + 경로 미리 발급
  if (action === 'getUploadInfo') {
    const { studentId, fileName, fileSize } = req.body;
    if (!studentId) return res.json({ success: false, msg: '학생 정보 누락' });
    if (Number(fileSize) > MAX_FILE_BYTES) {
      return res.json({
        success: false,
        msg: `파일 크기가 너무 큽니다. 최대 ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB까지 업로드 가능합니다.`
      });
    }
    const supaUrl = process.env.SUPABASE_URL || '';
    const anonKey = process.env.SUPABASE_ANON_KEY || '';
    if (!supaUrl || !anonKey) {
      return res.json({ success: false, msg: '서버 설정 오류 (SUPABASE_ANON_KEY 환경변수 필요)' });
    }
    const ext = String(fileName || 'mp4').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'mp4';
    const path = `videos/${studentId}_${Date.now()}.${ext}`;
    return res.json({
      success: true,
      uploadUrl: `${supaUrl}/storage/v1/object/submissions/${encodeURIComponent(path)}`,
      anonKey: anonKey,
      path: path
    });
  }

  // 업로드 완료 후 메타데이터 등록 + 50P 지급
  if (action === 'register') {
    const { studentId, studentName, title, path, fileName, fileSize } = req.body;
    if (!studentId || !path) return res.json({ success: false, msg: '정보 누락' });

    const { data: urlData } = supabase.storage.from('submissions').getPublicUrl(path);
    const videoUrl = urlData.publicUrl;

    const { error } = await supabase.from('submissions').insert({
      student_id: String(studentId),
      student_name: studentName || '',
      title: (title || '').trim(),
      video_url: videoUrl,
      file_name: fileName || '',
      file_size: Number(fileSize) || 0
    });
    if (error) return res.json({ success: false, msg: '응모 등록 실패: ' + error.message });

    // 50P 지급 (징계 시 미지급)
    const { data: user } = await supabase.from('users')
      .select('points, penalty_total').eq('id', String(studentId)).single();
    if (!user) return res.json({ success: true, msg: '응모 완료! (점수 적립 실패: 학생 정보 없음)' });

    const onPenalty = Number(user.penalty_total) > 0;
    if (onPenalty) {
      await supabase.from('logs').insert({
        teacher: 'System', student_id: studentId,
        item: '영상 응모 (징계 중 점수 미반영)', point: 0
      });
      return res.json({ success: true, msg: '영상 응모 완료!\n(징계 중이라 점수는 지급되지 않습니다)' });
    }

    await supabase.from('users')
      .update({ points: Number(user.points) + 50 })
      .eq('id', String(studentId));
    await supabase.from('logs').insert({
      teacher: 'System', student_id: studentId,
      item: '영상 응모', point: 50
    });
    return res.json({ success: true, msg: '영상 응모 완료!\n+50P가 적립되었습니다 🎉' });
  }

  // 교사: 응모 영상 목록
  if (action === 'list') {
    const { data } = await supabase.from('submissions')
      .select('*').order('id', { ascending: false }).limit(200);
    return res.json({
      success: true,
      submissions: (data || []).map(s => ({
        id: s.id,
        studentId: s.student_id,
        studentName: s.student_name,
        title: s.title || '',
        videoUrl: s.video_url,
        fileName: s.file_name || '',
        fileSize: Number(s.file_size) || 0,
        date: formatDate(s.created_at)
      }))
    });
  }

  // 교사: 응모 영상 삭제 (Storage 파일도 함께)
  if (action === 'delete') {
    const { id } = req.body;
    const { data: row } = await supabase.from('submissions').select('*').eq('id', id).single();
    if (row && row.video_url) {
      const idx = row.video_url.indexOf('/submissions/');
      if (idx !== -1) {
        const path = row.video_url.substring(idx + '/submissions/'.length);
        try { await supabase.storage.from('submissions').remove([decodeURIComponent(path)]); } catch (e) {}
      }
    }
    await supabase.from('submissions').delete().eq('id', id);
    return res.json({ success: true, msg: '삭제되었습니다.' });
  }

  return res.json({ success: false, msg: '알 수 없는 action' });
};
