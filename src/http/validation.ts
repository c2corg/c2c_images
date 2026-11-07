import createHttpError from 'http-errors';
import { z } from 'zod';

import { RESIZING_CONFIG } from '../config.js';

// <seconds since epoch>_<random number>, optionally a thumbnail suffix. The random number is not zero padded in the
// keys made by v6_images (up to 2^31 - 1), so its length varies.
export const keyRegex = new RegExp(
  `^\\d+_\\d+(${RESIZING_CONFIG.map(({ suffix }) => suffix).join('|')})?\\.(jpg|png|gif|svg)$`
);

const FilenameSchema = z.string().regex(keyRegex);

export const UploadFiles = z.object({
  file: z.custom<Express.Multer.File>(
    value => typeof value === 'object' && value !== null && 'size' in value && (value as { size: number }).size > 0
  )
});

export const PublishBody = z.object({
  filename: FilenameSchema
});

export const DeleteBody = z.object({
  filenames: z
    .union([FilenameSchema, FilenameSchema.array().nonempty()])
    .transform(value => (Array.isArray(value) ? value : [value]))
});

export const RotateBody = z.object({
  rotation: z.enum(['-90', '90', '180']).optional(),
  filename: FilenameSchema
});

// a missing value is reported as such, the other errors keep the messages of zod
const missingIsRequired = (issue: { input: unknown }): string | undefined =>
  issue.input === undefined ? 'Required' : undefined;

export const validate = <T extends z.ZodObject>(input: unknown, schema: T): z.output<T> => {
  const result = schema.safeParse(input, { error: missingIsRequired });
  if (result.success) {
    return result.data;
  }

  const { fieldErrors, formErrors } = z.flattenError(result.error);
  throw createHttpError(
    400,
    formErrors.length
      ? `Missing parameters. Expected values are { ${Object.keys(schema.shape).join(', ')} }`
      : Object.entries(fieldErrors)
          .map(([parameter, messages]) => `Bad parameter ${parameter}: ${messages?.join(' ') || '(unknown error)'}.`)
          .join('\n')
  );
};
