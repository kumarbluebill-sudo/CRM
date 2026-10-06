import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/** Private object storage behind a small interface so the provider can change and tests can fake it. */
export interface StorageProvider {
  put(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Short-lived URL for downloading one object. */
  signedUrl(path: string, expiresInSeconds: number, downloadName?: string): Promise<string>;
  remove(path: string): Promise<void>;
}

export const DOCUMENTS_BUCKET = "documents";
export class StorageUnavailableError extends Error {}

export function getStorage(): StorageProvider {
  const admin = createAdminClient();
  if (!admin) throw new StorageUnavailableError("Document storage is not configured.");
  const bucket = admin.storage.from(DOCUMENTS_BUCKET);
  return {
    async put(path, bytes, contentType) {
      const { error } = await bucket.upload(path, bytes, { contentType, upsert: false });
      if (error) throw new Error(`storage put failed: ${error.message}`);
    },
    async signedUrl(path, expiresInSeconds, downloadName) {
      const { data, error } = await bucket.createSignedUrl(
        path,
        expiresInSeconds,
        downloadName ? { download: downloadName } : undefined,
      );
      if (error || !data?.signedUrl) throw new Error("storage sign failed");
      return data.signedUrl;
    },
    async remove(path) {
      const { error } = await bucket.remove([path]);
      if (error) throw new Error(`storage remove failed: ${error.message}`);
    },
  };
}
