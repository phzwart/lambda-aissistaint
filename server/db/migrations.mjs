export const createProjectDbGate = ({ deps }) => {
  const { projectDb, log } = deps;

  let projectDbReady = false;
  let projectDbInitPromise = null;

  const resetProjectDbInit = () => {
    projectDbReady = false;
    projectDbInitPromise = null;
  };

  const isMissingProjectsTableError = (error) =>
    error?.code === '42P01' && /relation "projects" does not exist/i.test(String(error?.message ?? ''));

  const verifyProjectSchema = async () => {
    const result = await projectDb.query(
      `SELECT to_regclass('public.projects') AS projects_table, to_regclass('public.project_members') AS members_table`,
    );
    const row = result.rows[0] ?? {};
    return Boolean(row.projects_table && row.members_table);
  };

  const initializeProjectDb = async () => {
    const client = await projectDb.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(424242001)');
      await client.query(`
        CREATE TABLE IF NOT EXISTS projects (
          id uuid PRIMARY KEY,
          name text NOT NULL CHECK (length(trim(name)) > 0),
          description text NOT NULL DEFAULT '',
          status text NOT NULL DEFAULT 'active',
          bucket_name text,
          loaded_prefix text NOT NULL DEFAULT 'loaded',
          parsed_prefix text NOT NULL DEFAULT 'parsed',
          metadata_object_key text NOT NULL DEFAULT 'project.json',
          created_by text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await client.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS bucket_name text');
      await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS loaded_prefix text NOT NULL DEFAULT 'loaded'`);
      await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS parsed_prefix text NOT NULL DEFAULT 'parsed'`);
      await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS metadata_object_key text NOT NULL DEFAULT 'project.json'`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS project_members (
          project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          user_subject text NOT NULL,
          role text NOT NULL DEFAULT 'owner',
          created_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (project_id, user_subject)
        )
      `);
      await client.query('COMMIT');
      projectDbReady = true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };

  const requireProjectDb = async () => {
    if (!projectDb) {
      throw new Error('App database is not configured on the backend.');
    }

    if (projectDbReady) {
      const schemaOk = await verifyProjectSchema();
      if (!schemaOk) {
        log('Project schema missing; re-initializing app database tables.');
        resetProjectDbInit();
      }
    }

    if (!projectDbReady) {
      projectDbInitPromise ??= initializeProjectDb().catch((error) => {
        projectDbInitPromise = null;
        throw error;
      });
      await projectDbInitPromise;
    }

    return projectDb;
  };

  return {
    requireProjectDb,
    resetProjectDbInit,
    isMissingProjectsTableError,
    verifyProjectSchema,
  };
};
