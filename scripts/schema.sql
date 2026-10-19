-- 像素松参赛平台 · 数据库结构
-- 目标环境：PostgreSQL + auth.uid()（WorkBuddy 云服务 / Supabase 兼容）
-- 用法：在云服务 SQL 控制台整段执行一次。可重复执行（表用 IF NOT EXISTS，策略先删后建）。
-- 注意：本文件只建结构与权限，业务初始数据见 seed.sql。

-- ---------------------------------------------------------------- 基础表
CREATE TABLE IF NOT EXISTS profiles (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT auth.uid() UNIQUE,
  owner_name TEXT,
  nickname TEXT,
  contact TEXT,
  skills TEXT,
  role TEXT NOT NULL DEFAULT 'participant',
  looking_for_team BOOLEAN NOT NULL DEFAULT false,
  bio TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cnkd_sub TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS profiles_cnkd_sub_key ON profiles (cnkd_sub) WHERE cnkd_sub IS NOT NULL;

CREATE TABLE IF NOT EXISTS teams (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT auth.uid(),
  owner_name TEXT,
  name TEXT NOT NULL,
  track TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  -- team = 团队参赛；individual = 个人参赛（内部是 1 人队伍，跳过人数校验）
  kind TEXT NOT NULL DEFAULT 'team',
  status TEXT NOT NULL DEFAULT 'pending',
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_members (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id BIGINT NOT NULL,
  owner_id TEXT NOT NULL DEFAULT auth.uid() UNIQUE,
  member_name TEXT,
  is_leader BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS submissions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id BIGINT NOT NULL,
  owner_id TEXT NOT NULL DEFAULT auth.uid(),
  owner_name TEXT,
  track TEXT NOT NULL,
  is_backup BOOLEAN NOT NULL DEFAULT false,
  title TEXT NOT NULL,
  summary TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  links JSONB NOT NULL DEFAULT '{}'::jsonb,
  pkg_sha256 TEXT,
  pkg_size TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  compatibility JSONB,
  fix_used BOOLEAN NOT NULL DEFAULT false,
  fix_deadline TIMESTAMPTZ,
  version_no INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  scan JSONB,
  file_name TEXT,
  shared_path TEXT,
  file_size BIGINT,
  file_path TEXT,
  UNIQUE (team_id, is_backup)
);

CREATE TABLE IF NOT EXISTS submission_versions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  submission_id BIGINT NOT NULL,
  team_id BIGINT NOT NULL,
  owner_id TEXT NOT NULL DEFAULT auth.uid(),
  owner_name TEXT,
  version_no INT NOT NULL,
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  sha256 TEXT,
  pkg_size TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reviews (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  submission_id BIGINT NOT NULL,
  judge_uid TEXT NOT NULL,
  judge_name TEXT,
  scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  total NUMERIC,
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (submission_id, judge_uid)
);

CREATE TABLE IF NOT EXISTS announcements (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id TEXT DEFAULT auth.uid(),
  owner_name TEXT,
  title TEXT NOT NULL,
  body TEXT,
  pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity (
  id INT PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS appeals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  submission_id BIGINT NOT NULL,
  owner_id TEXT NOT NULL DEFAULT auth.uid(),
  owner_name TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  reply TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS signatures (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT auth.uid(),
  owner_name TEXT,
  doc_key TEXT NOT NULL,
  doc_version TEXT NOT NULL,
  doc_hash TEXT NOT NULL,
  agreed_name TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, doc_key, doc_version)
);

CREATE TABLE IF NOT EXISTS documents (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doc_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  owner_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS certificates (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cert_code TEXT NOT NULL UNIQUE,
  submission_id BIGINT NOT NULL,
  team_id BIGINT NOT NULL,
  team_name TEXT,
  owner_id TEXT NOT NULL,
  holder_name TEXT NOT NULL,
  work_title TEXT NOT NULL,
  track TEXT NOT NULL,
  award_key TEXT NOT NULL,
  award_name TEXT NOT NULL,
  -- 评委证书专用：award_key='judge' 时记录职务与负责赛道
  judge_title TEXT,
  judge_track TEXT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  issued_by TEXT,
  UNIQUE (submission_id, owner_id, award_key)
);

CREATE TABLE IF NOT EXISTS partners (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'co',
  logo_url TEXT,
  site_url TEXT,
  note TEXT,
  sort INT NOT NULL DEFAULT 100,
  owner_id TEXT DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS judges (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  title TEXT,
  org TEXT,
  avatar_url TEXT,
  bio TEXT,
  tracks TEXT,
  sort INT NOT NULL DEFAULT 100,
  published BOOLEAN NOT NULL DEFAULT true,
  owner_id TEXT DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- 权限判定函数
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE owner_id = auth.uid() AND role = 'admin')
$$;

CREATE OR REPLACE FUNCTION public.is_staff() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE owner_id = auth.uid() AND role IN ('admin','judge'))
$$;

-- 角色调整走服务端函数：校验调用者是主办方，且不允许把最后一个主办方降级
CREATE OR REPLACE FUNCTION public.admin_set_role(target_uid text, new_role text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE owner_id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF new_role NOT IN ('participant','judge','admin') THEN
    RAISE EXCEPTION 'bad role';
  END IF;
  IF new_role <> 'admin'
     AND (SELECT role FROM profiles WHERE owner_id = target_uid) = 'admin'
     AND (SELECT count(*) FROM profiles WHERE role = 'admin') <= 1 THEN
    RAISE EXCEPTION 'cannot remove last admin';
  END IF;
  UPDATE profiles SET role = new_role WHERE owner_id = target_uid;
  RETURN FOUND;
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_set_role(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_role(text, text) TO authenticated;

-- ---------------------------------------------------------------- 表权限
GRANT USAGE ON SCHEMA public TO anon, authenticated;

GRANT SELECT, INSERT ON public.profiles TO authenticated;
GRANT SELECT ON public.profiles TO anon;
GRANT UPDATE (nickname, contact, skills, looking_for_team, bio, cnkd_sub) ON public.profiles TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.teams TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.team_members TO authenticated;

GRANT SELECT ON public.submissions TO anon, authenticated;
GRANT INSERT, UPDATE ON public.submissions TO authenticated;

GRANT SELECT, INSERT ON public.submission_versions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.reviews TO authenticated;

GRANT SELECT ON public.announcements TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.announcements TO authenticated;

GRANT SELECT ON public.activity TO anon, authenticated;
GRANT INSERT, UPDATE ON public.activity TO authenticated;

GRANT SELECT, INSERT, UPDATE ON public.appeals TO authenticated;
GRANT SELECT, INSERT ON public.signatures TO authenticated;

GRANT SELECT ON public.documents TO anon, authenticated;
GRANT INSERT, UPDATE ON public.documents TO authenticated;

GRANT SELECT ON public.certificates TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.certificates TO authenticated;

GRANT SELECT ON public.partners TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.partners TO authenticated;

GRANT SELECT ON public.judges TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.judges TO authenticated;

-- ---------------------------------------------------------------- 行级权限
ALTER TABLE public.profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submission_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appeals             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signatures          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partners            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.judges              ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_read ON public.profiles;
DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_read       ON public.profiles FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY profiles_insert_own ON public.profiles FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS teams_read ON public.teams;
DROP POLICY IF EXISTS teams_insert_own ON public.teams;
DROP POLICY IF EXISTS teams_update_own ON public.teams;
CREATE POLICY teams_read       ON public.teams FOR SELECT TO authenticated USING (true);
CREATE POLICY teams_insert_own ON public.teams FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY teams_update_own ON public.teams FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR is_admin()) WITH CHECK (owner_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS team_members_read ON public.team_members;
DROP POLICY IF EXISTS team_members_insert ON public.team_members;
DROP POLICY IF EXISTS team_members_delete ON public.team_members;
CREATE POLICY team_members_read   ON public.team_members FOR SELECT TO authenticated USING (true);
CREATE POLICY team_members_insert ON public.team_members FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid() OR is_admin());
CREATE POLICY team_members_delete ON public.team_members FOR DELETE TO authenticated
  USING (owner_id = auth.uid() OR is_admin()
         OR team_id IN (SELECT id FROM teams WHERE owner_id = auth.uid()));

DROP POLICY IF EXISTS submissions_read ON public.submissions;
DROP POLICY IF EXISTS submissions_insert ON public.submissions;
DROP POLICY IF EXISTS submissions_update ON public.submissions;
CREATE POLICY submissions_read ON public.submissions FOR SELECT TO anon, authenticated
  USING (status = 'public' OR owner_id = auth.uid() OR is_staff());
CREATE POLICY submissions_insert ON public.submissions FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());
CREATE POLICY submissions_update ON public.submissions FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR is_admin()) WITH CHECK (owner_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS submission_versions_select ON public.submission_versions;
DROP POLICY IF EXISTS submission_versions_insert ON public.submission_versions;
CREATE POLICY submission_versions_select ON public.submission_versions FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR is_staff());
CREATE POLICY submission_versions_insert ON public.submission_versions FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS reviews_select ON public.reviews;
DROP POLICY IF EXISTS reviews_insert ON public.reviews;
DROP POLICY IF EXISTS reviews_update ON public.reviews;
CREATE POLICY reviews_select ON public.reviews FOR SELECT TO authenticated
  USING (judge_uid = auth.uid() OR is_admin());
CREATE POLICY reviews_insert ON public.reviews FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY reviews_update ON public.reviews FOR UPDATE TO authenticated
  USING (judge_uid = auth.uid() OR is_admin()) WITH CHECK (judge_uid = auth.uid() OR is_admin());

DROP POLICY IF EXISTS announcements_read ON public.announcements;
DROP POLICY IF EXISTS announcements_admin ON public.announcements;
CREATE POLICY announcements_read  ON public.announcements FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY announcements_admin ON public.announcements FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS activity_read ON public.activity;
DROP POLICY IF EXISTS activity_admin ON public.activity;
CREATE POLICY activity_read  ON public.activity FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY activity_admin ON public.activity FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS appeals_select ON public.appeals;
DROP POLICY IF EXISTS appeals_insert ON public.appeals;
DROP POLICY IF EXISTS appeals_admin ON public.appeals;
CREATE POLICY appeals_select ON public.appeals FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR is_admin());
CREATE POLICY appeals_insert ON public.appeals FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY appeals_admin  ON public.appeals FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS signatures_read ON public.signatures;
DROP POLICY IF EXISTS signatures_insert ON public.signatures;
CREATE POLICY signatures_read ON public.signatures FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR is_staff()
         OR owner_id IN (SELECT m2.owner_id FROM team_members m1
                         JOIN team_members m2 ON m2.team_id = m1.team_id
                         WHERE m1.owner_id = auth.uid()));
CREATE POLICY signatures_insert ON public.signatures FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS documents_read ON public.documents;
DROP POLICY IF EXISTS documents_admin ON public.documents;
CREATE POLICY documents_read  ON public.documents FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY documents_admin ON public.documents FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS certificates_read ON public.certificates;
DROP POLICY IF EXISTS certificates_admin ON public.certificates;
CREATE POLICY certificates_read  ON public.certificates FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY certificates_admin ON public.certificates FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS partners_read ON public.partners;
DROP POLICY IF EXISTS partners_admin ON public.partners;
CREATE POLICY partners_read  ON public.partners FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY partners_admin ON public.partners FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS judges_read ON public.judges;
DROP POLICY IF EXISTS judges_admin ON public.judges;
CREATE POLICY judges_read  ON public.judges FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY judges_admin ON public.judges FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- ---------------------------------------------------------------- 收尾
-- 第一个管理员：注册后用 owner_id 提升（之后可在后台「系统 → 角色管理」里改）
-- UPDATE profiles SET role = 'admin' WHERE owner_id = '<你的 UID>';
