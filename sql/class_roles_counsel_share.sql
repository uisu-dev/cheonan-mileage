-- 1인 1역(봉사도우미) + 상담 기록 작성자/공유 (증분 마이그레이션)
-- Supabase SQL Editor에서 직접 실행하세요. (배포 전 승인 후 적용)
-- 여러 번 실행해도 안전(idempotent). 기존 상담 기록은 삭제/수정하지 않고 teacher_id만 채웁니다.

-- ===== 1) 1인 1역 =====
-- 역할 종류: 학급(학년·반) + 학년도 + 학기별로 따로 관리 (1학기/2학기 목록 분리)
CREATE TABLE IF NOT EXISTS class_role_types (
  id BIGSERIAL PRIMARY KEY,
  school_year SMALLINT NOT NULL,                       -- 학년도 (3월 시작, 1~2월은 전년도)
  semester SMALLINT NOT NULL CHECK (semester IN (1, 2)),
  grade SMALLINT NOT NULL,
  class_nm SMALLINT NOT NULL,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT class_role_types_unique_name UNIQUE (school_year, semester, grade, class_nm, name)
);
CREATE INDEX IF NOT EXISTS idx_class_role_types_class
  ON class_role_types (school_year, semester, grade, class_nm);

-- 배정: 학생 1명은 학기당 역할 1개 (역할 1개에 여러 학생 가능)
CREATE TABLE IF NOT EXISTS class_role_assignments (
  id BIGSERIAL PRIMARY KEY,
  school_year SMALLINT NOT NULL,
  semester SMALLINT NOT NULL CHECK (semester IN (1, 2)),
  grade SMALLINT NOT NULL,
  class_nm SMALLINT NOT NULL,
  student_id TEXT NOT NULL,                            -- 학번 5자리
  role_id BIGINT NOT NULL REFERENCES class_role_types(id) ON DELETE CASCADE,
  assigned_by TEXT NOT NULL DEFAULT '',
  assigned_by_name TEXT NOT NULL DEFAULT '',
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT class_role_assignments_one_per_semester UNIQUE (student_id, school_year, semester)
);
CREATE INDEX IF NOT EXISTS idx_class_role_assignments_class
  ON class_role_assignments (school_year, semester, grade, class_nm);
CREATE INDEX IF NOT EXISTS idx_class_role_assignments_role
  ON class_role_assignments (role_id);

ALTER TABLE class_role_types DISABLE ROW LEVEL SECURITY;
ALTER TABLE class_role_assignments DISABLE ROW LEVEL SECURITY;

-- ===== 2) 상담 기록 작성자(teacher_id) =====
ALTER TABLE public.counseling_logs ADD COLUMN IF NOT EXISTS teacher_id TEXT NULL;

-- 기존 기록: teacher_name이 교사(teacher/admin) 1명과 정확히 일치할 때만 teacher_id 채움
-- (동명이인이거나 일치하는 교사가 없으면 NULL로 남겨 둠 → 아무도 볼 수 없음, 데이터는 보존)
UPDATE public.counseling_logs c
SET teacher_id = m.id
FROM (
  SELECT trim(name) AS nm, min(id) AS id
  FROM public.users
  WHERE lower(trim(role)) IN ('teacher', 'admin')
  GROUP BY trim(name)
  HAVING count(*) = 1
) m
WHERE c.teacher_id IS NULL
  AND trim(coalesce(c.teacher_name, '')) <> ''
  AND trim(c.teacher_name) = m.nm;

CREATE INDEX IF NOT EXISTS idx_counseling_logs_teacher ON public.counseling_logs (teacher_id);

-- ===== 3) 상담 기록 공유 (작성자가 지정한 교사만 열람) =====
CREATE TABLE IF NOT EXISTS counseling_shares (
  id BIGSERIAL PRIMARY KEY,
  log_id BIGINT NOT NULL REFERENCES public.counseling_logs(id) ON DELETE CASCADE,
  teacher_id TEXT NOT NULL,                            -- 공유받은 교사 id
  shared_by TEXT NOT NULL DEFAULT '',                  -- 공유한 교사(작성자) id
  shared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT counseling_shares_unique UNIQUE (log_id, teacher_id)
);
CREATE INDEX IF NOT EXISTS idx_counseling_shares_teacher ON counseling_shares (teacher_id);

ALTER TABLE counseling_shares DISABLE ROW LEVEL SECURITY;
