import aws, { S3 } from 'aws-sdk';
import fs from 'node:fs';
import path from 'node:path';
import sanitize from 'sanitize-filename';
import { CACHE_CONTROL, S3_EXPIRE_HOURS, STORAGE_BACKEND, TEMP_FOLDER } from './config.js';
import { getMimeTypeFromKey } from './filetype.js';

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
    return fs.existsSync(this.path(key));
  }

  public async get(key: string): Promise<Buffer> {
    return fs.readFileSync(this.path(key));
  }

  public async put(key: string, originalFilePath: string): Promise<void> {
    return fs.copyFileSync(originalFilePath, this.path(key));
  }

  public async delete(key: string): Promise<void> {
    return fs.unlinkSync(this.path(key));
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
    return fs.statSync(this.path(key)).mtime;
  }
}

interface S3Params {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
}

export class S3Storage implements Storage {
  readonly #bucketName: string;
  readonly #client: aws.S3;
  readonly #shouldExpire: boolean;
  readonly #defaultACL: S3.ObjectCannedACL;

  constructor(bucketName: string, params: S3Params, defaulACL: S3.ObjectCannedACL, shouldExpire = false) {
    this.#bucketName = bucketName;
    this.#shouldExpire = shouldExpire;
    this.#defaultACL = defaulACL;
    this.#client = new aws.S3({
      ...params,
      sslEnabled: true,
      signatureVersion: 'v4',
      s3ForcePathStyle: true
    });
  }

  public async exists(key: string): Promise<boolean> {
    try {
      await this.#client
        .headObject({
          Bucket: this.#bucketName,
          Key: key
        })
        .promise();
      return true;
    } catch {
      return false;
    }
  }

  public async get(key: string): Promise<Buffer> {
    return this.#client
      .getObject({
        Bucket: this.#bucketName,
        Key: key
      })
      .promise()
      .then(output => output.Body as Buffer);
  }

  public async put(key: string, originalFilePath: string): Promise<void> {
    const buffer = fs.readFileSync(originalFilePath);
    const expires = this.#shouldExpire ? new Date(Date.now() + S3_EXPIRE_HOURS * 1000 * 60 * 60) : undefined;
    return this.#client
      .putObject({
        Bucket: this.#bucketName,
        Key: key,
        Body: buffer,
        Expires: expires,
        CacheControl: CACHE_CONTROL,
        ACL: this.#defaultACL,
        ContentType: getMimeTypeFromKey(key)
      })
      .promise()
      .then(() => undefined);
  }

  public async delete(key: string): Promise<void> {
    return this.#client
      .deleteObject({
        Bucket: this.#bucketName,
        Key: key
      })
      .promise()
      .then(() => undefined);
  }

  public async copy(key: string, destinationStorage: Storage): Promise<void> {
    if (destinationStorage instanceof S3Storage) {
      return this.#client
        .copyObject({
          Bucket: destinationStorage.#bucketName,
          Key: key,
          CopySource: `/${this.#bucketName}/${key}`,
          CacheControl: CACHE_CONTROL,
          ACL: destinationStorage.#defaultACL,
          ContentType: getMimeTypeFromKey(key)
        })
        .promise()
        .then(() => undefined);
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
    return this.#client
      .headObject({
        Bucket: this.#bucketName,
        Key: key
      })
      .promise()
      .then(({ LastModified }) => LastModified);
  }
}

export const getS3Params = (prefix: string) => {
  const PREFIX = process.env[`${prefix}_PREFIX`];
  const ENDPOINT = process.env[`${PREFIX}_ENDPOINT`];
  const ACCESS_KEY_ID = process.env[`${PREFIX}_ACCESS_KEY_ID`];
  const SECRET_KEY = process.env[`${PREFIX}_SECRET_KEY`];
  const DEFAULT_REGION = process.env[`${PREFIX}_DEFAULT_REGION`];

  if (!PREFIX) {
    throw new Error(`${prefix}_PREFIX must be defined`);
  }
  if (!ENDPOINT || !ACCESS_KEY_ID || !SECRET_KEY) {
    throw new Error(`${PREFIX}_ENDPOINT, ${PREFIX}_ACCESS_KEY_ID and ${PREFIX}_SECRET_KEY must be defined`);
  }

  return {
    endpoint: ENDPOINT,
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_KEY,
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
  incomingStorage = new S3Storage(process.env['INCOMING_BUCKET'], getS3Params('INCOMING'), 'private', true);
  activeStorage = new S3Storage(process.env['ACTIVE_BUCKET'], getS3Params('ACTIVE'), 'public-read');
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
