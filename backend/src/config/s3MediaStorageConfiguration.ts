import type { S3MediaStorageConfiguration } from "../media/infrastructure/s3MediaStorage.js";

export class S3MediaStorageConfigurationError extends Error {}

function required(environment: NodeJS.ProcessEnv, name: string): string { const value = environment[name]?.trim(); if (!value) throw new S3MediaStorageConfigurationError(`S3 media configuration is invalid for ${name}.`); return value; }

export function s3MediaStorageConfiguration(environment: NodeJS.ProcessEnv = process.env): S3MediaStorageConfiguration {
  if (environment.ATLAS_MEDIA_STORAGE_PROVIDER?.trim() !== "s3") throw new S3MediaStorageConfigurationError("S3 media storage requires ATLAS_MEDIA_STORAGE_PROVIDER=s3.");
  const endpoint = required(environment, "ATLAS_S3_ENDPOINT");
  try { const url = new URL(endpoint); if (url.protocol !== "https:" || !url.hostname) throw new Error(); }
  catch { throw new S3MediaStorageConfigurationError("S3 media configuration is invalid for ATLAS_S3_ENDPOINT."); }
  const region = required(environment, "ATLAS_S3_REGION"), bucket = required(environment, "ATLAS_S3_BUCKET"), accessKeyId = required(environment, "ATLAS_S3_ACCESS_KEY_ID"), secretAccessKey = required(environment, "ATLAS_S3_SECRET_ACCESS_KEY");
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(bucket)) throw new S3MediaStorageConfigurationError("S3 media configuration is invalid for ATLAS_S3_BUCKET.");
  return Object.freeze({ endpoint, region, bucket, accessKeyId, secretAccessKey });
}
