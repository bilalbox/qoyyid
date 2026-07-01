import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Env } from "./types";

let cachedClient: S3Client | undefined;

function getS3Client(env: Env) {
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: "auto",
      endpoint: `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return cachedClient;
}

export async function generatePresignedPutUrl(env: Env, key: string, contentType: string): Promise<string> {
  const client = getS3Client(env);
  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });
  // URL valid for 1 hour
  return getSignedUrl(client, command, { expiresIn: 3600 });
}

export async function generatePresignedGetUrl(env: Env, key: string): Promise<string> {
  const client = getS3Client(env);
  const command = new GetObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: key,
  });
  // Valid longer than the 24h batch timeout (see submitBatchAudioJob) so the
  // URL doesn't expire out from under a job that starts fetching near the end
  // of its timeout window.
  return getSignedUrl(client, command, { expiresIn: 30 * 3600 });
}
