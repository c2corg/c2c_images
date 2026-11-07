import {
  GetBucketLifecycleConfigurationCommand,
  PutBucketLifecycleConfigurationCommand,
  type GetBucketLifecycleConfigurationCommandOutput,
  type LifecycleRule,
  type S3Client
} from '@aws-sdk/client-s3';

type Client = Pick<S3Client, 'send'>;

export const RULE_ID = 'c2c_images-incoming-expiration';

/**
 * The expiration of the incoming bucket by the S3 service:
 * - `rule`: an enabled rule expires the files of the whole bucket, after `days`;
 * - `other-rules`: the bucket has rules, none of them expiring the whole bucket: left as they are;
 * - `none`: lifecycle rules are supported, the bucket has none;
 * - `unsupported`: not available (Exoscale: Early Access, enabled by its support), or not allowed to these keys.
 */
export type IncomingLifecycle =
  | { state: 'rule'; days: number }
  | { state: 'other-rules' }
  | { state: 'none' }
  | { state: 'unsupported'; reason: string };

// a rule for the whole bucket: no filter, an empty prefix, or an empty filter
const appliesToWholeBucket = ({ Filter, Prefix }: LifecycleRule): boolean =>
  !Prefix && (!Filter || (!Filter.Prefix && !Filter.Tag && !Filter.And && Filter.ObjectSizeGreaterThan === undefined));

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : typeof error === 'string' ? error : 'unknown error';

export const getIncomingLifecycle = async (client: Client, bucket: string): Promise<IncomingLifecycle> => {
  let rules: LifecycleRule[];
  try {
    const output: GetBucketLifecycleConfigurationCommandOutput = await client.send(
      new GetBucketLifecycleConfigurationCommand({ Bucket: bucket })
    );
    rules = output.Rules ?? [];
  } catch (error) {
    if (errorName(error) === 'NoSuchLifecycleConfiguration') {
      return { state: 'none' };
    }
    return { state: 'unsupported', reason: errorName(error) };
  }
  if (!rules.length) {
    return { state: 'none' };
  }
  const expiration = rules.find(
    rule => rule.Status === 'Enabled' && rule.Expiration?.Days !== undefined && appliesToWholeBucket(rule)
  );
  return expiration?.Expiration?.Days !== undefined
    ? { state: 'rule', days: expiration.Expiration.Days }
    : { state: 'other-rules' };
};

/**
 * Creates the rule expiring the files of the incoming bucket after `days` (S3 counts in days), when the bucket has no
 * rules. Never replaces existing rules: PutBucketLifecycleConfiguration replaces the whole configuration.
 */
export const createIncomingRule = async (client: Client, bucket: string, days: number): Promise<void> => {
  await client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: bucket,
      LifecycleConfiguration: {
        Rules: [{ ID: RULE_ID, Status: 'Enabled', Filter: { Prefix: '' }, Expiration: { Days: days } }]
      }
    })
  );
};
