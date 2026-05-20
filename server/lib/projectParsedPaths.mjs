import { basename } from 'node:path';

export const parsedStemFromObjectKey = (objectKey) => {
  const fileName = basename(String(objectKey ?? ''));
  return fileName.replace(/\.pdf$/i, '') || fileName;
};

export const parsedArtifactPrefix = (project, stem) => {
  const parsedPrefix = String(project.parsedPrefix ?? 'parsed').replace(/^\/+|\/+$/g, '') || 'parsed';
  return `${parsedPrefix}/${stem}/`;
};

export const processLogObjectKey = (project, stem) => `${parsedArtifactPrefix(project, stem)}process.log`;

export const processStatusObjectKey = (project, stem) => `${parsedArtifactPrefix(project, stem)}processing.status.json`;
