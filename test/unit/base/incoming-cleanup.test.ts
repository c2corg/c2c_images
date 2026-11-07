import {
  DeleteObjectsCommand,
  GetBucketLifecycleConfigurationCommand,
  ListObjectsV2Command,
  PutBucketLifecycleConfigurationCommand,
  type LifecycleRule
} from '@aws-sdk/client-s3';
import { describe, expect, test, vi } from 'vitest';

import { startIncomingCleanup, type IncomingCleanupOptions } from '../../../src/storage/incoming-cleanup.js';
import { getIncomingLifecycle, RULE_ID } from '../../../src/storage/incoming-lifecycle.js';

const s3Error = (name: string): Error => Object.assign(new Error(name), { name });

type Command =
  | GetBucketLifecycleConfigurationCommand
  | PutBucketLifecycleConfigurationCommand
  | ListObjectsV2Command
  | DeleteObjectsCommand;

// a bucket answering its lifecycle configuration as given, with 1 old file and 1 recent one
const fakeBucket = (lifecycle: LifecycleRule[] | Error, putError?: Error): { client: never; commands: Command[] } => {
  const commands: Command[] = [];
  const send = vi.fn(async (command: Command): Promise<unknown> => {
    commands.push(command);
    await Promise.resolve();
    if (command instanceof GetBucketLifecycleConfigurationCommand) {
      if (lifecycle instanceof Error) {
        throw lifecycle;
      }
      return { Rules: lifecycle };
    }
    if (command instanceof PutBucketLifecycleConfigurationCommand) {
      if (putError) {
        throw putError;
      }
      return {};
    }
    if (command instanceof ListObjectsV2Command) {
      return {
        Contents: [
          { Key: 'old.jpg', LastModified: new Date(Date.now() - 48 * 3600e3) },
          { Key: 'new.jpg', LastModified: new Date() }
        ],
        IsTruncated: false
      };
    }
    return {};
  });
  return { client: { send } as never, commands };
};

const log = { info: vi.fn(), error: vi.fn() };
const options: IncomingCleanupOptions = { mode: 'auto', maxAgeHours: 24, intervalMinutes: 60, dryRun: false };
const expiration = (days: number, extra: Partial<LifecycleRule> = {}): LifecycleRule => ({
  ID: 'x',
  Status: 'Enabled',
  Filter: { Prefix: '' },
  Expiration: { Days: days },
  ...extra
});

describe('getIncomingLifecycle', () => {
  test.each([
    ['an expiration rule of the whole bucket', [expiration(2)], { state: 'rule', days: 2 }],
    ['a rule without filter', [expiration(1, { Filter: undefined })], { state: 'rule', days: 1 }],
    ['a disabled rule', [expiration(1, { Status: 'Disabled' })], { state: 'other-rules' }],
    ['a rule of a prefix', [expiration(1, { Filter: { Prefix: 'tmp/' } })], { state: 'other-rules' }],
    ['an empty configuration', [], { state: 'none' }],
    ['no configuration', s3Error('NoSuchLifecycleConfiguration'), { state: 'none' }],
    ['not implemented', s3Error('NotImplemented'), { state: 'unsupported', reason: 'NotImplemented' }],
    ['access denied', s3Error('AccessDenied'), { state: 'unsupported', reason: 'AccessDenied' }]
  ])('%s', async (_, lifecycle, expected) => {
    expect(await getIncomingLifecycle(fakeBucket(lifecycle).client, 'incoming')).toEqual(expected);
  });
});

describe('startIncomingCleanup', () => {
  const sent = (commands: Command[], type: abstract new (...args: never[]) => Command): Command[] =>
    commands.filter(command => command instanceof type);

  test('off: nothing', async () => {
    const { client, commands } = fakeBucket([]);
    expect((await startIncomingCleanup(client, 'incoming', { ...options, mode: 'off' }, log)).by).toBe('off');
    expect(commands).toEqual([]);
  });

  test('a rule exists: left to the bucket', async () => {
    const { client, commands } = fakeBucket([expiration(3)]);
    expect((await startIncomingCleanup(client, 'incoming', options, log)).by).toBe('rule');
    expect(sent(commands, PutBucketLifecycleConfigurationCommand)).toEqual([]);
    expect(sent(commands, DeleteObjectsCommand)).toEqual([]);
  });

  test('no rules: the rule is created, in days', async () => {
    const { client, commands } = fakeBucket(s3Error('NoSuchLifecycleConfiguration'));
    expect((await startIncomingCleanup(client, 'incoming', { ...options, maxAgeHours: 30 }, log)).by).toBe('rule');
    const [put] = sent(commands, PutBucketLifecycleConfigurationCommand) as PutBucketLifecycleConfigurationCommand[];
    expect(put?.input.LifecycleConfiguration?.Rules).toEqual([
      { ID: RULE_ID, Status: 'Enabled', Filter: { Prefix: '' }, Expiration: { Days: 2 } }
    ]);
  });

  test.each([
    ['lifecycle unsupported', s3Error('NotImplemented'), undefined, 0],
    ['other rules, left as they are', [expiration(1, { Filter: { Prefix: 'tmp/' } })], undefined, 0],
    ['the rule cannot be created', s3Error('NoSuchLifecycleConfiguration'), s3Error('AccessDenied'), 1]
  ])('%s: cleaned by the service', async (_, lifecycle, putError, puts) => {
    const { client, commands } = fakeBucket(lifecycle, putError);
    const { by, stop } = await startIncomingCleanup(client, 'incoming', options, log);
    stop();
    expect(by).toBe('service');
    await vi.waitFor(() => {
      expect(sent(commands, DeleteObjectsCommand)).toHaveLength(1);
    });
    const [deletion] = sent(commands, DeleteObjectsCommand) as DeleteObjectsCommand[];
    expect(deletion?.input.Delete?.Objects).toEqual([{ Key: 'old.jpg' }]);
    expect(sent(commands, PutBucketLifecycleConfigurationCommand)).toHaveLength(puts);
  });

  test('dry run: neither rule nor deletion', async () => {
    const { client, commands } = fakeBucket(s3Error('NoSuchLifecycleConfiguration'));
    const { by, stop } = await startIncomingCleanup(client, 'incoming', { ...options, dryRun: true }, log);
    stop();
    expect(by).toBe('service');
    await vi.waitFor(() => {
      expect(log.info).toHaveBeenCalledWith('Incoming bucket incoming: 1 files would be deleted (dry run)');
    });
    expect(sent(commands, PutBucketLifecycleConfigurationCommand)).toEqual([]);
    expect(sent(commands, DeleteObjectsCommand)).toEqual([]);
  });
});
