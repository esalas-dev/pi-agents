import type { Context } from "@earendil-works/chord";
import { failure, DomainError, type Outcome } from "../domain/errors.ts";
import type { Clock, MigrationApproval } from "../domain/requests.ts";
import { acquireLease } from "../infrastructure/storage/lease.ts";
import { createBackup } from "../infrastructure/storage/backup.ts";
import { inspectStorage } from "../infrastructure/storage/inspect.ts";
import { migrateV1 } from "../infrastructure/storage/migrate.ts";

export type MigrationInfo = { dbPath: string; jobs: number; sourceHash: string; backupDirectory: string };
export type MaintenanceService = { migrate(options: { dbPath: string; confirm(info: MigrationInfo): Promise<MigrationApproval | undefined>; clock: Clock }): Promise<Outcome<{ schemaVersion: 2; migratedJobs: number }>> };

export function createMaintenanceService(context: Context): MaintenanceService {
  return {
    async migrate(options) {
      const lease = await acquireLease(options.dbPath);
      try {
        const inspection = await inspectStorage(lease, context);
        if (inspection.kind === "current") return { success: true, value: { schemaVersion: 2, migratedJobs: 0 } };
        if (inspection.kind === "empty") return failure(new DomainError("STORAGE_INCONSISTENT", "La base vacía aún no requiere migración."));
        const approval = await options.confirm({ dbPath: lease.dbPath, jobs: inspection.jobs, sourceHash: inspection.sourceHash, backupDirectory: `${lease.dbPath}.backups` });
        if (!approval) return failure(new DomainError("MIGRATION_DECLINED"));
        if (approval.actor.kind !== "human" || approval.dbPath !== lease.dbPath || approval.sourceHash !== inspection.sourceHash) return failure(new DomainError("INVALID_REQUEST"));
        const backup = await createBackup(lease, options.clock);
        return { success: true, value: await migrateV1(lease, approval, backup, context) };
      } catch (error) { return failure(error); }
      finally { await lease.release(); }
    },
  };
}
