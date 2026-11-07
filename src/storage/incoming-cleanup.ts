import type { S3Client } from '@aws-sdk/client-s3';

import { incomingCleanupDeleted, incomingCleanupInfo } from '../metrics/prometheus.js';

import { cleanIncoming } from './clean-incoming.js';
import { createIncomingRule, getIncomingLifecycle } from './incoming-lifecycle.js';

type Client = Pick<S3Client, 'send'>;

export interface IncomingCleanupOptions {
  mode: 'auto' | 'off';
  maxAgeHours: number;
  intervalMinutes: number;
  dryRun: boolean;
}

interface Logger {
  info: (message: string) => void;
  error: (message: string, error?: unknown) => void;
}

const HOUR = 60 * 60 * 1000;

/**
 * Expires the files of the incoming bucket: by a lifecycle rule of the bucket when there is one, or after creating it
 * when the bucket has no rules; else by the service itself, every `intervalMinutes`. Returns how it is done, and a stop
 * function for the shutdown.
 */
export const startIncomingCleanup = async (
  client: Client,
  bucket: string,
  { mode, maxAgeHours, intervalMinutes, dryRun }: IncomingCleanupOptions,
  log: Logger
): Promise<{ by: 'off' | 'rule' | 'service'; stop: () => void }> => {
  const off = (by: 'off' | 'rule'): { by: 'off' | 'rule'; stop: () => void } => {
    incomingCleanupInfo.set({ by }, 1);
    return { by, stop: () => undefined };
  };
  const dryRunNote = dryRun ? ' (dry run)' : '';

  if (mode === 'off') {
    log.info(`Incoming bucket ${bucket}: no cleanup (INCOMING_CLEANUP=off)`);
    return off('off');
  }

  // S3 counts in days
  const days = Math.ceil(maxAgeHours / 24);
  const lifecycle = await getIncomingLifecycle(client, bucket);
  switch (lifecycle.state) {
    case 'rule':
      log.info(`Incoming bucket ${bucket}: its files expire by a lifecycle rule, after ${lifecycle.days} days`);
      return off('rule');
    case 'none':
      if (dryRun) {
        log.info(
          `Incoming bucket ${bucket}: would create a lifecycle rule expiring its files after ${days} days${dryRunNote}`
        );
        break;
      }
      try {
        await createIncomingRule(client, bucket, days);
        log.info(`Incoming bucket ${bucket}: lifecycle rule created, its files expire after ${days} days`);
        return off('rule');
      } catch (error) {
        log.error(`Incoming bucket ${bucket}: the lifecycle rule could not be created, the service cleans it`, error);
      }
      break;
    case 'other-rules':
      log.info(`Incoming bucket ${bucket}: lifecycle rules without expiration of the whole bucket, left as they are`);
      break;
    case 'unsupported':
      log.info(`Incoming bucket ${bucket}: no lifecycle rules (${lifecycle.reason})`);
      break;
  }

  log.info(
    `Incoming bucket ${bucket}: files older than ${maxAgeHours} h deleted by the service every ${intervalMinutes} min${dryRunNote}`
  );
  incomingCleanupInfo.set({ by: 'service' }, 1);
  let running = false;
  const run = async (): Promise<void> => {
    // a run of a big bucket may last longer than the interval
    if (running) {
      return;
    }
    running = true;
    try {
      const total = await cleanIncoming(client, bucket, maxAgeHours * HOUR, { dryRun });
      if (!dryRun) {
        incomingCleanupDeleted.inc(total);
      }
      log.info(`Incoming bucket ${bucket}: ${total} files ${dryRun ? 'would be deleted (dry run)' : 'deleted'}`);
    } catch (error) {
      log.error(`Incoming bucket ${bucket}: cleanup failed`, error);
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), intervalMinutes * 60 * 1000);
  timer.unref();
  return { by: 'service', stop: () => clearInterval(timer) };
};
