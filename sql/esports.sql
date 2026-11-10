-- 찾아가는 이스포츠 대회 신청 (3학년 전용) — 종목 선택 + 팀 구성
-- Supabase SQL Editor에서 직접 실행하세요. (배포 전 승인 후 적용)
-- 기존 테이블/데이터(통일조사 복권 survey_logs 등)는 건드리지 않습니다.
--
-- game: lol(롤, 5명) | brawl(브롤스타즈, 3명) | steppin(스테핀, 개인 1명) | valorant(발로란트, 5명)
-- 한 학생은 전체 종목을 통틀어 하나의 팀에만 속할 수 있음
--   → esports_members.student_id UNIQUE (리더 본인도 멤버 행으로 저장하므로 리더/팀원 구분 없이 1인 1팀)

CREATE TABLE IF NOT EXISTS esports_teams (
  id BIGSERIAL PRIMARY KEY,
  game TEXT NOT NULL CHECK (game IN ('lol','brawl','steppin','valorant')),
  team_name TEXT NOT NULL DEFAULT '',
  leader_id TEXT NOT NULL,            -- 신청자(리더) 학번 5자리
  leader_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_esports_teams_game ON esports_teams (game, created_at);

CREATE TABLE IF NOT EXISTS esports_members (
  id BIGSERIAL PRIMARY KEY,
  team_id BIGINT NOT NULL REFERENCES esports_teams(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL,           -- 학번 5자리 (3학년: 3xxxx)
  name TEXT NOT NULL DEFAULT '',
  tier TEXT NOT NULL DEFAULT '',      -- 자유 입력 (예: 골드 2)
  is_leader BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT esports_members_student_unique UNIQUE (student_id)
);

CREATE INDEX IF NOT EXISTS idx_esports_members_team ON esports_members (team_id);

-- 다른 테이블과 동일하게 서버(service role)에서만 접근
ALTER TABLE esports_teams DISABLE ROW LEVEL SECURITY;
ALTER TABLE esports_members DISABLE ROW LEVEL SECURITY;
