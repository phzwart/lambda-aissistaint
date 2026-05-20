export type ParsedArtifactKind = 'text' | 'markdown' | 'json' | 'log';

export interface ParsedArtifactEntry {
  name: string;
  kind: ParsedArtifactKind;
  objectKey: string;
  size: number;
  lastModified: string | null;
  contentType: string;
}

export interface ParsedArtifactListing {
  fileId: string;
  fileName: string;
  stem: string;
  parsedPrefix: string;
  prefix: string;
  artifacts: ParsedArtifactEntry[];
}

export interface ParsedArtifactContent {
  fileId: string;
  fileName: string;
  name: string;
  kind: ParsedArtifactKind;
  objectKey: string;
  contentType: string;
  content: string;
}
