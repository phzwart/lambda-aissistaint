import { listProjectFiles, uploadProjectFiles } from '../lib/projectFiles.mjs';

export const createProjectFilesService = ({ services }) => {
  const { projects } = services;

  const listFiles = async (project) => {
    const client = projects.requireProjectMinio(project);
    return listProjectFiles(client, project);
  };

  const uploadFiles = async (project, uploads) => {
    const client = projects.requireProjectMinio(project);
    return uploadProjectFiles(client, project, uploads);
  };

  return {
    listFiles,
    uploadFiles,
  };
};
