import { randomUUID } from 'node:crypto';
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { toProject } from '../db/projectRepository.mjs';

export const createProjectsService = ({ config, deps, repository }) => {
  const { minio, log } = deps;
  const {
    projectBucketPrefix,
    projectLoadedPrefix,
    projectParsedPrefix,
    projectMetadataObjectKey,
    minioRemovalPolicyName,
  } = config;

  const normalizeBucketSegment = (value) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);

  const projectBucketName = (projectId, name) => {
    const prefix = normalizeBucketSegment(projectBucketPrefix) || 'aissistaint-project';
    const slug = normalizeBucketSegment(name) || 'project';
    return `${prefix}-${slug}-${projectId.slice(0, 8)}`.slice(0, 63).replace(/-+$/g, '');
  };

  const objectPrefix = (value) => value.replace(/^\/+|\/+$/g, '') || 'data';
  const objectKey = (value) => value.replace(/^\/+/g, '') || 'project.json';

  const ensureProjectBucket = async ({ bucketName, loadedPrefix, parsedPrefix }) => {
    if (!minio.app) {
      throw new Error('MinIO credentials are not configured on the backend.');
    }

    try {
      await minio.app.send(new HeadBucketCommand({ Bucket: bucketName }));
    } catch {
      await minio.app.send(new CreateBucketCommand({ Bucket: bucketName }));
    }

    const emptyPrefixBody = Buffer.alloc(0);
    await Promise.all(
      [loadedPrefix, parsedPrefix].map((prefix) =>
        minio.app.send(
          new PutObjectCommand({
            Bucket: bucketName,
            Key: `${objectPrefix(prefix)}/`,
            Body: emptyPrefixBody,
            ContentLength: 0,
          }),
        ),
      ),
    );
  };

  const writeProjectMetadataObject = async (project) => {
    if (!minio.app) {
      throw new Error('MinIO credentials are not configured on the backend.');
    }

    if (!project.bucketName) {
      throw new Error('Project does not have a MinIO bucket configured.');
    }

    const metadata = {
      id: project.id,
      name: project.name,
      description: project.description,
      status: project.status,
      bucketName: project.bucketName,
      loadedPrefix: project.loadedPrefix,
      parsedPrefix: project.parsedPrefix,
      metadataObjectKey: project.metadataObjectKey,
      createdBy: project.createdBy,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      deletedAt: project.deletedAt,
    };

    await minio.app.send(
      new PutObjectCommand({
        Bucket: project.bucketName,
        Key: objectKey(project.metadataObjectKey ?? projectMetadataObjectKey),
        Body: JSON.stringify(metadata, null, 2),
        ContentType: 'application/json',
      }),
    );
  };

  const restrictDeletedProjectBucket = async (bucketName) => {
    if (!minio.removal) {
      throw new Error('MinIO removal credentials are not configured on the backend.');
    }

    await minio.removal.send(
      new PutBucketPolicyCommand({
        Bucket: bucketName,
        Policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Sid: 'HideDeletedProjectFromRegularUsers',
              Effect: 'Deny',
              Principal: '*',
              Action: [
                's3:GetBucketLocation',
                's3:ListBucket',
                's3:GetObject',
                's3:PutObject',
                's3:DeleteObject',
              ],
              Resource: [`arn:aws:s3:::${bucketName}`, `arn:aws:s3:::${bucketName}/*`],
              Condition: {
                StringNotEquals: {
                  'jwt:policy': minioRemovalPolicyName,
                },
              },
            },
          ],
        }),
      }),
    );
  };

  const requireProjectAccess = (projectId, request, allowedRoles) =>
    repository.requireProjectAccess(projectId, request, allowedRoles);

  const requireProjectMinio = (project) => {
    if (!minio.app) {
      throw Object.assign(new Error('MinIO credentials are not configured on the backend.'), { status: 503 });
    }
    if (!project.bucketName) {
      throw Object.assign(new Error('Project does not have a MinIO bucket configured.'), { status: 400 });
    }
    return minio.app;
  };

  const createProject = async ({ name, description, subject }) => {
    if (!name) {
      throw Object.assign(new Error('Project name is required.'), { status: 400 });
    }

    const projectId = randomUUID();
    const bucketName = projectBucketName(projectId, name);
    const loadedPrefix = objectPrefix(projectLoadedPrefix);
    const parsedPrefix = objectPrefix(projectParsedPrefix);
    const metadataObjectKey = objectKey(projectMetadataObjectKey);
    await ensureProjectBucket({ bucketName, loadedPrefix, parsedPrefix });

    const { client, row } = await repository.insertProjectWithMember({
      projectId,
      name,
      description,
      bucketName,
      loadedPrefix,
      parsedPrefix,
      metadataObjectKey,
      subject,
    });

    try {
      const project = toProject(row);
      await writeProjectMetadataObject(project);
      await client.query('COMMIT');
      log('POST /api/projects', { id: project.id, name, bucketName });
      return project;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };

  const patchProject = async ({ id, name, description, status, request }) => {
    if (name === '') {
      throw Object.assign(new Error('Project name cannot be blank.'), { status: 400 });
    }

    const { client, result } = await repository.updateProject({
      id,
      name,
      description,
      status,
      request,
    });

    try {
      if (result.rowCount === 0) {
        await client.query('ROLLBACK');
        const error = new Error('Project not found.');
        error.status = 404;
        throw error;
      }

      const project = toProject(result.rows[0]);
      await writeProjectMetadataObject(project);
      await client.query('COMMIT');
      log('PATCH /api/projects/:id', { id, metadataObjectKey: project.metadataObjectKey });
      return project;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignored: connection may already be released
      }
      throw error;
    } finally {
      client.release();
    }
  };

  const deleteProject = async ({ id }) => {
    const { client, result: existing } = await repository.findProjectById({ id });

    try {
      if (existing.rowCount === 0) {
        await client.query('ROLLBACK');
        const error = new Error('Project not found.');
        error.status = 404;
        throw error;
      }

      const project = toProject(existing.rows[0]);
      if (project.bucketName) {
        await writeProjectMetadataObject({
          ...project,
          status: 'deleted',
          deletedAt: new Date().toISOString(),
        });
        await restrictDeletedProjectBucket(project.bucketName);
      }

      await repository.deleteProjectRow(client, id);
      await client.query('COMMIT');
      log('DELETE /api/projects/:id', { id, bucketName: project.bucketName });
      return project;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignored
      }
      throw error;
    } finally {
      client.release();
    }
  };

  return {
    normalizeBucketSegment,
    projectBucketName,
    objectPrefix,
    objectKey,
    ensureProjectBucket,
    writeProjectMetadataObject,
    restrictDeletedProjectBucket,
    requireProjectAccess,
    requireProjectMinio,
    createProject,
    patchProject,
    deleteProject,
  };
};
