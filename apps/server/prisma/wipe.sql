-- Deletes every casualty record and all sync bookkeeping, keeping the schema and
-- the _prisma_migrations history. Run with `pnpm db:wipe` from the repository root.
--
-- card_change_seq is not reset: a client that still holds an old lastPullSeq
-- must keep receiving the cards written after the wipe.
TRUNCATE TABLE
  "InjurySite",
  "Tourniquet",
  "VitalSigns",
  "FluidAdministration",
  "Medication",
  "SyncConflict",
  "CasualtyCard",
  "ProcessedMutation",
  "Device";
