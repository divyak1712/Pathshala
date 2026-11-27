-- Idempotent. Append-only: never put destructive statements here.

-- ===== Better Auth core tables (quoted camelCase as Better Auth expects) =====
CREATE TABLE IF NOT EXISTS "user" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false,
  "image" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "role" text NOT NULL DEFAULT 'student',
  "active" boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS "session" (
  "id" text PRIMARY KEY,
  "expiresAt" timestamptz NOT NULL,
  "token" text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "ipAddress" text,
  "userAgent" text,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS "account" (
  "id" text PRIMARY KEY,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "password" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "verification" (
  "id" text PRIMARY KEY,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS session_user_idx ON "session"("userId");
CREATE INDEX IF NOT EXISTS account_user_idx ON "account"("userId");

-- ===== School domain =====
CREATE TABLE IF NOT EXISTS classes (
  id serial PRIMARY KEY,
  name text NOT NULL,
  section text NOT NULL DEFAULT 'A',
  academic_year text NOT NULL,
  class_teacher_id text REFERENCES "user"("id") ON DELETE SET NULL,
  UNIQUE (name, section, academic_year)
);
CREATE TABLE IF NOT EXISTS subjects (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  code text NOT NULL UNIQUE
);
-- A subject taught in a class by a teacher
CREATE TABLE IF NOT EXISTS class_subjects (
  id serial PRIMARY KEY,
  class_id int NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id int NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  teacher_id text REFERENCES "user"("id") ON DELETE SET NULL,
  UNIQUE (class_id, subject_id)
);
CREATE TABLE IF NOT EXISTS students (
  id serial PRIMARY KEY,
  user_id text NOT NULL UNIQUE REFERENCES "user"("id") ON DELETE CASCADE,
  class_id int REFERENCES classes(id) ON DELETE SET NULL,
  admission_no text NOT NULL UNIQUE,
  roll_no int,
  dob date,
  phone text
);
CREATE TABLE IF NOT EXISTS parent_students (
  parent_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  student_id int NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  PRIMARY KEY (parent_id, student_id)
);
CREATE TABLE IF NOT EXISTS attendance (
  id serial PRIMARY KEY,
  student_id int NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id int NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  date date NOT NULL,
  status text NOT NULL CHECK (status IN ('present','absent','late','excused')),
  marked_by text REFERENCES "user"("id") ON DELETE SET NULL,
  UNIQUE (student_id, date)
);
CREATE TABLE IF NOT EXISTS assessments (
  id serial PRIMARY KEY,
  class_subject_id int NOT NULL REFERENCES class_subjects(id) ON DELETE CASCADE,
  title text NOT NULL,
  kind text NOT NULL DEFAULT 'exam' CHECK (kind IN ('exam','quiz','test','project')),
  max_marks numeric(6,2) NOT NULL CHECK (max_marks > 0),
  date date NOT NULL DEFAULT CURRENT_DATE
);
CREATE TABLE IF NOT EXISTS grades (
  assessment_id int NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  student_id int NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  marks numeric(6,2) NOT NULL CHECK (marks >= 0),
  remarks text,
  PRIMARY KEY (assessment_id, student_id)
);
CREATE TABLE IF NOT EXISTS assignments (
  id serial PRIMARY KEY,
  class_subject_id int NOT NULL REFERENCES class_subjects(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  due_date date NOT NULL,
  max_marks numeric(6,2) NOT NULL DEFAULT 10,
  created_by text REFERENCES "user"("id") ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS submissions (
  assignment_id int NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id int NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  content text NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  marks numeric(6,2),
  feedback text,
  PRIMARY KEY (assignment_id, student_id)
);
CREATE TABLE IF NOT EXISTS timetable (
  id serial PRIMARY KEY,
  class_subject_id int NOT NULL REFERENCES class_subjects(id) ON DELETE CASCADE,
  day smallint NOT NULL CHECK (day BETWEEN 1 AND 7),
  start_time time NOT NULL,
  end_time time NOT NULL CHECK (end_time > start_time),
  room text
);
CREATE TABLE IF NOT EXISTS fees (
  id serial PRIMARY KEY,
  student_id int NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  title text NOT NULL,
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  due_date date NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  id serial PRIMARY KEY,
  fee_id int NOT NULL REFERENCES fees(id) ON DELETE CASCADE,
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  method text NOT NULL DEFAULT 'cash',
  reference text UNIQUE,
  paid_at timestamptz NOT NULL DEFAULT now(),
  recorded_by text REFERENCES "user"("id") ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS announcements (
  id serial PRIMARY KEY,
  title text NOT NULL,
  body text NOT NULL,
  audience text NOT NULL DEFAULT 'all' CHECK (audience IN ('all','teacher','student','parent')),
  class_id int REFERENCES classes(id) ON DELETE CASCADE,
  created_by text REFERENCES "user"("id") ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attendance_class_date_idx ON attendance(class_id, date);
CREATE INDEX IF NOT EXISTS students_class_idx ON students(class_id);
