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
