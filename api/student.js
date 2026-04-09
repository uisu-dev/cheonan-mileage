const { getSupabase, cors } = require('../lib/supabase');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  const { action } = req.body;
  const supabase = getSupabase();

  if (action === 'attendance') {
    const { id } = req.body;
    const { data: user } = await supabase.from('users').select('points').eq('id', String(id).trim()).single();
    if (!user) return res.json({ success: false, msg: '학생 없음' });

    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const todayStr = kst.toISOString().slice(0, 10);

    const { data: todayLogs } = await supabase.from('logs').select('*')
      .eq('student_id', String(id)).eq('item', '출석체크')
      .gte('date', todayStr + 'T00:00:00+09:00').lt('date', todayStr + 'T23:59:59+09:00');
    if (todayLogs && todayLogs.length > 0) return res.json({ success: false, msg: '이미 완료' });

    await supabase.from('logs').insert({ teacher: 'System', student_id: id, item: '출석체크', point: 10 });
    await supabase.from('users').update({ points: (Number(user.points) || 0) + 10 }).eq('id', String(id).trim());
    return res.json({ success: true, msg: '완료! +10P' });
  }

  if (action === 'mbti') {
    const { id, mbti } = req.body;
    const { data: user } = await supabase.from('users').select('points, mbti').eq('id', String(id).trim()).single();
    if (!user) return res.json({ success: false, msg: '오류' });

    if (!user.mbti || user.mbti === '') {
      await supabase.from('users').update({ mbti, points: Number(user.points) + 100 }).eq('id', String(id).trim());
      await supabase.from('logs').insert({ teacher: 'System', student_id: id, item: 'MBTI 완료', point: 100 });
      return res.json({ success: true, msg: '결과 저장 +100P!' });
    } else {
      await supabase.from('users').update({ mbti }).eq('id', String(id).trim());
      return res.json({ success: true, msg: '결과 수정 완료' });
    }
  }

  if (action === 'report') {
    const { studentId, studentName, content, fileData } = req.body;
    try {
      let fileUrl = '';
      if (fileData && fileData.data) {
        const buffer = Buffer.from(fileData.data, 'base64');
        const fileName = `report_${studentId}_${Date.now()}.jpg`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('reports').upload(fileName, buffer, { contentType: fileData.mimeType, upsert: false });
        if (!uploadError && uploadData) {
          const { data: urlData } = supabase.storage.from('reports').getPublicUrl(fileName);
          fileUrl = urlData.publicUrl;
        }
      }
      await supabase.from('reports').insert({ reporter_id: studentId, reporter_name: studentName, content, file_link: fileUrl });
      return res.json({ success: true, msg: '제보가 접수되었습니다.' });
    } catch (e) {
      return res.json({ success: false, msg: '오류: ' + e.message });
    }
  }

  if (action === 'rental') {
    const { type, teacher, ids, mode } = req.body;
    const col = type === 'umbrella' ? 'umbrella' : 'ball';
    const txt = type === 'umbrella' ? '우산' : '공';
    let count = 0;
    for (const id of ids) {
      const { data: user } = await supabase.from('users').select('*').eq('id', String(id).trim()).single();
      if (!user) continue;
      if (mode === 'rent' && user[col] !== '대여중') {
        await supabase.from('users').update({ [col]: '대여중' }).eq('id', String(id).trim());
        await supabase.from('logs').insert({ teacher, student_id: id, item: txt + ' 대여', point: 0 });
        count++;
      } else if (mode === 'return' && user[col] === '대여중') {
        await supabase.from('users').update({ [col]: '' }).eq('id', String(id).trim());
        await supabase.from('logs').insert({ teacher, student_id: id, item: txt + ' 반납', point: 0 });
        count++;
      }
    }
    return res.json({ success: true, msg: count + '명 처리' });
  }

  return res.json({ success: false, msg: '알 수 없는 action' });
};
