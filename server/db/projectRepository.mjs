import { forbidden } from '../middleware/errors.mjs';

export const toProject = (row) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  status: row.status,
  bucketName: row.bucket_name,
  loadedPrefix: row.loaded_prefix,
  parsedPrefix: row.parsed_prefix,
  metadataObjectKey: row.metadata_object_key,
  createdBy: row.created_by,
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
});

export const createProjectRepository = ({ migrations, roles }) => {
  const { requireProjectDb } = migrations;
  const { isAdmin, isRemovalAgent, userSubject } = roles;

  const getProjectRole = async (client, projectId, request) => {
    if (isAdmin(request.user) || isRemovalAgent(request.user)) {
      return 'admin';
    }

    const result = await client.query(
      `
        SELECT role
        FROM project_members
        WHERE project_id = $1 AND user_subject = $2
      `,
      [projectId, userSubject(request)],
    );
    return result.rows[0]?.role ?? null;
  };

  const requireProjectRole = async (
    client,
    projectId,
    request,
    allowedRoles = ['owner', 'editor'],
  ) => {
    const role = await getProjectRole(client, projectId, request);
    if (!role || (role !== 'admin' && !allowedRoles.includes(role))) {
      throw forbidden();
    }
    return role;
  };

  const listProjectsForRequest = async (request) => {
    const db = await requireProjectDb();
    const result =
      isAdmin(request.user) || isRemovalAgent(request.user)
        ? await db.query(`
          SELECT id, name, description, status, bucket_name, loaded_prefix, parsed_prefix, metadata_object_key, created_by, created_at, updated_at
          FROM projects
          ORDER BY updated_at DESC, created_at DESC
        `)
        : await db.query(
            `
              SELECT p.id, p.name, p.description, p.status, p.bucket_name, p.loaded_prefix, p.parsed_prefix, p.metadata_object_key, p.created_by, p.created_at, p.updated_at
              FROM projects p
              INNER JOIN project_members pm ON pm.project_id = p.id
              WHERE pm.user_subject = $1
              ORDER BY p.updated_at DESC, p.created_at DESC
            `,
            [userSubject(request)],
          );
    return result;
  };

  const insertProjectWithMember = async ({
    projectId,
    name,
    description,
    bucketName,
    loadedPrefix,
    parsedPrefix,
    metadataObjectKey,
    subject,
  }) => {
    const db = await requireProjectDb();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `
          INSERT INTO projects (id, name, description, bucket_name, loaded_prefix, parsed_prefix, metadata_object_key, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id, name, description, status, bucket_name, loaded_prefix, parsed_prefix, metadata_object_key, created_by, created_at, updated_at
        `,
        [projectId, name, description, bucketName, loadedPrefix, parsedPrefix, metadataObjectKey, subject],
      );
      await client.query(
        `
          INSERT INTO project_members (project_id, user_subject, role)
          VALUES ($1, $2, 'owner')
          ON CONFLICT (project_id, user_subject) DO UPDATE SET role = EXCLUDED.role
        `,
        [result.rows[0].id, subject],
      );
      return { client, row: result.rows[0] };
    } catch (error) {
      await client.query('ROLLBACK');
      client.release();
      throw error;
    }
  };

  const updateProject = async ({ id, name, description, status, request }) => {
    const db = await requireProjectDb();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await requireProjectRole(client, id, request, ['owner', 'editor']);
      const result = await client.query(
        `
          UPDATE projects
          SET
            name = COALESCE($2, name),
            description = COALESCE($3, description),
            status = COALESCE($4, status),
            updated_at = now()
          WHERE id = $1
          RETURNING id, name, description, status, bucket_name, loaded_prefix, parsed_prefix, metadata_object_key, created_by, created_at, updated_at
        `,
        [id, name, description, status],
      );
      return { client, result };
    } catch (error) {
      await client.query('ROLLBACK');
      client.release();
      throw error;
    }
  };

  const findProjectById = async ({ id }) => {
    const db = await requireProjectDb();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `
          SELECT id, name, description, status, bucket_name, loaded_prefix, parsed_prefix, metadata_object_key, created_by, created_at, updated_at
          FROM projects
          WHERE id = $1
        `,
        [id],
      );
      return { client, result };
    } catch (error) {
      await client.query('ROLLBACK');
      client.release();
      throw error;
    }
  };

  const deleteProjectRow = async (client, id) => {
    await client.query('DELETE FROM projects WHERE id = $1', [id]);
  };

  const requireProjectAccess = async (projectId, request, allowedRoles) => {
    const db = await requireProjectDb();
    const client = await db.connect();
    try {
      await requireProjectRole(client, projectId, request, allowedRoles);
      const result = await client.query(
        `
          SELECT id, name, description, status, bucket_name, loaded_prefix, parsed_prefix, metadata_object_key, created_by, created_at, updated_at
          FROM projects
          WHERE id = $1
        `,
        [projectId],
      );
      if (result.rowCount === 0) {
        throw Object.assign(new Error('Project not found.'), { status: 404 });
      }
      return toProject(result.rows[0]);
    } finally {
      client.release();
    }
  };

  const checkProjectRoleStandalone = async (projectId, request, allowedRoles) => {
    const db = await requireProjectDb();
    const client = await db.connect();
    try {
      await requireProjectRole(client, projectId, request, allowedRoles);
    } finally {
      client.release();
    }
  };

  return {
    toProject,
    getProjectRole,
    requireProjectRole,
    listProjectsForRequest,
    insertProjectWithMember,
    updateProject,
    findProjectById,
    deleteProjectRow,
    requireProjectAccess,
    checkProjectRoleStandalone,
  };
};
