-- =====================================================
-- 천중 마일리지 Supabase 스키마
-- Supabase SQL Editor에서 실행하세요
-- =====================================================

-- 1. Users 테이블
CREATE TABLE users (
  id TEXT PRIMARY KEY,          -- 학번 (예: 10101)
  name TEXT NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student',  -- student, teacher, admin
  points INTEGER NOT NULL DEFAULT 0,
  umbrella TEXT DEFAULT '',
  ball TEXT DEFAULT '',
  mbti TEXT DEFAULT ''
);

-- 2. Rewards 테이블 (교환 물품)
CREATE TABLE rewards (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  active TEXT DEFAULT 'O'
);

-- 3. Items 테이블 (점수 항목)
CREATE TABLE items (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  points INTEGER NOT NULL,
  active TEXT DEFAULT 'O'
);

-- 4. Logs 테이블 (점수 기록)
CREATE TABLE logs (
  id SERIAL PRIMARY KEY,
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  teacher TEXT NOT NULL,
  student_id TEXT NOT NULL,
  item TEXT NOT NULL,
  point INTEGER NOT NULL
);
CREATE INDEX idx_logs_student ON logs(student_id);
CREATE INDEX idx_logs_teacher ON logs(teacher);

-- 5. Praises 테이블 (칭찬)
CREATE TABLE praises (
  id TEXT PRIMARY KEY,
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sender_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  receiver_id TEXT NOT NULL,
  receiver_name TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending'  -- Pending, Approved
);

-- 6. Surveys 테이블 (설문)
CREATE TABLE surveys (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  questions JSONB NOT NULL,
  status TEXT DEFAULT 'O'
);

-- 7. Survey Logs 테이블 (설문 응답)
CREATE TABLE survey_logs (
  id SERIAL PRIMARY KEY,
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  vote_id TEXT NOT NULL,        -- survey id
  student_id TEXT NOT NULL,
  answer JSONB NOT NULL
);
CREATE INDEX idx_survey_logs_vote ON survey_logs(vote_id);

-- 8. Clubs 테이블 (동아리/학급)
CREATE TABLE clubs (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL,
  name TEXT NOT NULL,
  members JSONB DEFAULT '[]'
);

-- 9. Club Logs 테이블 (출석 기록)
CREATE TABLE club_logs (
  id SERIAL PRIMARY KEY,
  time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  club_id TEXT NOT NULL,
  date TEXT NOT NULL,
  data JSONB NOT NULL
);
CREATE INDEX idx_club_logs_club ON club_logs(club_id);

-- 10. Reports 테이블 (제보)
CREATE TABLE reports (
  id SERIAL PRIMARY KEY,
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reporter_id TEXT NOT NULL,
  reporter_name TEXT NOT NULL,
  content TEXT NOT NULL,
  file_link TEXT DEFAULT ''
);

-- 11. Quizzes 테이블
CREATE TABLE quizzes (
  id TEXT PRIMARY KEY,
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  teacher TEXT NOT NULL,
  title TEXT NOT NULL,
  questions JSONB NOT NULL,
  status TEXT DEFAULT 'O'
);

-- 12. Quiz Logs 테이블
CREATE TABLE quiz_logs (
  id SERIAL PRIMARY KEY,
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  quiz_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  result TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_quiz_logs_quiz ON quiz_logs(quiz_id);

-- =====================================================
-- Supabase Storage 버킷 (제보 사진용)
-- Supabase 대시보드 > Storage 에서 'reports' 버킷 생성
-- Public 접근 허용 설정 필요
-- =====================================================

-- RLS (Row Level Security) 비활성화 (서비스 키 사용이므로)
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE rewards DISABLE ROW LEVEL SECURITY;
ALTER TABLE items DISABLE ROW LEVEL SECURITY;
ALTER TABLE logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE praises DISABLE ROW LEVEL SECURITY;
ALTER TABLE surveys DISABLE ROW LEVEL SECURITY;
ALTER TABLE survey_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE clubs DISABLE ROW LEVEL SECURITY;
ALTER TABLE club_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE reports DISABLE ROW LEVEL SECURITY;
ALTER TABLE quizzes DISABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_logs DISABLE ROW LEVEL SECURITY;
