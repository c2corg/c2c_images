import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ObjectCannedACL,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import fs, { constants, promises as fsPromises } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import sanitize from 'sanitize-filename';
import { CACHE_CONTROL, S3_EXPIRE_HOURS, STORAGE_BACKEND, TEMP_FOLDER } from '../config.js';
import { getMimeTypeFromKey } from '../image/filetype.js';

export abstract class Storage {
  abstract exists(key: string): Promise<boolean>;
  abstract get(key: string): Promise<Buffer>;
  abstract put(key: string, path: string): Promise<void>;
  abstract delete(key: string): Promise<void>;
  abstract copy(key: string, destinationStorage: Storage): Promise<void>;
  abstract move(key: string, destinationStorage: Storage): Promise<void>;
  abstract lastModified(key: string): Promise<Date | undefined>;
}

export class LocalStorage implements Storage {
  readonly #baseDirectory: string;

  constructor(baseDirectory: string) {
    this.#baseDirectory = baseDirectory;
    if (!fs.existsSync(baseDirectory)) {
      fs.mkdirSync(baseDirectory, { recursive: true });
    }
  }

  public path(key?: string) {
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
  region?: string;
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
    const expires = this.#shouldExpire ? new Date(Date.now() + S3_EXPIRE_HOURS * 1000 * 60 * 60) : undefined;
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

export const getS3Params = (prefix: string) => {
  const PREFIX = process.env[`${prefix}_PREFIX`];
  if (!PREFIX) {
    throw new Error(`${prefix}_PREFIX must be defined`);
  }

  const ENDPOINT = process.env[`${PREFIX}_ENDPOINT`];
  const ACCESS_KEY_ID = process.env[`${PREFIX}_ACCESS_KEY_ID`];
  const SECRET_KEY = process.env[`${PREFIX}_SECRET_KEY`];
  const DEFAULT_REGION = process.env[`${PREFIX}_DEFAULT_REGION`];
  if (!ENDPOINT || !ACCESS_KEY_ID || !SECRET_KEY) {
    throw new Error(`${PREFIX}_ENDPOINT, ${PREFIX}_ACCESS_KEY_ID and ${PREFIX}_SECRET_KEY must be defined`);
  }

  return {
    credentials: {
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_KEY
    },
    endpoint: ENDPOINT,
    region: DEFAULT_REGION
  };
};

const tempStorage = new LocalStorage(TEMP_FOLDER);
let incomingStorage: Storage;
let activeStorage: Storage;

if (STORAGE_BACKEND === 's3') {
  if (!process.env['INCOMING_BUCKET'] || !process.env['ACTIVE_BUCKET']) {
    throw new Error('INCOMING_BUCKET and ACTIVE_BUCKET must be defined');
  }
  incomingStorage = new S3Storage(
    process.env['INCOMING_BUCKET'],
    getS3Params('INCOMING'),
    ObjectCannedACL.private,
    true
  );
  activeStorage = new S3Storage(process.env['ACTIVE_BUCKET'], getS3Params('ACTIVE'), ObjectCannedACL.public_read);
} else if (process.env['STORAGE_BACKEND'] === 'local') {
  if (!process.env['INCOMING_FOLDER'] || !process.env['ACTIVE_FOLDER']) {
    throw new Error('INCOMING_FOLDER and ACTIVE_FOLDER must be defined');
  }
  incomingStorage = new LocalStorage(process.env['INCOMING_FOLDER']);
  activeStorage = new LocalStorage(process.env['ACTIVE_FOLDER']);
} else {
  throw new Error('STORAGE_BACKEND not supported or missing');
}
export { tempStorage, incomingStorage, activeStorage };
