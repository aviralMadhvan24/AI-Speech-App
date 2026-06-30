/**
 * Video storage boundary for the Mock Interview MVP.
 *
 * Uploaded answer videos are written to local disk for the MVP, but every
 * consumer (the submissions router) talks to the `VideoStore` interface rather
 * than the filesystem directly. This keeps the storage backend swappable — for
 * example moving to S3 presigned URLs later is a localized change to a single
 * implementation, with no router changes.
 *
 * Security note (see design): files live under an `/uploads` directory that is
 * served only through an authenticated streaming route, never as a public
 * static directory. To keep that guarantee, `getStream` resolves stored paths
 * strictly within the uploads directory and rejects any path traversal.
 */

import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

/**
 * An uploaded file as accepted by {@link VideoStore.save}.
 *
 * The shape is intentionally compatible with how multipart upload middleware
 * (e.g. Multer) hands files to a route in Task 7.2: memory storage provides a
 * `buffer`, disk storage provides a `path`. At least one of the two must be
 * present; `originalname` is used only to preserve the file extension.
 */
export interface UploadedFile {
  /** Original client file name; used to derive the stored extension. */
  originalname: string;
  /** In-memory file contents (multipart memory storage). */
  buffer?: Buffer;
  /** Path to a temporary file on disk (multipart disk storage). */
  path?: string;
}

/**
 * Abstraction over where answer videos are persisted (Requirements 3.4, 4.2).
 */
export interface VideoStore {
  /**
   * Persist an uploaded video and return an opaque storage path/identifier
   * that can later be passed to {@link getStream}. The returned value is what
   * callers store as `Submission.videoPath`.
   */
  save(file: UploadedFile): Promise<string>;

  /**
   * Open a readable stream for a previously saved video, identified by the
   * path returned from {@link save}. Used for authenticated playback.
   */
  getStream(storedPath: string): ReadStream;
}

/** Default uploads directory: `backend/uploads`, resolved relative to this module. */
const DEFAULT_UPLOADS_DIR = path.resolve(__dirname, '..', 'uploads');

/**
 * Filesystem-backed {@link VideoStore}. Writes each upload to a uniquely named
 * file under the uploads directory and streams it back on demand.
 */
export class LocalVideoStore implements VideoStore {
  private readonly uploadsDir: string;

  /**
   * @param uploadsDir Directory to store videos in. Defaults to `backend/uploads`.
   */
  constructor(uploadsDir: string = DEFAULT_UPLOADS_DIR) {
    this.uploadsDir = path.resolve(uploadsDir);
  }

  /**
   * Write the uploaded file to disk under a unique name and return the stored
   * file name (relative identifier) for persistence as `Submission.videoPath`.
   */
  async save(file: UploadedFile): Promise<string> {
    const contents = await this.readContents(file);

    await mkdir(this.uploadsDir, { recursive: true });

    const extension = path.extname(file.originalname);
    const fileName = `${randomUUID()}${extension}`;
    const destination = path.join(this.uploadsDir, fileName);

    await writeFile(destination, contents);

    return fileName;
  }

  /**
   * Open a read stream for a stored video. The stored path is resolved within
   * the uploads directory and any attempt to escape it (absolute paths or `..`
   * traversal) is rejected.
   */
  getStream(storedPath: string): ReadStream {
    return createReadStream(this.resolveWithinUploads(storedPath));
  }

  /** Read the file contents from either an in-memory buffer or a temp path. */
  private async readContents(file: UploadedFile): Promise<Buffer> {
    if (file.buffer) {
      return file.buffer;
    }
    if (file.path) {
      return readFile(file.path);
    }
    throw new Error('UploadedFile must provide either a buffer or a path');
  }

  /**
   * Resolve a stored path safely inside the uploads directory. Only the base
   * file name is honoured, so traversal segments (`..`) and absolute paths
   * cannot reach outside the uploads directory.
   */
  private resolveWithinUploads(storedPath: string): string {
    const fileName = path.basename(storedPath);
    const resolved = path.resolve(this.uploadsDir, fileName);

    const root = this.uploadsDir.endsWith(path.sep)
      ? this.uploadsDir
      : this.uploadsDir + path.sep;
    if (resolved !== this.uploadsDir && !resolved.startsWith(root)) {
      throw new Error(`Refusing to access path outside uploads directory: ${storedPath}`);
    }

    return resolved;
  }
}
