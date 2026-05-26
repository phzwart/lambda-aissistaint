import { S3Client } from '@aws-sdk/client-s3';

const createS3Client = (endpoint, accessKeyId, secretAccessKey) =>
  accessKeyId && secretAccessKey
    ? new S3Client({
        endpoint,
        region: 'us-east-1',
        forcePathStyle: true,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      })
    : null;

export const createMinioClients = (config) => {
  const app = createS3Client(config.minioEndpoint, config.minioAccessKey, config.minioSecretKey);
  const removal = createS3Client(
    config.minioEndpoint,
    config.minioRemovalAccessKey,
    config.minioRemovalSecretKey,
  );

  if (!app) {
    console.warn(
      'MINIO_APP_ACCESS_KEY/MINIO_APP_SECRET_KEY are not set. Project bucket operations will fail until scoped app credentials are available.',
    );
  }

  if (!removal) {
    console.warn(
      'MINIO_REMOVAL_ACCESS_KEY/MINIO_REMOVAL_SECRET_KEY are not set. Project deletion bucket lockdown will fail until scoped removal credentials are available.',
    );
  }

  return { app, removal };
};
