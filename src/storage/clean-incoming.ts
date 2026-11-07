import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  type DeleteObjectsCommandOutput,
  type ListObjectsV2CommandOutput,
  type S3Client
} from '@aws-sdk/client-s3';

// the commands sent by cleanIncoming, so that tests can answer them
type Client = Pick<S3Client, 'send'>;

/**
 * Deletes the files of the bucket older than `maxAge` ms, browsing all its pages. Returns the number of files deleted,
 * or that would be with `dryRun`; throws when some could not be.
 */
export const cleanIncoming = async (
  client: Client,
  bucket: string,
  maxAge: number,
  { now = Date.now(), pageSize = 1000, dryRun = false }: { now?: number; pageSize?: number; dryRun?: boolean } = {}
): Promise<number> => {
  let total = 0;
  let continuationToken: string | undefined;
  do {
    const page: ListObjectsV2CommandOutput = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        MaxKeys: pageSize,
        ...(continuationToken ? { ContinuationToken: continuationToken } : {})
      })
    );

    const keys = (page.Contents ?? [])
      .filter(({ Key, LastModified }) => Key && LastModified && LastModified.getTime() + maxAge < now)
      .map(({ Key }) => ({ Key }));

    if (dryRun) {
      total += keys.length;
    } else if (keys.length) {
      // DeleteObjects refuses an empty list
      const { Errors }: DeleteObjectsCommandOutput = await client.send(
        new DeleteObjectsCommand({ Bucket: bucket, Delete: { Quiet: true, Objects: keys } })
      );
      if (Errors?.length) {
        throw new Error(
          `${Errors.length} files could not be deleted: ${Errors.map(({ Key, Code }) => `${Key} (${Code})`).join(', ')}`
        );
      }
      total += keys.length;
    }

    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  return total;
};
