import pg from 'pg';

export const createPostgresPool = (config) => {
  if (!config.appDatabaseUrl) {
    return null;
  }
  return new pg.Pool({ connectionString: config.appDatabaseUrl });
};
