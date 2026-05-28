const { getSupabase, cors, formatDate } = require('../lib/supabase');

const MAX_FILE_BYTES = 3 * 1024 * 1024; // 3MB (base64 인코딩 후 Vercel 4.5MB 한도 내 안전)

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  const { action } = req.body;
  const supabase = getSupabase();

  if (action === 'list') {
    const { studentId } = req.body;
    if (!studentId) return res.json({ success: false, msg: '학생 ID 누락' });
    const { data, error } = await supabase.from('counseling_logs')
      .select('*').eq('student_id', String(studentId))
      .order('counsel_date', { ascending: false }).limit(100);
    if (error) return res.json({ success: false, msg: error.message });
    return res.json({
      success: true,
      records: (data || []).map(r => ({
        id: r.id,
        teacherName: r.teacher_name || '',
        counselDate: r.counsel_date,
        counselDateStr: formatCounselDate(r.counsel_date),
        counselType: r.counsel_type || '일반 상담',
        content: r.content || '',
        fileUrl: r.file_url || '',
        fileName: r.file_name || ''
      }))
    });
  }

  if (action === 'create') {
    const { studentId, teacherName, counselDate, counselType, content, fileData } = req.body;
    if (!studentId || !counselDate || !content) {
      return res.json({ success: false, msg: '상담일시·내용은 필수입니다.' });
    }

    // 파일 업로드 (선택)
    let fileUrl = '';
    let savedFileName = '';
    if (fileData && fileData.data) {
      try {
        const buffer = Buffer.from(fileData.data, 'base64');
        if (buffer.length > MAX_FILE_BYTES) {
          return res.json({ success: false, msg: '첨부파일은 최대 3MB까지 업로드 가능합니다.' });
        }
        const rawName = fileData.fileName || 'file';
        const ext = String(rawName).split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'pdf';
        savedFileName = `counsel_${studentId}_${Date.now()}.${ext}`;
        const { data: up, error: upErr } = await supabase.storage
          .from('counseling-files').upload(savedFileName, buffer, {
            contentType: fileData.mimeType || 'application/octet-stream', upsert: false
          });
        if (!upErr && up) {
          const { data: urlData } = supabase.storage.from('counseling-files').getPublicUrl(savedFileName);
          fileUrl = urlData.publicUrl;
        } else if (upErr) {
          return res.json({ success: false, msg: '파일 업로드 실패: ' + upErr.message });
        }
      } catch (e) {
        return res.json({ success: false, msg: '파일 처리 오류: ' + e.message });
      }
    }

    const { error } = await supabase.from('counseling_logs').insert({
      student_id: String(studentId),
      teacher_name: teacherName || '',
      counsel_date: counselDate,
      counsel_type: counselType || '일반 상담',
      content: content.trim(),
      file_url: fileUrl,
      file_name: fileData ? (fileData.fileName || '') : ''
    });
    if (error) return res.json({ success: false, msg: '등록 실패: ' + error.message });
    return res.json({ success: true, msg: '상담 기록이 저장되었습니다.' });
  }

  if (action === 'delete') {
    const { id } = req.body;
    // 파일도 함께 정리
    const { data: row } = await supabase.from('counseling_logs').select('*').eq('id', id).single();
    if (row && row.file_url) {
      const idx = row.file_url.indexOf('/counseling-files/');
      if (idx !== -1) {
        const path = row.file_url.substring(idx + '/counseling-files/'.length);
        try { await supabase.storage.from('counseling-files').remove([decodeURIComponent(path)]); } catch (e) {}
      }
    }
    await supabase.from('counseling_logs').delete().eq('id', id);
    return res.json({ success: true, msg: '삭제되었습니다.' });
  }

  return res.json({ success: false, msg: '알 수 없는 action' });
};

function formatCounselDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${dd} ${hh}:${mm}`;
}
