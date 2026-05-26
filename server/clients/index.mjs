import { createRemoteJWKSet } from 'jose';
import { createLogger } from '../lib/serverUtils.mjs';
import { createPostgresPool } from './postgres.mjs';
import { createMinioClients } from './minio.mjs';
import { createOpenBaoClient } from './openbao.mjs';
import { createLiteLlmClient } from './litellm.mjs';
import { createGooseAcpClientFactory } from './gooseAcp.mjs';

export const createDependencies = (config) => {
  const log = createLogger();

  const projectDb = createPostgresPool(config);
  const minio = createMinioClients(config);
  const openBao = createOpenBaoClient({ config, log });
  const litellm = createLiteLlmClient({ config, log });
  const gooseAcp = createGooseAcpClientFactory({ config });
  const jwks = createRemoteJWKSet(new URL(config.keycloakJwksUrl));

  return {
    log,
    projectDb,
    minio,
    openBao,
    litellm,
    gooseAcp,
    jwks,
  };
};
