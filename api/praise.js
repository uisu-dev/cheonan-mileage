const { getSupabase, cors } = require('../lib/supabase');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  const { action } = req.body;
  const supabase = getSupabase();

  if (action === 'send') {
    const { senderId, senderName, receiverId, receiverName, content } = req.body;
    await supabase.from('praises').insert({
      id: String(Date.now()),
      sender_id: senderId, sender_name: senderName,
      receiver_id: receiverId, receiver_name: receiverName,
      content, status: 'Pending'
    });
    return res.json({ success: true, msg: '전송 완료' });
  }

  if (action === 'approve') {
    const { ids } = req.body;
    let count = 0;
    for (const praiseId of ids) {
      const { data: p } = await supabase.from('praises').select('*').eq('id', praiseId).eq('status', 'Pending').single();
      if (!p) continue;

      await supabase.from('praises').update({ status: 'Approved' }).eq('id', praiseId);

      // Sender +5
      const { data: sender } = await supabase.from('users').select('points').eq('id', p.sender_id).single();
      if (sender) {
        await supabase.from('users').update({ points: Number(sender.points) + 5 }).eq('id', p.sender_id);
        await supabase.from('logs').insert({ teacher: 'System', student_id: p.sender_id, item: '칭찬 보너스', point: 5 });
      }

      // Receiver +5
      const { data: receiver } = await supabase.from('users').select('points').eq('id', p.receiver_id).single();
      if (receiver) {
        await supabase.from('users').update({ points: Number(receiver.points) + 5 }).eq('id', p.receiver_id);
        await supabase.from('logs').insert({ teacher: 'System', student_id: p.receiver_id, item: '칭찬 받음', point: 5 });
      }
      count++;
    }
    return res.json({ success: true, msg: count + '건 승인' });
  }

  if (action === 'reject') {
    const { ids } = req.body;
    let count = 0;
    for (const praiseId of ids) {
      await supabase.from('praises').delete().eq('id', praiseId);
      count++;
    }
    return res.json({ success: true, msg: count + '건 반려' });
  }

  return res.json({ success: false, msg: '알 수 없는 action' });
};
