import fs, { constants, promises as fsPromises } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ObjectCannedACL,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import sanitize from 'sanitize-filename';
import { z } from 'zod';

import { CACHE_CONTROL, INCOMING_MAX_AGE_HOURS, STORAGE, TEMP_FOLDER } from '../config.js';
import { getMimeTypeFromKey } from '../image/filetype.js';

export abstract class Storage {
  public abstract exists(key: string): Promise<boolean>;
  public abstract get(key: string): Promise<Buffer>;
  public abstract put(key: string, path: string): Promise<void>;
  public abstract delete(key: string): Promise<void>;
  public abstract copy(key: string, destinationStorage: Storage): Promise<void>;
  public abstract move(key: string, destinationStorage: Storage): Promise<void>;
  public abstract lastModified(key: string): Promise<Date | undefined>;
}

export class LocalStorage implements Storage {
  readonly #baseDirectory: string;

  constructor(baseDirectory: string) {
    this.#baseDirectory = baseDirectory;
    if (!fs.existsSync(baseDirectory)) {
      fs.mkdirSync(baseDirectory, { recursive: true });
    }
  }

  public path(key?: string): string {
    return key ? path.resolve(this.#baseDirectory, sanitize(key)) : this.#baseDirectory;
  }

  public async exists(key: string): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      fs.access(this.path(key), constants.F_OK, err => resolve(!err));
    });
  }

  public async get(key: string): Promise<Buffer> {
    return fsPromises.readFile(this.path(key));
  }

  public async put(key: string, originalFilePath: string): Promise<void> {
    return fsPromises.copyFile(originalFilePath, this.path(key));
  }

  public async delete(key: string): Promise<void> {
    return fsPromises.unlink(this.path(key));
  }

  public async copy(key: string, destinationStorage: Storage): Promise<void> {
    if (destinationStorage instanceof LocalStorage) {
      return fs.copyFileSync(this.path(key), destinationStorage.path(key));
    } else if (destinationStorage instanceof S3Storage) {
      await destinationStorage.put(key, this.path(key));
    } else {
      throw new Error('Not implemented');
    }
  }

  public async move(key: string, destinationStorage: Storage): Promise<void> {
    if (destinationStorage instanceof LocalStorage) {
      return fs.renameSync(this.path(key), destinationStorage.path(key));
    } else if (destinationStorage instanceof S3Storage) {
      await destinationStorage.put(key, this.path(key));
      await this.delete(key);
    } else {
      throw new Error('Not implemented');
    }
  }

  public async lastModified(key: string): Promise<Date> {
    const stats = await fsPromises.stat(this.path(key));
    return stats.mtime;
  }
}

interface S3Params {
  endpoint: string;
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
  };
  region: string;
}

export class S3Storage implements Storage {
  readonly #endpoint: string;
  readonly #bucketName: string;
  readonly #client: S3Client;
  readonly #shouldExpire: boolean;
  readonly #defaultACL: ObjectCannedACL;

