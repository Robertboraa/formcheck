-- FormCheck database schema. Safe to run more than once.
-- Only numbers about each rep are stored, never video.

CREATE TABLE IF NOT EXISTS users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- one workout set: an exercise done on the live camera or an uploaded clip
CREATE TABLE IF NOT EXISTS sessions (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    exercise   text NOT NULL,
    source     text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_user_created ON sessions (user_id, created_at DESC);

-- one rep inside a session, with the verdict and the measurements behind it
CREATE TABLE IF NOT EXISTS reps (
    session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    n          integer NOT NULL,
    good       boolean NOT NULL,
    faults     text[] NOT NULL,
    numbers    jsonb NOT NULL,
    bottom     real NOT NULL,
    top        real NOT NULL,
    line       text NOT NULL,
    PRIMARY KEY (session_id, n)
);
