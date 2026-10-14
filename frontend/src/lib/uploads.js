import { AuthRedirectError } from '../api';

/** Settle every upload independently, retaining failed files for retry. */
export async function uploadFiles(files, upload) {
  const results = await Promise.allSettled(files.map((file) => upload(file)));
  const attachments = [];
  const errors = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') attachments.push(result.value);
    else
      errors.push({
        file: files[index],
        message: result.reason?.message || 'Upload failed',
        cause: result.reason,
      });
  });
  return { attachments, errors };
}
/** Merge settlement into the latest composer state without mutating either input. */
export function mergeUploadState(previous, files, result) {
  return {
    attachments: [...previous.attachments, ...result.attachments],
    errors: [
      ...previous.errors.filter((error) => !files.includes(error.file)),
      ...result.errors.filter((error) => !(error.cause instanceof AuthRedirectError)),
    ],
    authExpired: result.errors.some((error) => error.cause instanceof AuthRedirectError),
  };
}
