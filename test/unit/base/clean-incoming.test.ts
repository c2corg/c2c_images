import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { describe, expect, test } from 'vitest';

import { cleanIncoming } from '../../../src/storage/clean-incoming.js';

const HOUR = 60 * 60 * 1000;
const now = Date.parse('2026-11-07T12:00:00Z');

// a bucket of files, listed by pages of `pageSize`, the commands received kept
interface FakeBucket {
  client: never;
  remaining: Map<string, Date>;
  commands: (ListObjectsV2Command | DeleteObjectsCommand)[];
}

const fakeBucket = (files: { key: string; age: number }[], errors: string[] = []): FakeBucket => {
  const remaining = new Map(files.map(({ key, age }) => [key, new Date(now - age)]));
  const commands: (ListObjectsV2Command | DeleteObjectsCommand)[] = [];
  const answer = (command: ListObjectsV2Command | DeleteObjectsCommand): unknown => {
    commands.push(command);
    if (command instanceof ListObjectsV2Command) {
      // as S3, the token points after the last key listed
      const after = command.input.ContinuationToken ?? '';
      const keys = [...remaining.keys()].sort().filter(key => key > after);
      const size = command.input.MaxKeys ?? 1000;
      const page = keys.slice(0, size);
      const truncated = keys.length > size;
      return {
        Contents: page.map(Key => ({ Key, LastModified: remaining.get(Key) })),
        IsTruncated: truncated,
        ...(truncated ? { NextContinuationToken: page.at(-1) } : {})
      };
    }
    const objects = command.input.Delete?.Objects ?? [];
    if (!objects.length) {
      throw new Error('MalformedXML');
    }
    const failed = objects.filter(({ Key }) => errors.includes(Key!));
    for (const { Key } of objects) {
      if (!errors.includes(Key!)) {
        remaining.delete(Key!);
      }
    }
    return failed.length ? { Errors: failed.map(({ Key }) => ({ Key, Code: 'AccessDenied' })) } : {};
  };
  const send = async (command: ListObjectsV2Command | DeleteObjectsCommand): Promise<unknown> =>
    Promise.resolve().then(() => answer(command));
  return { client: { send } as never, remaining, commands };
};

describe('cleanIncoming', () => {
  test('deletes the expired files of every page, also after a page without any', async () => {
    const { client, remaining, commands } = fakeBucket([
      { key: 'a', age: 1 * HOUR },
      { key: 'b', age: 1 * HOUR },
      { key: 'c', age: 3 * HOUR },
      { key: 'd', age: 5 * HOUR },
      { key: 'e', age: 1 * HOUR }
    ]);
    expect(await cleanIncoming(client, 'incoming', 2 * HOUR, { now, pageSize: 2 })).toBe(2);
    expect([...remaining.keys()]).toEqual(['a', 'b', 'e']);
    // no DeleteObjects without files
    const deletes = commands.filter(command => command instanceof DeleteObjectsCommand);
    expect(deletes.map(command => command.input.Delete?.Objects?.length)).toEqual([2]);
  });

  test('an empty bucket', async () => {
    const { client } = fakeBucket([]);
    expect(await cleanIncoming(client, 'incoming', 2 * HOUR, { now })).toBe(0);
  });

  test('throws when files could not be deleted', async () => {
    const { client } = fakeBucket([{ key: 'a', age: 3 * HOUR }], ['a']);
    await expect(cleanIncoming(client, 'incoming', 2 * HOUR, { now })).rejects.toThrow(
      '1 files could not be deleted: a (AccessDenied)'
    );
  });
});
