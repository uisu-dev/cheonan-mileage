-- 학급 출석부: 조퇴를 질병/미인정/인정 3종으로 분리
-- Supabase SQL Editor에서 배포 승인 후 실행하세요. (이 PR 머지 전에 적용 권장)
-- 라이브 점검(2026-11-06): attendance_records에서 status='early_leave' 행 0건 → 데이터 변환 없음.
--
-- 새 허용값:
--   late | early_leave_sick | early_leave_unexcused | early_leave_excused | result
--   | absent_excused | absent_unexcused | absent_sick | absent_other
-- 제거: early_leave (단일 조퇴)

-- 만약 나중에 early_leave 행이 생기면 아래를 먼저 실행한 뒤 CHECK를 바꾸세요.
-- UPDATE attendance_records SET status = 'early_leave_excused' WHERE status = 'early_leave';

ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS attendance_records_status_check;

ALTER TABLE attendance_records ADD CONSTRAINT attendance_records_status_check CHECK (status IN (
  'late',
  'early_leave_sick',
  'early_leave_unexcused',
  'early_leave_excused',
  'result',
  'absent_excused',
  'absent_unexcused',
  'absent_sick',
  'absent_other'
));
