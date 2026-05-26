import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';

const loadSecretEncryptionKey = () => {
  const keyFile = process.env.SECRET_ENCRYPTION_KEY_FILE ?? '';
  let raw = '';
  if (keyFile && existsSync(keyFile)) {
    const mode = statSync(keyFile).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      throw new Error('SECRET_ENCRYPTION_KEY_FILE must not be readable by group or others.');
    }
    raw = readFileSync(keyFile, 'utf8').trim();
  } else if (process.env.SECRET_ENCRYPTION_KEY_ALLOW_ENV === 'true') {
    raw = process.env.SECRET_ENCRYPTION_KEY ?? '';
  }

  if (!raw) {
    return null;
  }

  const normalized = raw.trim();
  const key = /^[0-9a-f]{64}$/i.test(normalized)
    ? Buffer.from(normalized, 'hex')
    : Buffer.from(normalized, 'base64');
  if (key.length !== 32) {
    throw new Error('Secret encryption key must decode to 32 bytes.');
  }
  return key;
};

const tokenFingerprint = (token) => createHash('sha256').update(token).digest('hex').slice(0, 16);

export const createSecretsService = ({ config, deps }) => {
  const { openBao } = deps;
  const { openBaoPrefix, openBaoKvMount, secretStoreProvider, secretEncryptionKeyVersion } = config;

  const secretEncryptionKey = loadSecretEncryptionKey();

  const requireSecretEncryptionKey = () => {
    if (!secretEncryptionKey) {
      throw new Error('Secret encryption key is not configured on the backend.');
    }
    return secretEncryptionKey;
  };

  const encryptProviderToken = (token, associatedData) => {
    const key = requireSecretEncryptionKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(associatedData));
    const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return {
      encryptedToken: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      keyVersion: secretEncryptionKeyVersion,
      tokenFingerprint: tokenFingerprint(token),
    };
  };

  const decryptProviderToken = (record, associatedData) => {
    const key = requireSecretEncryptionKey();
    if (!record?.encryptedToken || !record?.iv || !record?.authTag) {
      throw new Error('Encrypted provider key record is incomplete.');
    }
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'base64'));
    decipher.setAAD(Buffer.from(associatedData));
    decipher.setAuthTag(Buffer.from(record.authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(record.encryptedToken, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  };

  const secretUserSegment = (user) =>
    encodeURIComponent(String(user?.sub ?? user?.preferred_username ?? 'unknown-user')).replace(
      /[!'()*]/g,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );

  const secretPath = (user, index) =>
    `${openBaoPrefix}/users/${secretUserSegment(user)}/llm/endpoints/${index + 1}`;
  const agentSkillRootPath = (user) => `${openBaoPrefix}/users/${secretUserSegment(user)}/agent`;
  const agentSkillIndexPath = (user) => `${agentSkillRootPath(user)}/skills/index`;
  const agentSkillPath = (user, skillId) =>
    `${agentSkillRootPath(user)}/skills/${encodeURIComponent(skillId)}`;
  const agentProjectSkillBindingsPath = (user, projectId) =>
    `${agentSkillRootPath(user)}/projects/${encodeURIComponent(projectId)}/skills`;
  const plannerRootPath = (user) => `${openBaoPrefix}/users/${secretUserSegment(user)}/planner`;
  const plannerDefaultPath = (user) => `${plannerRootPath(user)}/default`;
  const plannerProjectPath = (user, projectId) =>
    `${plannerRootPath(user)}/projects/${encodeURIComponent(projectId)}`;
  const providerTokenAad = (path) => `${secretStoreProvider}:${path}:provider-token`;
  const dataApiPath = (user, index) => `/v1/${openBaoKvMount}/data/${secretPath(user, index)}`;
  const metadataApiPath = (user, index) => `/v1/${openBaoKvMount}/metadata/${secretPath(user, index)}`;
  const aliasPath = (alias) => `${openBaoPrefix}/litellm/aliases/${encodeURIComponent(alias)}`;

  const read = (path) => openBao.read(path);
  const write = (path, data) => openBao.write(path, data);
  const deleteMetadata = (path) => openBao.deleteMetadata(path);
  const readMetadataForEndpoint = (user, index) => openBao.fetchOptional(metadataApiPath(user, index));

  return {
    encryptProviderToken,
    decryptProviderToken,
    tokenFingerprint,
    secretUserSegment,
    secretPath,
    agentSkillRootPath,
    agentSkillIndexPath,
    agentSkillPath,
    agentProjectSkillBindingsPath,
    plannerRootPath,
    plannerDefaultPath,
    plannerProjectPath,
    providerTokenAad,
    dataApiPath,
    metadataApiPath,
    aliasPath,
    read,
    write,
    deleteMetadata,
    readMetadataForEndpoint,
    secretEncryptionKey,
    secretStoreProvider,
    openBaoKvMount,
  };
};