  constructor(bucketName: string, params: S3Params, defaulACL: ObjectCannedACL, shouldExpire = false) {
    this.#bucketName = bucketName;
    this.#shouldExpire = shouldExpire;
    this.#defaultACL = defaulACL;
    this.#endpoint = params.endpoint;
    this.#client = new S3Client({
      ...params,
      forcePathStyle: true
    });
  }

  public async exists(key: string): Promise<boolean> {
    try {
      await this.#client.send(
        new HeadObjectCommand({
          Bucket: this.#bucketName,
          Key: key
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  public async get(key: string): Promise<Buffer> {
    const { Body } = await this.#client.send(
      new GetObjectCommand({
        Bucket: this.#bucketName,
        Key: key
      })
    );

    const stream = Body as Readable;
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', chunk => chunks.push(chunk as Buffer));
      stream.once('end', () => resolve(Buffer.concat(chunks)));
      stream.once('error', reject);
    });
  }

  public async put(key: string, originalFilePath: string): Promise<void> {
    const buffer = fs.readFileSync(originalFilePath);
    const expires = this.#shouldExpire ? new Date(Date.now() + INCOMING_MAX_AGE_HOURS * 1000 * 60 * 60) : undefined;
    await this.#client.send(
      new PutObjectCommand({
        Bucket: this.#bucketName,
        Key: key,
        Body: buffer,
        Expires: expires,
        CacheControl: CACHE_CONTROL,
        ACL: this.#defaultACL,
        ContentType: getMimeTypeFromKey(key)
      })
    );
  }

  public async delete(key: string): Promise<void> {
    await this.#client.send(
      new DeleteObjectCommand({
        Bucket: this.#bucketName,
        Key: key
      })
    );
  }

  public async copy(key: string, destinationStorage: Storage): Promise<void> {
    if (destinationStorage instanceof S3Storage) {
      await this.#client.send(
        new CopyObjectCommand({
          Bucket: destinationStorage.#bucketName,
          Key: key,
          CopySource: `/${this.#bucketName}/${key}`,
          CacheControl: CACHE_CONTROL,
          ACL: destinationStorage.#defaultACL,
          ContentType: getMimeTypeFromKey(key)
        })
      );
    } else if (destinationStorage instanceof LocalStorage) {
      fs.writeFileSync(destinationStorage.path(key), await this.get(key));
    } else {
      throw new Error('Not implemented');
    }
  }

  public async move(key: string, destinationStorage: Storage): Promise<void> {
    await this.copy(key, destinationStorage);
    await this.delete(key);
  }

  public async lastModified(key: string): Promise<Date | undefined> {
    const { LastModified } = await this.#client.send(
      new HeadObjectCommand({
        Bucket: this.#bucketName,
        Key: key
      })
    );
    return LastModified;
  }

  public get baseUrl(): string {
    return `${this.#endpoint}/${this.#bucketName}`;
  }
}

// The variables of an S3 service: <prefix>_ENDPOINT, <prefix>_ACCESS_KEY_ID, <prefix>_SECRET_KEY, <prefix>_DEFAULT_REGION.
// The region is required: the AWS SDK sends no request without one ("Region is missing"), and it signs them with it
// (Exoscale: the zone, e.g. ch-dk-2).
export const getS3Params = (prefix: string): S3Params => {
  const result = z
    .object({
      [`${prefix}_ENDPOINT`]: z.url(),
      [`${prefix}_ACCESS_KEY_ID`]: z.string().min(1),
      [`${prefix}_SECRET_KEY`]: z.string().min(1),
      [`${prefix}_DEFAULT_REGION`]: z.string().min(1)
    })
    .safeParse(process.env);
  if (!result.success) {
    throw new Error(`Invalid configuration of the S3 service ${prefix}:\n${z.prettifyError(result.error)}`);
  }
  const { data } = result;

  return {
    credentials: {
      accessKeyId: data[`${prefix}_ACCESS_KEY_ID`] as string,
      secretAccessKey: data[`${prefix}_SECRET_KEY`] as string
    },
    endpoint: data[`${prefix}_ENDPOINT`] as string,
    region: data[`${prefix}_DEFAULT_REGION`] as string
  };
};

// a client of the S3 service of the incoming bucket, for its maintenance (cleanup, lifecycle)
export const incomingClient = (): S3Client => {
  if (STORAGE.STORAGE_BACKEND !== 's3') {
    throw new Error('STORAGE_BACKEND is not s3');
  }
  return new S3Client({ ...getS3Params(STORAGE.INCOMING_PREFIX), forcePathStyle: true });
};

const tempStorage = new LocalStorage(TEMP_FOLDER);
const incomingStorage: Storage =
  STORAGE.STORAGE_BACKEND === 's3'
    ? new S3Storage(STORAGE.INCOMING_BUCKET, getS3Params(STORAGE.INCOMING_PREFIX), ObjectCannedACL.private, true)
    : new LocalStorage(STORAGE.INCOMING_FOLDER);
const activeStorage: Storage =
  STORAGE.STORAGE_BACKEND === 's3'
    ? new S3Storage(STORAGE.ACTIVE_BUCKET, getS3Params(STORAGE.ACTIVE_PREFIX), ObjectCannedACL.public_read)
    : new LocalStorage(STORAGE.ACTIVE_FOLDER);

export { tempStorage, incomingStorage, activeStorage };
