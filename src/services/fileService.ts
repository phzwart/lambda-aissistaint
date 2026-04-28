import type { ManagedFile } from '../types/domain';
import { mockDelay } from './mockDelay';

export const fileService = {
  async upload(files: FileList): Promise<ManagedFile[]> {
    await mockDelay();

    return Array.from(files).map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      uploadedAt: new Date().toISOString(),
      status: 'uploaded',
    }));
  },

  async process(files: ManagedFile[]): Promise<ManagedFile[]> {
    await mockDelay(900);

    return files.map((file) => ({
      ...file,
      status: 'completed',
    }));
  },
};
