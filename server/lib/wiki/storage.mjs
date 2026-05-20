// MinIO-backed storage for wiki pages and metadata sidecars.
//
// The storage layer is intentionally thin: it speaks S3 to the project bucket
// and knows nothing about the Markdown parsing or LLM synthesis. This lets us
// inspect, copy, or rsync the wiki as plain Markdown files later without
// taking a dependency on this codebase.

import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import {
  defaultWikiCategory,
  parseWikiPageKey,
  slugifyTitle,
  wikiCategories,
  wikiMetadataKey,
  wikiPageExtension,
  wikiPageKey,
} from './paths.mjs';

const decoder = new TextDecoder('utf-8');

const streamToString = async (body) => {
  if (!body) {
    return '';
  }
  if (typeof body.transformToString === 'function') {
    return body.transformToString('utf-8');
  }
  if (body instanceof Uint8Array) {
    return decoder.decode(body);
  }
  const chunks = [];
  for await (const chunk of body) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
};

const getObjectText = async (client, { bucket, key }) => {
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return await streamToString(result.Body);
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NoSuchKey') {
      return null;
    }
    throw error;
  }
};

const putObjectText = async (client, { bucket, key, body, contentType }) =>
  client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );

const listKeys = async (client, { bucket, prefix }) => {
  const keys = [];
  let continuationToken;
  do {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `${prefix}/`,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }),
    );
    for (const item of result.Contents ?? []) {
      if (item?.Key && item.Key.endsWith(wikiPageExtension)) {
        keys.push(item.Key);
      }
    }
    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
};

export const createWikiStorage = ({ client, bucket, wikiPrefix = 'wiki', metadataPrefix = 'metadata' }) => {
  if (!client) {
    throw new Error('Wiki storage requires a configured S3 client.');
  }
  if (!bucket) {
    throw new Error('Wiki storage requires a bucket name.');
  }

  const pageKey = (category, slug) =>
    wikiPageKey({ prefix: wikiPrefix, category, slug: slugifyTitle(slug) });

  return {
    bucket,
    wikiPrefix,
    metadataPrefix,

    pageKey,
    metadataKey: (name) => wikiMetadataKey({ prefix: metadataPrefix, name }),

    async readPageMarkdown(category, slug) {
      return getObjectText(client, { bucket, key: pageKey(category, slug) });
    },

    async writePageMarkdown(category, slug, markdown) {
      const key = pageKey(category, slug);
      await putObjectText(client, {
        bucket,
        key,
        body: markdown,
        contentType: 'text/markdown; charset=utf-8',
      });
      return key;
    },

    async deletePage(category, slug) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: pageKey(category, slug) }));
    },

    async listPageKeys() {
      return listKeys(client, { bucket, prefix: wikiPrefix });
    },

    async listPageRefs() {
      const keys = await listKeys(client, { bucket, prefix: wikiPrefix });
      return keys
        .map((key) => parseWikiPageKey(key, { prefix: wikiPrefix }))
        .filter(Boolean);
    },

    async readMetadataJson(name, fallback) {
      const text = await getObjectText(client, { bucket, key: wikiMetadataKey({ prefix: metadataPrefix, name }) });
      if (text === null) {
        return fallback ?? null;
      }
      try {
        return JSON.parse(text);
      } catch {
        return fallback ?? null;
      }
    },

    async writeMetadataJson(name, value) {
      await putObjectText(client, {
        bucket,
        key: wikiMetadataKey({ prefix: metadataPrefix, name }),
        body: JSON.stringify(value ?? {}, null, 2),
        contentType: 'application/json',
      });
    },
  };
};

export const supportedWikiCategories = wikiCategories;
export const defaultWikiCategoryName = defaultWikiCategory;
