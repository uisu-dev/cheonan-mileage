-- 학급 출석부 (교시별) — 담임/교과 교사가 교시마다 출석 예외를 체크
-- Supabase SQL Editor에서 직접 실행하세요. (배포 전 승인 후 적용)
-- 기존 동아리 출석부(clubs, club_logs)와 학생 +10P 출석체크는 건드리지 않습니다.
--
-- 기본값은 '출석'이라 예외만 행으로 저장합니다.
-- status: late(지각) | early_leave(조퇴) | result(결과)
--         | absent_excused(결석 인정) | absent_unexcused(결석 미인정)
--         | absent_sick(결석 질병) | absent_other(결석 기타)

CREATE TABLE IF NOT EXISTS attendance_records (
  id BIGSERIAL PRIMARY KEY,
  date TEXT NOT NULL,                 -- YYYYMMDD (NEIS 형식)
  grade SMALLINT NOT NULL,
  class_nm SMALLINT NOT NULL,
  period SMALLINT NOT NULL,           -- 교시 1~10
  subject TEXT NOT NULL DEFAULT '',
  student_id TEXT NOT NULL,           -- 학번 5자리
  status TEXT NOT NULL CHECK (status IN (
    'late','early_leave','result',
    'absent_excused','absent_unexcused','absent_sick','absent_other')),
  note TEXT NOT NULL DEFAULT '',
  teacher_id TEXT NOT NULL DEFAULT '',
  teacher_name TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (date, student_id, period)
);

CREATE INDEX IF NOT EXISTS idx_attendance_records_class_day
  ON attendance_records (date, grade, class_nm);
CREATE INDEX IF NOT EXISTS idx_attendance_records_student
  ON attendance_records (student_id, date);

-- 교시별 "누가 언제 확인/저장했는지" (예외 0명이어도 남음)
CREATE TABLE IF NOT EXISTS attendance_periods (
  id BIGSERIAL PRIMARY KEY,
  date TEXT NOT NULL,
  grade SMALLINT NOT NULL,
  class_nm SMALLINT NOT NULL,
  period SMALLINT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  teacher_id TEXT NOT NULL DEFAULT '',
  teacher_name TEXT NOT NULL DEFAULT '',
  exception_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (date, grade, class_nm, period)
);

CREATE INDEX IF NOT EXISTS idx_attendance_periods_class_day
  ON attendance_periods (date, grade, class_nm);

-- 다른 테이블과 동일하게 서버(service role)에서만 접근
ALTER TABLE attendance_records DISABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_periods DISABLE ROW LEVEL SECURITY;
