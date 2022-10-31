import type { File } from 'formidable';
import type { Context } from 'koa';
import { z, ZodObject, ZodRawShape } from 'zod';
import { API_SECRET_KEY, RESIZING_CONFIG } from '../config.js';

export const keyRegex = new RegExp(
  `^\\d{10}_\\d{10}(${RESIZING_CONFIG.map(({ suffix }) => suffix).join('|')})?\\.(jpg|png|gif|svg)$`
);

const FilenameSchema = z.string().refine(value => keyRegex.test(value));

export const ApiSecret = z.object({
  secret: z.string().refine(value => value === API_SECRET_KEY)
});

export const UploadFiles = z.object<{ file: z.ZodType<File> }>({
  file: z.any().refine((value: File) => value.size > 0)
});

export const PublishBody = z.object({
  filename: FilenameSchema
});

export const DeleteBody = z.object({
  filenames: FilenameSchema.or(FilenameSchema.array().nonempty()).transform(value =>
    Array.isArray(value) ? value : [value]
  )
});

export const RotateBody = z.object({
  rotation: z.enum(['-90', '90', '180']).optional(),
  filename: FilenameSchema
});

export const validate = <T extends ZodObject<ZodRawShape>>(
  ctx: Context,
  schema: T,
  property: 'files' | 'body' = 'body'
) => {
  const result = schema.safeParse(ctx.request[property]);
  if (result.success) {
    return result.data as z.infer<T>;
  }

  const { fieldErrors, formErrors } = result.error.flatten();
  ctx.throw(
    400,
    formErrors.length
      ? `Missing parameters. Expected values are { ${Object.values(schema.keyof().enum).join(', ')} }`
      : Object.entries(fieldErrors)
          .map(([parameter, message]) => `Bad parameter ${parameter}: ${message}.`)
          .join('\n')
  );
};
