-- Simple Balance Music v2 — Supabase Schema Migration
-- Run this in the Supabase SQL editor

-- ============================================================
-- 1. PROFILES (extends auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name TEXT,
    avatar_url TEXT,
    spotify_connected BOOLEAN DEFAULT FALSE,
    tidal_connected BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
    ON profiles FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
    ON profiles FOR UPDATE
    USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
    ON profiles FOR INSERT
    WITH CHECK (auth.uid() = id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO profiles (id, display_name, avatar_url)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
        NEW.raw_user_meta_data->>'avatar_url'
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();


-- ============================================================
-- 2. SPOTIFY SESSIONS (persists across server restarts)
-- ============================================================
CREATE TABLE IF NOT EXISTS spotify_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at TIMESTAMPTZ,
    spotify_user_id TEXT,
    spotify_display_name TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE spotify_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own spotify session"
    ON spotify_sessions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can upsert own spotify session"
    ON spotify_sessions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own spotify session"
    ON spotify_sessions FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own spotify session"
    ON spotify_sessions FOR DELETE
    USING (auth.uid() = user_id);

-- Service role bypass for backend operations
CREATE POLICY "Service role full access on spotify_sessions"
    ON spotify_sessions FOR ALL
    USING (auth.role() = 'service_role');


-- ============================================================
-- 3. TASTE PROFILES
-- ============================================================
CREATE TABLE IF NOT EXISTS taste_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
    genres TEXT[],
    energy_level TEXT,
    bpm_min INTEGER,
    bpm_max INTEGER,
    key_clusters TEXT[],
    mood TEXT,
    dj_style TEXT,
    favorites JSONB DEFAULT '[]',
    recommendations JSONB DEFAULT '[]',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE taste_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own taste profile"
    ON taste_profiles FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own taste profile"
    ON taste_profiles FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own taste profile"
    ON taste_profiles FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Service role full access on taste_profiles"
    ON taste_profiles FOR ALL
    USING (auth.role() = 'service_role');


-- ============================================================
-- 4. JOBS (download, digest, mastering, stems, generation)
-- ============================================================
CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    title TEXT,
    metadata JSONB DEFAULT '{}',
    result JSONB,
    error TEXT,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own jobs"
    ON jobs FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own jobs"
    ON jobs FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own jobs"
    ON jobs FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Service role full access on jobs"
    ON jobs FOR ALL
    USING (auth.role() = 'service_role');


-- ============================================================
-- 5. MIX ARCHIVE
-- ============================================================
CREATE TABLE IF NOT EXISTS mix_archive (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    size_mb REAL,
    storage_path TEXT,
    tracklist JSONB,
    uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE mix_archive ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own archives"
    ON mix_archive FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own archives"
    ON mix_archive FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own archives"
    ON mix_archive FOR DELETE
    USING (auth.uid() = user_id);

CREATE POLICY "Service role full access on mix_archive"
    ON mix_archive FOR ALL
    USING (auth.role() = 'service_role');


-- ============================================================
-- 6. SAVED SETS (Set Builder output)
-- ============================================================
CREATE TABLE IF NOT EXISTS saved_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    vibe TEXT,
    duration TEXT,
    tracks JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE saved_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own sets"
    ON saved_sets FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sets"
    ON saved_sets FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sets"
    ON saved_sets FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own sets"
    ON saved_sets FOR DELETE
    USING (auth.uid() = user_id);

CREATE POLICY "Service role full access on saved_sets"
    ON saved_sets FOR ALL
    USING (auth.role() = 'service_role');


-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_mix_archive_user_id ON mix_archive(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_sets_user_id ON saved_sets(user_id);
