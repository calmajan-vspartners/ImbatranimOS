import { Equals, IsString, IsUUID } from 'class-validator';

/** What the backup archive carries at `.imbatranim/backup-staging/manifest.json`. */
export interface BackupManifest {
  /** Fixed marker. Restore refuses an archive without it. */
  product: 'ImbatranimOS';
  /** Bumped only when the layout below changes incompatibly. */
  manifestVersion: 1;
  /** ISO timestamp the backup was taken. */
  createdAt: string;
  /** `IMAGE_VERSION` of the image that produced it. */
  imageVersion: string;
  /** Absolute home path at backup time — informational, never used as a target. */
  home: string;
  /** Member path of the SQLite snapshot, relative to the archive root. */
  database: string;
  /** The `--exclude` patterns actually applied, so the omissions are not silent. */
  excluded: string[];
}

/** What `GET /api/backup/info` reports before the user commits to a download. */
export interface BackupInfo {
  /** Bytes on disk under the home root, from the bounded walk (a floor). */
  homeBytes: number;
  /** True when that walk hit its cap, so `homeBytes` understates the total. */
  homeBytesTruncated: boolean;
  databaseBytes: number;
  freeBytes: number;
  excluded: string[];
  suggestedFilename: string;
}

/** One top-level thing a restore would replace. */
export interface RestoreEntry {
  name: string;
  directory: boolean;
  /** Whether the home directory already has something by this name. */
  replacesExisting: boolean;
}

/** What `POST /api/backup/restore/inspect` reports before anything is applied. */
export interface RestorePreview {
  /** Opaque handle for the staged upload, consumed by `apply`. */
  id: string;
  manifest: BackupManifest;
  entries: RestoreEntry[];
  fileCount: number;
  /** Sum of the member sizes tar declares, i.e. what will land on disk. */
  totalBytes: number;
  freeBytes: number;
  /** False when `totalBytes` will not fit; `apply` refuses in that case. */
  fits: boolean;
}

export class RestoreApplyDto {
  @IsUUID('4', { message: 'Unknown or expired upload' })
  id!: string;

  /**
   * The typed confirmation, checked on the server as well as in the UI.
   *
   * The UI asks for it because restore is destructive; the server insists on it
   * because a UI check is not a guarantee — a stray POST to this route replaces
   * the user's entire home directory, and it should take more than a URL.
   */
  @IsString()
  @Equals('RESTORE', {
    message: 'Type RESTORE to confirm — this replaces your home directory',
  })
  confirm!: string;
}
