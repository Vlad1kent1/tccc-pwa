# PLAN.md: Engineering Roadmap

**Thesis:** Development of an Offline-First PWA for Managing Medical Records in Field Conditions

**Domain standard:** TCCC Casualty Card (DD Form 1380)

**Stack (pnpm workspaces monorepo):**

| Layer | Technology | Location |
|---|---|---|
| Client | Next.js 16 (App Router), React 19, Tailwind CSS 4, react-hook-form | `apps/client` |
| Service worker / PWA | Serwist (`@serwist/next`, `serwist`) | `apps/client/src/app/sw.ts` |
| Local storage | Dexie.js 4 (IndexedDB) | `apps/client/src/lib/db` |
| Server | NestJS 12 | `apps/server` |
| ORM / DB | Prisma ORM + PostgreSQL 15 (Docker) | `apps/server/prisma`, `docker-compose.yml` |
| Shared contracts | Zod schemas, enums, sync DTOs | `packages/shared` (`@tccc/shared`) |
| Testing | Vitest, supertest, Playwright | `apps/*/test`, `e2e/` |

Each of the six thesis points below has a goal, concrete tasks as checkboxes, the files it touches, its deliverables (code plus a thesis artifact), and a definition of done (DoD).

---

## Table of contents

- [Phase 0: Repository housekeeping](#phase-0-repository-housekeeping)
- [Point 1: Domain analysis and requirements specification](#point-1-domain-analysis-and-requirements-specification)
- [Point 2: Review of PWA technologies and offline-first approaches](#point-2-review-of-pwa-technologies-and-offline-first-approaches)
- [Point 3: Data structures and local storage (DD Form 1380)](#point-3-data-structures-and-local-storage-dd-form-1380)
- [Point 4: Offline operation and synchronization](#point-4-offline-operation-and-synchronization)
- [Point 5: Core functional modules (create, view, edit)](#point-5-core-functional-modules-create-view-edit)
- [Point 6: Testing under offline and unstable network conditions](#point-6-testing-under-offline-and-unstable-network-conditions)
- [Cursor Composer prompt sequence](#cursor-composer-prompt-sequence)
- [Suggested timeline](#suggested-timeline)

---

## Phase 0: Repository housekeeping

**Goal:** a consistent, reproducible monorepo before feature work starts.

Issues found in the current repository:

- `apps/server/package.json` has `@prisma/client ^7.10.0` but the `prisma` CLI is `8.0.0-rc.15`. The client and CLI **must** be on the same version.
- `apps/client/pnpm-workspace.yaml` and `apps/client/pnpm-lock.yaml` are left over from `create-next-app`. They conflict with the root `pnpm-workspace.yaml` and root lockfile.
- `apps/server/prisma.config.ts` only configures `skills`. It has no `schema` path and no `datasource.url`.
- `apps/client/next.config.ts` is empty, so Serwist is not wired in yet.
- Next.js 16 builds with Turbopack by default, and `@serwist/next` has historically been webpack-based. This has to be settled with a spike (see Point 2).

Tasks:

- [x] Align `prisma` and `@prisma/client` to the same stable version. Add `@prisma/adapter-pg` and `pg` (the new `prisma-client` generator uses driver adapters).
- [x] Delete `apps/client/pnpm-workspace.yaml` and `apps/client/pnpm-lock.yaml`, then run `pnpm install` from the root.
- [x] Make sure the root `pnpm-workspace.yaml` lists `apps/*` and `packages/*`.
- [x] Create `packages/shared` (`@tccc/shared`) with `package.json`, `tsconfig.json`, and `src/index.ts`, built with `tsup` or consumed as TS source through `transpilePackages` in Next.
- [x] Add `.env.example` files:
  - `apps/server/.env.example`: `DATABASE_URL=postgresql://postgres:password@localhost:5432/tccc_medical_db`, `PORT=4000`, `CORS_ORIGIN=http://localhost:3000`
  - `apps/client/.env.example`: `NEXT_PUBLIC_API_URL=http://localhost:4000/api`
- [x] Update `apps/server/prisma.config.ts`:

```ts
import "dotenv/config";
import { definePrismaConfig } from "prisma/config";

export default definePrismaConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  datasource: { url: process.env.DATABASE_URL! },
  skills: { agents: ["claude", "cursor", "agents", "devin"] },
});
```

- [x] Add root `package.json` scripts:
  - `dev`: `pnpm -r --parallel --filter client --filter server dev`
  - `db:up`: `docker compose up -d db`
  - `db:migrate`: `pnpm --filter server exec prisma migrate dev`
  - `db:seed`: `pnpm --filter server exec prisma db seed`
  - `test`: `pnpm -r test`
  - `test:e2e`: `pnpm --filter e2e test`
- [x] Add a `db_test` service (port 5433) to `docker-compose.yml` for server e2e tests.
- [x] Add a root `README.md` section called "Getting started" (install, `db:up`, `db:migrate`, `dev`).

**DoD:** `pnpm install && pnpm db:up && pnpm db:migrate && pnpm dev` starts both apps with no version warnings.

---

## Point 1: Domain analysis and requirements specification

**Goal:** a formal, traceable specification of what the system must do in field conditions.

### 1.1 Domain analysis tasks

- [x] Describe the TCCC care phases (Care Under Fire, Tactical Field Care, TACEVAC) and where DD Form 1380 is filled in and handed over.
- [x] Build a **DD1380 field inventory**: every field on the card with its section, data type, allowed values, whether it is required, and how often it is recorded (once or repeated).
- [x] Identify operating constraints: no network or intermittent network, low battery, gloves, low light, stress, multiple casualties at once, shared devices.

### 1.2 Actors

| Actor | Main goals |
|---|---|
| Combat medic / first responder | Create a card at the point of injury quickly, record tourniquets, treatments and medications |
| Casualty Collection Point (CCP) medic | Take over cards, add serial vital signs, update treatments |
| Evacuation coordinator | See the evacuation queue sorted by priority (Urgent, Priority, Routine) |
| Medical administrator | Review synchronized records on the server, resolve sync conflicts |

### 1.3 Use cases (UC)

- UC-01 Create casualty card (offline)
- UC-02 Record a tourniquet application (limb, type, time)
- UC-03 Add a serial vital signs measurement
- UC-04 Record a treatment (circulation, airway, breathing, fluids, other)
- UC-05 Record a medication
- UC-06 Edit an existing card
- UC-07 View the casualty list sorted by evacuation priority
- UC-08 Synchronize with the server when the network returns
- UC-09 Review and resolve a sync conflict
- UC-10 Print or export a card (handover)

### 1.4 Functional requirements (examples, extend to the full list)

| ID | Requirement |
|---|---|
| FR-01 | The user can create, view, edit and soft-delete casualty cards without network access |
| FR-02 | The card covers DD1380 sections A, B, C, E, F, G and H |
| FR-03 | Multiple vital sign measurements per card, each with its own time |
| FR-04 | Tourniquet per limb (right/left arm, right/left leg) with type and time |
| FR-05 | Local changes are queued and synchronized automatically when the network returns |
| FR-06 | Each card shows a sync state: pending, synced, or conflict |
| FR-07 | Concurrent edits from different devices are merged. Overwritten values are kept for review |
| FR-08 | The casualty list can be sorted and filtered by evacuation priority and searched by name or battle roster # |
| FR-09 | The responder's default name and last 4 are saved in settings and prefilled into Section H |

### 1.5 Non-functional requirements (measurable)

| ID | Requirement | Target |
|---|---|---|
| NFR-01 | Offline operation | Full CRUD with 0 network for at least 72 h |
| NFR-02 | Data durability | 0 records lost across reloads, tab kills, browser restarts |
| NFR-03 | Input speed | Add a vitals set in at most 3 taps / 15 s |
| NFR-04 | Usability in the field | Touch targets of at least 48 px, dark / low-light theme, large fonts |
| NFR-05 | Sync performance | Fewer than 5 s to sync 50 cards on a "Fast 3G" profile |
| NFR-06 | Offline startup | App shell renders offline in under 2 s after installation |
| NFR-07 | Installability | Passes Lighthouse PWA installability checks |
| NFR-08 | Localization | Ukrainian and English UI |
| NFR-09 | Security (baseline) | HTTPS, CORS allow-list, server-side validation of every payload |
| NFR-10 | Security (stretch) | AES-GCM encryption of personal data at rest through Web Crypto |

### 1.6 Prioritization and traceability

- [x] MoSCoW prioritization of all FR and NFR items.
- [x] Traceability matrix: `Requirement -> Module / file -> Test case ID`. It is updated during Points 5 and 6.

**Deliverable:** `docs/requirements.md` (thesis chapter 1 source).

**DoD:** every DD1380 field required in Point 3 appears in the field inventory, and every FR has at least one planned test case.

---

## Point 2: Review of PWA technologies and offline-first approaches

**Goal:** a reasoned choice of technologies backed by small working prototypes (spikes).

### 2.1 Review topics

- [x] **PWA building blocks:** Web App Manifest, service worker lifecycle (install, activate, fetch), Cache Storage, installability criteria, update flow.
- [x] **Caching strategies:** CacheFirst, NetworkFirst, StaleWhileRevalidate, NetworkOnly, CacheOnly, and when each fits (app shell vs. static assets vs. API).
- [x] **Client storage options:** localStorage, Cache API, IndexedDB, OPFS. Storage quotas and eviction, `navigator.storage.persist()`.
- [x] **IndexedDB libraries:** Dexie.js vs. `idb` vs. RxDB vs. PouchDB. Compare API ergonomics, reactivity (`useLiveQuery`), migrations, bundle size, and sync features.
- [x] **Synchronization models:**
  - Custom outbox plus a REST push/pull protocol (chosen)
  - CouchDB/PouchDB replication
  - CRDTs (Yjs, Automerge)
  - Commercial sync services (for comparison only)
- [x] **Conflict resolution approaches:** last-writer-wins (record-level vs. field-level), vector clocks, Hybrid Logical Clocks (HLC), CRDTs, manual merge.
- [x] **Background Sync API** and Periodic Background Sync: browser support matrix (Chromium only; not supported on Safari/iOS) and fallback strategies.
- [x] **Service worker tooling:** Workbox vs. Serwist. Serwist integration with Next.js 16 (webpack vs. Turbopack).

### 2.2 Spikes (throwaway or reusable prototypes)

- [x] **Spike A, Serwist + Next 16:** check `@serwist/next` with `next build --webpack` against Serwist's Turbopack integration. Record which one is used and why. Read `apps/client/node_modules/next/dist/docs/` first (required by `apps/client/AGENTS.md`).
- [x] **Spike B, precache + offline fallback:** the app shell loads in airplane mode after the first visit, and an unknown navigation shows `/~offline`.
- [x] **Spike C, Dexie reactivity:** a list component using `useLiveQuery` that updates when a record is written from another tab.
- [x] **Spike D, installability:** manifest, 192/512 px icons plus a maskable icon, theme color. Run a Lighthouse audit and save the screenshot.

**Deliverable:** `docs/technology-review.md` with a comparison table and a justification for each choice (thesis chapter 2 source).

**DoD:** all four spikes demonstrated and their results written up.

---

## Point 3: Data structures and local storage (DD Form 1380)

**Goal:** a server schema (PostgreSQL/Prisma) and local schema (Dexie) that mirror DD Form 1380 and support offline creation and synchronization.

### 3.1 Design principles

1. **Aggregate = one casualty card.** `CasualtyCard` is the root. Injury sites, tourniquets, vital signs, fluids and medications are child rows. The whole aggregate is the unit of synchronization.
2. **Client-generated IDs.** All primary keys are UUIDv7, generated on the device (the `uuid` package, `v7()`), so records can be created offline and are roughly time-ordered.
3. **Deterministic tourniquet IDs.** `Tourniquet.id = uuidv5(cardId + ":" + limb, NAMESPACE)`. If two devices record a tourniquet on the same limb offline, they produce the same ID and merge instead of violating `@@unique([cardId, limb])`.
4. **Sync metadata on every synced row:**
   - `clientUpdatedAt`: HLC string (Hybrid Logical Clock), used for last-writer-wins.
   - `deletedAt`: tombstone (soft delete), so deletions propagate.
   - Card-level `version` (optimistic concurrency) and `changeSeq` (pull cursor).
   - Card-level `fieldClock`: JSON map `field -> HLC` for field-level merge.
5. **Enums mirror the checkboxes on the card.** Multi-select checkbox groups become PostgreSQL enum arrays.
6. **Single source of truth for validation.** The enums and Zod schemas live in `@tccc/shared` and are used by the client forms, the Dexie types and the NestJS validation pipe.

### 3.2 DD1380 to data model mapping

| DD1380 section | Card field(s) | Storage |
|---|---|---|
| A: Name | `lastName`, `firstName` | `CasualtyCard` |
| A: Gender | `gender` (MALE, FEMALE) | `CasualtyCard` |
| A: Date + Time | `injuredAt` (timestamptz). The UI shows separate date and time inputs | `CasualtyCard` |
| A: Battle Roster # | `battleRosterNumber` | `CasualtyCard` |
| A: Evacuation priority | `evacPriority` (URGENT, PRIORITY, ROUTINE) | `CasualtyCard` |
| A: Allergies | `allergies` | `CasualtyCard` |
| B: Mechanism of injury | `mechanisms[]` (ARTILLERY, BLUNT, BURN, FALL, GRENADE, GSW, IED, LANDMINE, MVC, RPG, OTHER) + `mechanismOther` | `CasualtyCard` |
| B: Injury sites | region, front/back view, x/y on the body diagram, description | `InjurySite[]` |
| B: Tourniquet R/L arm, R/L leg | `limb`, `type`, `appliedAt` | `Tourniquet[]` (max 1 per limb) |
| C: Time | `measuredAt` | `VitalSigns[]` |
| C: Pulse (rate and location) | `pulseRate`, `pulseLocation` | `VitalSigns[]` |
| C: Blood pressure | `systolic`, `diastolic` | `VitalSigns[]` |
| C: Respiratory rate | `respiratoryRate` | `VitalSigns[]` |
| C: Pulse Ox % O2 Sat | `spo2` | `VitalSigns[]` |
| C: AVPU | `avpu` (ALERT, VERBAL, PAIN, UNRESPONSIVE) | `VitalSigns[]` |
| C: Pain scale (0-10) | `painScale` | `VitalSigns[]` |
| E: Circulation | `circulation[]` (TOURNIQUET, DRESSING, HEMOSTATIC, PRESSURE) | `CasualtyCard` |
| E: Airway | `airway[]` (INTACT, NPA, CRIC, ET_TUBE, SGA) | `CasualtyCard` |
| E: Breathing | `breathing[]` (O2, NEEDLE_D, CHEST_TUBE, CHEST_SEAL) | `CasualtyCard` |
| E: Fluid / blood product | `kind`, `name`, `volumeMl`, `route`, `administeredAt` | `FluidAdministration[]` |
| E: Other | `otherTreatments[]` (EYE_SHIELD, SPLINT, HYPOTHERMIA_PREVENTION) | `CasualtyCard` |
| F: Medications | `category` (ANALGESIC, ANTIBIOTIC, OTHER), `name`, `dose`, `route`, `administeredAt` | `Medication[]` |
| G: Notes | `notes` | `CasualtyCard` |
| H: First responder name, last 4 | `responderName`, `responderLast4` | `CasualtyCard` |

### 3.3 Prisma schema (`apps/server/prisma/schema.prisma`)

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}

// ---------- Enums (mirror DD Form 1380 checkboxes) ----------

enum Gender {
  MALE
  FEMALE
}

enum EvacPriority {
  URGENT
  PRIORITY
  ROUTINE
}

enum MechanismOfInjury {
  ARTILLERY
  BLUNT
  BURN
  FALL
  GRENADE
  GSW
  IED
  LANDMINE
  MVC
  RPG
  OTHER
}

enum Limb {
  RIGHT_ARM
  LEFT_ARM
  RIGHT_LEG
  LEFT_LEG
}

enum BodyRegion {
  HEAD
  FACE
  NECK
  CHEST
  ABDOMEN
  PELVIS
  UPPER_BACK
  LOWER_BACK
  RIGHT_ARM
  LEFT_ARM
  RIGHT_LEG
  LEFT_LEG
}

enum BodyView {
  FRONT
  BACK
}

enum Avpu {
  ALERT
  VERBAL
  PAIN
  UNRESPONSIVE
}

enum CirculationTreatment {
  TOURNIQUET
  DRESSING
  HEMOSTATIC
  PRESSURE
}

enum AirwayTreatment {
  INTACT
  NPA
  CRIC
  ET_TUBE
  SGA
}

enum BreathingTreatment {
  O2
  NEEDLE_D
  CHEST_TUBE
  CHEST_SEAL
}

enum OtherTreatment {
  EYE_SHIELD
  SPLINT
  HYPOTHERMIA_PREVENTION
}

enum FluidKind {
  FLUID
  BLOOD_PRODUCT
}

enum MedicationCategory {
  ANALGESIC
  ANTIBIOTIC
  OTHER
}

enum Route {
  IV
  IO
  IM
  IN
  PO
  SC
  PR
  TOPICAL
  OTHER
}

// ---------- Aggregate root ----------

model CasualtyCard {
  id                 String                 @id @db.Uuid

  // Section A - Casualty details
  lastName           String?
  firstName          String?
  gender             Gender?
  injuredAt          DateTime?              @db.Timestamptz(3) // card "Date" + "Time"
  battleRosterNumber String?
  evacPriority       EvacPriority?
  allergies          String?

  // Section B - Details of injury
  mechanisms         MechanismOfInjury[]
  mechanismOther     String?
  injurySites        InjurySite[]
  tourniquets        Tourniquet[]

  // Section C - Signs & symptoms
  vitalSigns         VitalSigns[]

  // Section E - Treatments
  circulation        CirculationTreatment[]
  airway             AirwayTreatment[]
  breathing          BreathingTreatment[]
  otherTreatments    OtherTreatment[]
  fluids             FluidAdministration[]

  // Section F - Medications
  medications        Medication[]

  // Section G - Notes
  notes              String?

  // Section H - Responder details
  responderName      String?
  responderLast4     String?                @db.Char(4)

  // Sync metadata
  fieldClock         Json                   @default("{}") // { fieldName: HLC }
  version            Int                    @default(1)
  changeSeq          BigInt                 @unique        // set from nextval('card_change_seq')
  createdByDeviceId  String                 @db.Uuid
  createdAt          DateTime               @default(now()) @db.Timestamptz(3)
  serverUpdatedAt    DateTime               @updatedAt @db.Timestamptz(3)
  deletedAt          DateTime?              @db.Timestamptz(3)

  conflicts          SyncConflict[]

  @@index([evacPriority])
  @@index([battleRosterNumber])
  @@index([lastName, firstName])
}

// ---------- Child rows ----------

model InjurySite {
  id              String       @id @db.Uuid
  cardId          String       @db.Uuid
  card            CasualtyCard @relation(fields: [cardId], references: [id], onDelete: Cascade)
  region          BodyRegion
  view            BodyView
  x               Float?       // 0..1 relative position on the body diagram
  y               Float?
  description     String?
  clientUpdatedAt String       // HLC
  deletedAt       DateTime?    @db.Timestamptz(3)

  @@index([cardId])
}

model Tourniquet {
  id              String       @id @db.Uuid // uuidv5(cardId + ":" + limb)
  cardId          String       @db.Uuid
  card            CasualtyCard @relation(fields: [cardId], references: [id], onDelete: Cascade)
  limb            Limb
  type            String       // e.g. "CAT", "SOFTT-W"
  appliedAt       DateTime     @db.Timestamptz(3)
  clientUpdatedAt String
  deletedAt       DateTime?    @db.Timestamptz(3)

  @@unique([cardId, limb])
}

model VitalSigns {
  id              String       @id @db.Uuid
  cardId          String       @db.Uuid
  card            CasualtyCard @relation(fields: [cardId], references: [id], onDelete: Cascade)
  measuredAt      DateTime     @db.Timestamptz(3)
  pulseRate       Int?
  pulseLocation   String?      // e.g. "radial", "carotid"
  systolic        Int?
  diastolic       Int?
  respiratoryRate Int?
  spo2            Int?         // Pulse Ox % O2 Sat, 0..100
  avpu            Avpu?
  painScale       Int?         // 0..10
  clientUpdatedAt String
  deletedAt       DateTime?    @db.Timestamptz(3)

  @@index([cardId, measuredAt])
}

model FluidAdministration {
  id              String       @id @db.Uuid
  cardId          String       @db.Uuid
  card            CasualtyCard @relation(fields: [cardId], references: [id], onDelete: Cascade)
  kind            FluidKind
  name            String       // e.g. "Whole blood", "Plasma", "Hextend"
  volumeMl        Int
  route           Route
  administeredAt  DateTime     @db.Timestamptz(3)
  clientUpdatedAt String
  deletedAt       DateTime?    @db.Timestamptz(3)

  @@index([cardId])
}

model Medication {
  id              String             @id @db.Uuid
  cardId          String             @db.Uuid
  card            CasualtyCard       @relation(fields: [cardId], references: [id], onDelete: Cascade)
  category        MedicationCategory
  name            String             // e.g. "Ketamine", "Moxifloxacin"
  dose            String             // free text with units, e.g. "50 mg"
  route           Route
  administeredAt  DateTime           @db.Timestamptz(3)
  clientUpdatedAt String
  deletedAt       DateTime?          @db.Timestamptz(3)

  @@index([cardId])
}

// ---------- Sync infrastructure ----------

model Device {
  id         String   @id @db.Uuid
  label      String?
  lastSeenAt DateTime @db.Timestamptz(3)
}

model ProcessedMutation {
  mutationId  String   @id @db.Uuid
  deviceId    String   @db.Uuid
  processedAt DateTime @default(now()) @db.Timestamptz(3)
  result      Json

  @@index([deviceId])
}

model SyncConflict {
  id                String       @id @db.Uuid
  cardId            String       @db.Uuid
  card              CasualtyCard @relation(fields: [cardId], references: [id], onDelete: Cascade)
  entity            String       // "card" | "tourniquet" | "vitalSigns" | ...
  entityId          String       @db.Uuid
  field             String
  keptValue         Json
  discardedValue    Json
  discardedDeviceId String       @db.Uuid
  createdAt         DateTime     @default(now()) @db.Timestamptz(3)
  resolvedAt        DateTime?    @db.Timestamptz(3)
  resolvedBy        String?

  @@index([cardId])
  @@index([resolvedAt])
}
```

### 3.4 Server-side storage tasks

- [x] Write `schema.prisma` exactly as above. Run `prisma migrate dev --name init`.
- [x] Custom migration `prisma migrate dev --create-only --name sync_infra` with:

```sql
CREATE SEQUENCE IF NOT EXISTS card_change_seq;

ALTER TABLE "VitalSigns"
  ADD CONSTRAINT vitals_pain_scale_chk CHECK ("painScale" IS NULL OR "painScale" BETWEEN 0 AND 10),
  ADD CONSTRAINT vitals_spo2_chk       CHECK ("spo2" IS NULL OR "spo2" BETWEEN 0 AND 100),
  ADD CONSTRAINT vitals_pulse_chk      CHECK ("pulseRate" IS NULL OR "pulseRate" BETWEEN 0 AND 300),
  ADD CONSTRAINT vitals_resp_chk       CHECK ("respiratoryRate" IS NULL OR "respiratoryRate" BETWEEN 0 AND 80);

ALTER TABLE "CasualtyCard"
  ADD CONSTRAINT card_responder_last4_chk CHECK ("responderLast4" IS NULL OR "responderLast4" ~ '^[0-9]{4}$');

ALTER TABLE "FluidAdministration"
  ADD CONSTRAINT fluid_volume_chk CHECK ("volumeMl" > 0 AND "volumeMl" <= 10000);
```

- [x] `PrismaService` (`apps/server/src/prisma/prisma.service.ts`) using `PrismaPg` from `@prisma/adapter-pg`, with `onModuleInit` / `onModuleDestroy`.
- [x] `nextChangeSeq(tx)` helper: `SELECT nextval('card_change_seq')` inside the same transaction as each aggregate write. Any change to the card or to one of its child rows bumps the card's `changeSeq` and `version`.
- [x] Seed script `prisma/seed.ts`: about 20 realistic cards with mixed priorities, 1 to 4 vitals each, tourniquets, medications and fluids.

### 3.5 Shared contracts (`packages/shared`)

- [x] `src/enums.ts`: TypeScript `const` objects and union types identical to the Prisma enums.
- [x] `src/schemas/card.ts`: Zod schemas for each section (`sectionASchema` through `sectionHSchema`), child rows (`vitalSignsSchema`, `tourniquetSchema`, and so on), and the full `casualtyCardSchema`. There is no Section D schema (see `docs/data-model.md` 2.2). `sectionCSchema` and `sectionFSchema` are aliases of the row schemas `vitalSignsSchema` and `medicationSchema`.
- [x] `src/schemas/sync.ts`: `mutationSchema`, `pushRequestSchema`, `pushResponseSchema`, `pullResponseSchema`.
- [x] `src/hlc.ts`: Hybrid Logical Clock (`now()`, `receive(remote)`, `compare(a, b)`, serialized as `"<wallMs 13 digits>:<counter 4 digits>:<deviceId>"` so plain string comparison gives the correct order). Implemented as `tickHlc`, `receiveHlc` and `compareHlc`.
- [x] `src/ids.ts`: `newId()` (UUIDv7), `tourniquetId(cardId, limb)` (UUIDv5).
- [x] Contract test: every Prisma enum value exists in the shared enum (a script that parses `schema.prisma`, or a Vitest test against the generated client).

### 3.6 Local storage: Dexie (`apps/client/src/lib/db/`)

Cards are stored locally as **embedded aggregate documents**: one IndexedDB record per card, with child arrays inside. This keeps each write atomic and makes rendering a card a single read.

```ts
// apps/client/src/lib/db/schema.ts
import Dexie, { type EntityTable } from "dexie";
import type { LocalCasualtyCard, OutboxMutation, LocalConflict, MetaEntry } from "./types";

export class TcccDB extends Dexie {
  casualties!: EntityTable<LocalCasualtyCard, "id">;
  outbox!: EntityTable<OutboxMutation, "seq">;
  conflicts!: EntityTable<LocalConflict, "id">;
  meta!: EntityTable<MetaEntry, "key">;

  constructor() {
    super("tccc");
    this.version(1).stores({
      casualties: "id, evacPriority, syncStatus, clientUpdatedAt, deletedAt, battleRosterNumber, [lastName+firstName]",
      outbox: "++seq, &mutationId, cardId, status, createdAt",
      conflicts: "id, cardId, resolvedAt",
      meta: "key", // deviceId, lastPullSeq, hlcState, responderProfile, locale
    });
  }
}

export const db = new TcccDB();
```

`LocalCasualtyCard` = the shared `CasualtyCard` type, plus these fields:

- `syncStatus: "pending" | "synced" | "conflict"`
- `serverVersion: number | null` (the last version acknowledged by the server; this is the `baseVersion` for the next push)
- `fieldClock: Record<string, string>`
- child arrays: `injurySites`, `tourniquets`, `vitalSigns`, `fluids`, `medications` (each item carries its own `clientUpdatedAt` and `deletedAt`)

Tasks:

- [x] Dexie schema and types as above.
- [x] Repository layer `casualtyRepo.ts`: `create`, `updateFields(id, patch)`, `upsertChild(id, kind, item)`, `deleteChild`, `softDelete`, `getById`, `listActive`. **Each write runs in `db.transaction("rw", db.casualties, db.outbox, db.meta, ...)`** and appends an outbox mutation in the same transaction.
- [x] `meta` helpers: `getDeviceId()` (generated once), `getLastPullSeq()`, HLC state persistence.
- [x] `requestPersistentStorage()`: calls `navigator.storage.persist()` on first launch. The settings page shows `navigator.storage.estimate()` usage and quota.
- [x] Migration policy: each change is a new `this.version(n).stores(...).upgrade(tx => ...)`. Stores are never edited in place.
- [x] **Deferred** (optional, NFR-10): encrypt personal fields (`lastName`, `firstName`, `battleRosterNumber`, `allergies`) with AES-GCM before writing, using a key derived from a device PIN (PBKDF2).

**Deliverables:** `schema.prisma`, migrations, `packages/shared`, Dexie layer, ER diagram, `docs/data-model.md` (thesis chapter 3 source).

**DoD:** migrations apply to an empty DB. The seed runs. The shared Zod schemas validate seed data. A Dexie unit test (with `fake-indexeddb`) shows that a create writes both the card and one outbox entry atomically.

---

## Point 4: Offline operation and synchronization

**Goal:** the app is fully usable offline, and all local changes reach the server reliably and idempotently when the network returns, with deterministic conflict resolution.

### 4.1 Architecture

```mermaid
flowchart LR
  UI[ReactForms] -->|"write (optimistic)"| Dexie[(DexieCasualties)]
  UI --> Outbox[(DexieOutbox)]
  Dexie -->|useLiveQuery| UI
  Outbox --> Engine[SyncEngine]
  Engine -->|"POST /api/sync/push"| Nest[NestJS SyncModule]
  Engine -->|"GET /api/sync/pull?since=seq"| Nest
  Nest --> PG[(PostgreSQL)]
  SW[SerwistSW] -->|"sync event / online event"| Engine
```

### 4.2 Local-first read/write model (optimistic UI)

- The UI **only reads from Dexie** (`useLiveQuery`). It never waits for the network to render or save.
- Every user action produces, in **one Dexie transaction**:
  1. An update of the local aggregate. For each changed field, `fieldClock[field]` is set to a new HLC, and `syncStatus` becomes `"pending"`.
  2. An outbox mutation:

```ts
type OutboxMutation = {
  seq?: number;                 // auto-increment, gives FIFO order
  mutationId: string;           // UUIDv7, idempotency key
  cardId: string;
  op: "card.upsert" | "card.delete"
    | "child.upsert" | "child.delete";
  entity?: "injurySite" | "tourniquet" | "vitalSigns" | "fluid" | "medication";
  entityId?: string;
  baseVersion: number | null;   // card serverVersion at time of edit
  patch: Record<string, unknown>;
  changedFields: string[];
  hlc: string;                  // HLC of this mutation
  status: "queued" | "inflight" | "failed";
  attempts: number;
  createdAt: number;
  lastError?: string;
};
```

- **Outbox coalescing:** before a push, queued mutations for the same card and entity are merged (later patch fields override earlier ones, keeping the highest HLC per field). This cuts the payload after long offline periods.
- Each card shows a badge from `syncStatus`: `pending` (grey clock), `synced` (check), `conflict` (warning, links to `/sync`).

### 4.3 Push protocol

`POST /api/sync/push`

```json
{
  "deviceId": "uuid",
  "mutations": [
    {
      "mutationId": "uuid",
      "cardId": "uuid",
      "op": "card.upsert",
      "baseVersion": 3,
      "patch": { "evacPriority": "URGENT" },
      "changedFields": ["evacPriority"],
      "hlc": "1790000000000:0001:device-uuid"
    }
  ]
}
```

Response:

```json
{
  "results": [
    { "mutationId": "uuid", "status": "applied", "card": { "...full aggregate..." } },
    { "mutationId": "uuid", "status": "merged",  "card": { "..." }, "conflicts": [ { "field": "allergies", "kept": "...", "discarded": "..." } ] },
    { "mutationId": "uuid", "status": "rejected", "error": { "code": "VALIDATION", "details": [] } }
  ],
  "serverTime": "2026-09-23T12:00:00.000Z"
}
```

Server algorithm (per mutation, inside one `prisma.$transaction`):

1. If a `ProcessedMutation` with this `mutationId` exists, return the stored `result` (**idempotent replay**).
2. Validate `patch` with the shared Zod schema. If invalid, return `rejected` (the client moves it to `failed` and does not retry).
3. Load the card with `SELECT ... FOR UPDATE`.
4. If `baseVersion == card.version`, apply the patch, update `fieldClock`, and return `applied`.
5. Otherwise, **merge field by field**: for each changed field, if `mutation.hlc > card.fieldClock[field]` the incoming value wins; otherwise the stored value is kept. In both cases, write the losing value to `SyncConflict`. Return `merged` with the list of conflicts.
6. Child rows: row-level LWW on `clientUpdatedAt`. Tombstones (`deletedAt`) are ordinary field values and win or lose by HLC like any other.
7. `version = version + 1`, `changeSeq = nextval('card_change_seq')`.
8. Insert a `ProcessedMutation` with the result. Update `Device.lastSeenAt`.

Client handling of results:

- `applied` / `merged`: remove the mutation from the outbox, replace the local aggregate with the server aggregate **unless newer local mutations for that card are still queued**. In that case, re-apply those queued patches on top of the server aggregate (rebase).
- `merged` with conflicts on **clinically critical fields** (`evacPriority`, `allergies`, any tourniquet): copy them to the local `conflicts` table and set `syncStatus = "conflict"`.
- Network error or 5xx: `status = "queued"`, `attempts++`, retry with **exponential backoff with full jitter** (base 1 s, cap 60 s).
- `rejected`: `status = "failed"`, shown on `/sync` with the error.

### 4.4 Pull protocol

`GET /api/sync/pull?since=<changeSeq>&limit=100`

```json
{ "cards": [ { "...full aggregate incl. deleted children..." } ], "nextSince": "1234", "hasMore": false }
```

- The client stores `lastPullSeq` in `meta` and loops while `hasMore`.
- Local merge: a server card replaces the local one when the local card has no queued mutations. Otherwise the queued patches are rebased on top of it (same rule as push).
- Cards with `deletedAt` set are hidden in the UI and purged locally after a retention period (for example, 30 days, once synced).

### 4.5 Sync engine (`apps/client/src/lib/sync/`)

- [x] `engine.ts`: a single-flight `syncNow()` that runs **push, then pull**, with a mutex so runs never overlap. Use the Web Locks API (`navigator.locks.request("tccc-sync", ...)`) so only one tab syncs at a time.
- [x] `connectivity.ts`: `navigator.onLine` is only a hint. Real connectivity is `GET /api/health` with a 3 s `AbortController` timeout. The result is exposed as `online | offline | degraded`.
- [x] Triggers:
  - `window` `online` event
  - `document` `visibilitychange` (becomes visible)
  - Interval: every 30 s while online, backing off to 5 min while offline
  - Right after any local write (debounced 2 s)
  - Manual "Sync now" button
  - Service worker `sync` event (Background Sync, see 4.6)
- [x] `status-store.ts`: a small store (React context or `useSyncExternalStore`) exposing `state`, `pendingCount`, `lastSyncAt`, `lastError`, `conflictCount` to the UI.
- [x] `hlc` state is persisted in `meta`. On every server response, `hlc.receive(serverTime)` limits the effect of device clock skew.

### 4.6 Service worker (Serwist) configuration

`apps/client/src/app/sw.ts`:

- [x] **Precache:** the app shell, all route shells (`/`, `/casualties/new`, `/casualties/card`, `/casualties/card/edit`, `/casualties/card/vitals`, `/sync`, `/settings`, `/~offline`), JS/CSS chunks, icons, fonts.
- [x] **Runtime caching:**
  - `/api/*`: `NetworkOnly`. Data flows through Dexie, never through the HTTP cache, which avoids serving stale medical data.
  - Images and fonts: `StaleWhileRevalidate` or `CacheFirst` with expiration.
  - Navigations: `NetworkFirst` with a 3 s timeout, falling back to the precached shell, then `/~offline`.
- [x] **Background Sync:** register a `sync` tag `tccc-outbox` from the client after each write (`registration.sync.register("tccc-outbox")`). The service worker's `sync` handler posts a message to open clients to run `syncNow()`. If there are no clients, it runs a minimal push directly from the worker by reading Dexie inside the SW (Dexie works in workers).
- [x] **Fallback for Safari/iOS** (no Background Sync): rely on the foreground triggers in 4.5.
- [x] **Update flow:** `skipWaiting: false`. When a new SW is waiting, the UI shows an "Update available" banner. On confirmation, post `SKIP_WAITING` and reload. Updates are never applied mid-form.
- [x] Web App Manifest (`src/app/manifest.ts`): name, short_name, `display: "standalone"`, `start_url: "/"`, theme/background colors, 192/512 and maskable icons.

### 4.7 Offline UX

- [x] A global connectivity indicator in the header (online / offline / syncing / N pending).
- [x] Forms never block on the network. Save always succeeds locally.
- [x] A toast when a sync completes after being offline ("12 changes synchronized").
- [x] A persistent storage warning if `navigator.storage.persist()` was denied.

**Deliverables:** sync engine, SyncModule, service worker, sequence diagrams (push, pull, conflict), `docs/sync-design.md` (thesis chapter 4 source).

**DoD:**

- Creating and editing cards in airplane mode, reloading, and then reconnecting results in the server holding identical data.
- Replaying the same push twice changes nothing.
- A two-device concurrent edit produces a deterministic merge and a `SyncConflict` record.

---

## Point 5: Core functional modules (create, view, edit)

**Goal:** a complete, field-usable UI and API for DD1380 cards.

### 5.1 Next.js pages (App Router, `apps/client/src/app/`)

Routes use **query parameters instead of dynamic `[id]` segments**. A card created offline has no server-rendered page that the service worker could have cached. Static route shells work for any ID and are precached at install time. Each page is a client component that reads its ID from `useSearchParams()` and loads data from Dexie. Wrap `useSearchParams` in `<Suspense>`, following the Next 16 docs.

| Route | Purpose | Key components |
|---|---|---|
| `/` | Casualty list: triage sort (Urgent > Priority > Routine, then newest), filters by priority and sync status, search by name or battle roster #, sync status bar, "New casualty" floating button | `CasualtyList`, `PriorityBadge`, `SyncBadge`, `SyncStatusBar` |
| `/casualties/new` | Create wizard with steps A, B, C, E, F, G, H. Autosaves to Dexie on every step (the card exists from step 1). Section H is prefilled from settings | `CardWizard`, section forms |
| `/casualties/card?id=` | Read-only view laid out like DD1380 (front/back), vitals timeline table, treatments summary, "Print / handover" action | `CardView`, `VitalsTimeline`, `BodyDiagram` (read-only) |
| `/casualties/card/edit?id=&section=` | Edit by section tabs (A, B, C, E, F, G, H). Each tab saves only its changed fields (a field-level patch) | `SectionTabs`, section forms |
| `/casualties/card/vitals?id=` | Quick-add vitals: large numeric keypad inputs, "now" time, AVPU and pain scale as big buttons. Meets NFR-03 | `QuickVitalsForm` |
| `/sync` | Outbox queue (pending, failed with error), last sync time, "Sync now", conflict review (kept vs. discarded value, "Keep" / "Use other" actions) | `OutboxTable`, `ConflictCard` |
| `/settings` | Responder profile (default name, last 4), language (uk/en), theme, device ID, storage usage, export all cards (JSON), clear local data (with confirmation, blocked if pending changes exist) | `SettingsForm` |
| `/~offline` | Service worker fallback page | static |

### 5.2 Shared UI components (`apps/client/src/components/`)

- [x] `BodyDiagram`: front/back SVG silhouette. Tap to add an `InjurySite` (stores region, view, normalized x/y). Tap a marker to edit or delete it.
- [x] `TourniquetGrid`: a 2x2 grid (R arm, L arm, R leg, L leg). Each cell has a type input and a time with a "Now" button.
- [x] `EnumChips`: a multi-select chip group driven by the shared enums (mechanisms, circulation, airway, breathing, other treatments).
- [x] `TimeInput`: date and time with a large "Now" button, stored as an ISO timestamp.
- [x] `NumericField`: large touch-friendly numeric input (`inputMode="numeric"`).
- [x] `MedicationList` / `FluidList`: repeatable rows (category, name, dose/volume, route, time).
- [x] `PriorityBadge`, `SyncBadge`, `ConnectivityIndicator`, `UpdateBanner`.
- [x] Forms: `react-hook-form` + `@hookform/resolvers/zod` with the section schemas from `@tccc/shared`.
- [x] i18n: a lightweight dictionary (`src/i18n/uk.ts`, `src/i18n/en.ts`) and a `useT()` hook. All enum labels are translated.
- [x] Theme: dark by default (night operations), a high-contrast option, and minimum 48 px touch targets (Tailwind utilities).
- [x] Print stylesheet (`@media print`) for the card view, laid out like DD1380.

### 5.3 NestJS modules (`apps/server/src/`)

Global setup in `main.ts`:

- `app.setGlobalPrefix("api")`
- `app.enableCors({ origin: process.env.CORS_ORIGIN })`
- A global Zod validation pipe (`nestjs-zod`, or a custom `ZodValidationPipe` using the schemas from `@tccc/shared`)
- Swagger (`@nestjs/swagger`) at `/api/docs`
- A global exception filter that maps Prisma errors (`P2002` to 409, `P2025` to 404)

| Module | Responsibility |
|---|---|
| `PrismaModule` | `PrismaService` (adapter-pg), `nextChangeSeq` helper |
| `HealthModule` | Liveness plus a DB check. Also returns `serverTime` for HLC |
| `CasualtiesModule` | Direct REST CRUD for cards and child rows. Used by admin tools, tests, and the online path |
| `SyncModule` | Push (idempotent, merge), pull (cursor), conflicts |
| `DevicesModule` | Device registration and last-seen tracking |
| `AuthModule` (optional) | JWT per device/responder. A guard on all routes except `/api/health` |

### 5.4 REST API endpoints

All paths are under `/api`.

**Health and devices**

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | `{ status, db, serverTime }` |
| POST | `/api/devices/register` | Body `{ deviceId, label? }`. Upserts `Device` |

**Casualty cards**

| Method | Path | Description |
|---|---|---|
| GET | `/api/casualties?priority=&search=&updatedSince=&includeDeleted=&cursor=&limit=` | Paginated list (cursor = `changeSeq`), with summary fields |
| GET | `/api/casualties/:id` | Full aggregate |
| POST | `/api/casualties` | Create (client-supplied `id`). Idempotent if the same `id` is posted twice with identical data |
| PATCH | `/api/casualties/:id` | Partial update of sections A, B (scalar fields), E (arrays), G, H. Requires `If-Match: <version>`. Returns 412 on mismatch |
| DELETE | `/api/casualties/:id` | Soft delete (sets `deletedAt`) |

**Child rows**

| Method | Path | Description |
|---|---|---|
| PUT | `/api/casualties/:id/tourniquets/:limb` | Upsert the tourniquet for a limb (`type`, `appliedAt`) |
| DELETE | `/api/casualties/:id/tourniquets/:limb` | Tombstone the tourniquet |
| POST | `/api/casualties/:id/injury-sites` | Add an injury site |
| PATCH | `/api/casualties/:id/injury-sites/:itemId` | Update an injury site |
| DELETE | `/api/casualties/:id/injury-sites/:itemId` | Tombstone an injury site |
| POST | `/api/casualties/:id/vitals` | Add a vital signs measurement |
| PATCH | `/api/casualties/:id/vitals/:itemId` | Update a measurement |
| DELETE | `/api/casualties/:id/vitals/:itemId` | Tombstone a measurement |
| POST | `/api/casualties/:id/fluids` | Add a fluid / blood product |
| PATCH | `/api/casualties/:id/fluids/:itemId` | Update |
| DELETE | `/api/casualties/:id/fluids/:itemId` | Tombstone |
| POST | `/api/casualties/:id/medications` | Add a medication |
| PATCH | `/api/casualties/:id/medications/:itemId` | Update |
| DELETE | `/api/casualties/:id/medications/:itemId` | Tombstone |

Every write bumps the card's `version` and `changeSeq` so the pull endpoint sees it.

**Synchronization**

| Method | Path | Description |
|---|---|---|
| POST | `/api/sync/push` | Batch of outbox mutations (see 4.3) |
| GET | `/api/sync/pull?since=&limit=` | Aggregates changed since the cursor (see 4.4) |
| GET | `/api/sync/conflicts?cardId=&resolved=` | List conflict records |
| POST | `/api/sync/conflicts/:id/resolve` | Body `{ choice: "kept" \| "discarded" }`. Applies the chosen value as a new write |

### 5.5 Tasks checklist

- [x] Server: modules, controllers, services, DTOs (from shared Zod schemas), Swagger decorators.
- [x] Server: unit tests for services and e2e tests for every endpoint (`apps/server/test/*.e2e-spec.ts`).
- [x] Client: pages from 5.1, components from 5.2, repository calls only (pages never call `fetch`).
- [x] Client: `apps/client/src/lib/api.ts`, a typed fetch wrapper used **only** by the sync engine.
- [x] Accessibility: labels on all inputs, keyboard navigation, color never the only indicator of priority.

**Deliverables:** working application, screenshots of every page, API documentation (Swagger export), `docs/implementation.md` (thesis chapter 5 source).

**DoD:** every use case from Point 1 can be completed end to end in airplane mode, and the result appears on the server after reconnecting.

---

## Point 6: Testing under offline and unstable network conditions

**Goal:** show experimentally that the system meets NFR-01 to NFR-06 and analyze its behavior under adverse network conditions.

### 6.1 Test levels

| Level | Tool | Scope |
|---|---|---|
| Unit | Vitest | HLC ordering, field-level merge, outbox coalescing, rebase of queued patches, Zod schemas, server `SyncService` (idempotency, merge, conflicts) |
| Client storage | Vitest + `fake-indexeddb` | Repository transactions (card and outbox written atomically), Dexie migrations |
| API integration | Vitest + supertest + `db_test` container | All REST endpoints, push/pull/conflict flows, CHECK constraints |
| End-to-end | Playwright (Chromium, plus WebKit for the Safari fallback) | Full user flows with network manipulation |
| Audit | Lighthouse CI | PWA installability, performance, accessibility |

### 6.2 Network manipulation techniques

- [x] **Hard offline:** `browserContext.setOffline(true/false)` in Playwright.
- [x] **Throttling:** Chrome DevTools Protocol `Network.emulateNetworkConditions` with profiles:
  - Fast 3G: 562 ms RTT, 1.6 Mbps down, 750 kbps up
  - Slow 3G: 2000 ms RTT, 400 kbps down, 400 kbps up
  - "Field 2G": 3000 ms RTT, 50 kbps down, 20 kbps up
- [x] **Chaos middleware** on the server (enabled only when `CHAOS_ENABLED=true`):
  - `CHAOS_LATENCY_MS`: random delay of 0 to N ms
  - `CHAOS_FAILURE_RATE`: probability (0 to 1) of returning 503
  - `CHAOS_DROP_RATE`: probability of dropping the connection after the DB commit (tests idempotency: the server applied the change but the client never saw the response)
- [x] Optional: **Toxiproxy** between the server and PostgreSQL, or between the client and the server, for packet loss and bandwidth limits.

### 6.3 Test scenarios

| ID | Scenario | Expected result |
|---|---|---|
| T-01 | Create 5 cards offline, reload the page, go online | All 5 cards are still present after the reload and appear on the server, 0 duplicates |
| T-02 | Edit a card offline in 10 separate steps, go online | Outbox coalesced, server has the final state |
| T-03 | Tab killed (page closed) during an in-flight push | On reopen, the push is retried. `ProcessedMutation` prevents a double apply |
| T-04 | `CHAOS_DROP_RATE=0.5` for 100 mutations | All mutations applied exactly once |
| T-05 | `CHAOS_FAILURE_RATE=0.3` with backoff | Eventual full sync, retry counts recorded |
| T-06 | Two browser contexts (devices) edit different fields of the same card offline | Both changes present after sync, no conflict records |
| T-07 | Two devices edit the **same** field (`evacPriority`) offline | Higher HLC wins, `SyncConflict` created, conflict visible on `/sync` |
| T-08 | Device A deletes a vitals row, device B edits it | Resolved by HLC, tombstone or edit wins deterministically |
| T-09 | Long offline period: 200 cards, 72 h simulated (fake clock) | UI stays responsive, sync completes, time measured |
| T-10 | Throttled Slow 3G / Field 2G sync of 50 cards | Duration measured against NFR-05 |
| T-11 | Service worker update published while the client is offline | Old SW keeps working. Update banner appears after reconnecting, no data loss |
| T-12 | First visit, then offline cold start | App shell renders from precache, time to first render measured (NFR-06) |
| T-13 | Storage pressure (fill quota in a test profile) | App warns the user, existing data is intact |
| T-14 | Device clock skewed by +/- 1 h | HLC ordering remains correct after the first server contact |
| T-15 | Invalid payload (pain scale 15) pushed | `rejected`, shown as failed on `/sync`, other mutations unaffected |

### 6.4 Metrics to collect

- [x] **Data-loss count** (target 0): records created locally vs. records present on the server after sync.
- [x] **Duplicate count** (target 0).
- [x] **Sync duration** (p50 / p95) per scenario and network profile.
- [x] **Payload size** per push/pull, before and after outbox coalescing.
- [x] **Retry count** and backoff behavior.
- [x] **Time to first render offline** (Performance API marks).
- [x] **IndexedDB size per card** (`navigator.storage.estimate()` delta).
- [x] **Lighthouse scores** (PWA installability, performance, accessibility).
- [x] **Input time** for a vitals set (manual measurement with 3 to 5 volunteers, NFR-03).

Tasks:

- [x] Playwright project in `e2e/` (workspace package) with fixtures for `offline()`, `throttle(profile)`, `twoDevices()`, and `serverCounts()`.
- [x] Metrics reporter: each test writes JSON to `e2e/results/*.json`.
- [x] Script `e2e/scripts/aggregate-results.ts` that produces Markdown tables and CSV files for charts.
- [x] Lighthouse CI config (`lighthouserc.json`) run against `next build && next start`.
- [x] Optional: GitHub Actions workflow running unit, integration and e2e tests with a Postgres service container.

**Deliverable:** `docs/test-report.md` with method, environment, results tables, charts (sync time vs. network profile, retries vs. failure rate), discussion of limitations (Background Sync on iOS, storage eviction, clock skew), and conclusions (thesis chapter 6 source).

**DoD:** all scenarios T-01 to T-15 automated or documented as manual, and every NFR has a measured value compared against its target.

---

## Cursor Composer prompt sequence

Use these prompts **in order**, one per Composer session (or one per commit). Each prompt assumes the previous ones are merged. Paste the prompt, review the diff, run the acceptance checks, commit, then move on. Referencing `@PLAN.md` gives Composer the full context.

### Prompt 1: Monorepo housekeeping

> Read @PLAN.md, "Phase 0". In this pnpm monorepo: (1) align `prisma` and `@prisma/client` in `apps/server` to the same stable version and add `@prisma/adapter-pg`, `pg`, `dotenv`; (2) delete `apps/client/pnpm-workspace.yaml` and `apps/client/pnpm-lock.yaml`; (3) make the root `pnpm-workspace.yaml` include `apps/*` and `packages/*`; (4) add the root scripts listed in Phase 0; (5) add `.env.example` files for client and server; (6) update `apps/server/prisma.config.ts` with `schema`, `migrations` and `datasource.url`; (7) add a `db_test` service on port 5433 to `docker-compose.yml`. Do not add any features.

Acceptance: `pnpm install` has no peer/version warnings for Prisma, and `pnpm db:up` starts Postgres.

### Prompt 2: Shared contracts package

> Read @PLAN.md, section 3.5. Create `packages/shared` (`@tccc/shared`) with: `src/enums.ts` (all enums from the Prisma schema in section 3.3 as `const` objects and union types), `src/schemas/card.ts` (Zod schemas for sections A, B, C, E, F, G, H, each child row type, and the full card aggregate with sync metadata, including painScale 0-10, spo2 0-100, responderLast4 `^\d{4}$`), `src/schemas/sync.ts` (mutation, push request/response, pull response per section 4.3/4.4), `src/hlc.ts` (Hybrid Logical Clock with lexicographically sortable string format), `src/ids.ts` (`newId` UUIDv7, `tourniquetId` UUIDv5). Add Vitest tests for HLC ordering and schema validation. Wire the package into both apps as a workspace dependency (use `transpilePackages` in Next).

Acceptance: `pnpm --filter @tccc/shared test` passes, and both apps can import from `@tccc/shared`.

### Prompt 3: Prisma schema, migrations, seed, PrismaService

> Read @PLAN.md, sections 3.3 and 3.4. In `apps/server`: create `prisma/schema.prisma` exactly as in section 3.3; generate the `init` migration; create a second `--create-only` migration `sync_infra` containing the SQL in section 3.4 (sequence and CHECK constraints); implement `src/prisma/prisma.module.ts` and `prisma.service.ts` using `PrismaPg` adapter and the generated client from `src/generated/prisma`; add a `nextChangeSeq(tx)` helper; write `prisma/seed.ts` generating about 20 realistic DD1380 cards with child rows. Use the enums from `@tccc/shared` where TS types are needed.

Acceptance: `pnpm db:migrate && pnpm db:seed` succeeds, and a manual insert with `painScale = 15` is rejected by Postgres.

### Prompt 4: NestJS CasualtiesModule and HealthModule

> Read @PLAN.md, sections 5.3 and 5.4. In `apps/server`: set the global prefix `api`, CORS from env, a global Zod validation pipe using `@tccc/shared` schemas, Swagger at `/api/docs`, and a Prisma exception filter. Implement `HealthModule` (`GET /api/health` returning status, db check, serverTime), `DevicesModule` (`POST /api/devices/register`), and `CasualtiesModule` with every card and child-row endpoint in section 5.4, including `If-Match` version checks, soft deletes, and bumping `version` + `changeSeq` on every write in a transaction. Add e2e tests with supertest against the `db_test` database.

Acceptance: `pnpm --filter server test && pnpm --filter server test:e2e` pass, and Swagger lists all endpoints.

### Prompt 5: NestJS SyncModule

> Read @PLAN.md, sections 4.3 and 4.4. Implement `SyncModule` in `apps/server`: `POST /api/sync/push` with per-mutation transactions, idempotency via `ProcessedMutation`, Zod validation (rejected results), `SELECT ... FOR UPDATE`, field-level last-writer-wins using `fieldClock` and HLC comparison from `@tccc/shared`, row-level LWW with tombstones for child rows, `SyncConflict` records for every discarded value, and `applied | merged | rejected` results with the full aggregate. Implement `GET /api/sync/pull` with a `changeSeq` cursor, and the conflicts list/resolve endpoints. Write unit tests for the merge logic and e2e tests for replay idempotency and a two-device conflict.

Acceptance: pushing the same batch twice yields identical results and no extra rows, and the conflict test creates exactly one `SyncConflict`.

### Prompt 6: Serwist PWA integration (Next 16)

> Read @PLAN.md, sections 2.2 (Spike A) and 4.6. First read the relevant guides in `apps/client/node_modules/next/dist/docs/` as required by `apps/client/AGENTS.md`. Integrate Serwist into `apps/client`: decide between `@serwist/next` with `next build --webpack` and Serwist's Turbopack support, and document the choice in a comment in `next.config.ts`. Create `src/app/sw.ts` with precache of all route shells, `NetworkOnly` for `/api/*`, `StaleWhileRevalidate` for images/fonts, `NetworkFirst` navigations with fallback to `/~offline`, `skipWaiting: false` with a `SKIP_WAITING` message handler, and a `sync` event handler for tag `tccc-outbox` that notifies clients. Add `src/app/manifest.ts`, icons (192, 512, maskable), the `/~offline` page, and an `UpdateBanner` component.

Acceptance: after `pnpm --filter client build && pnpm --filter client start`, the app installs, reloads in airplane mode, and Lighthouse installability passes.

### Prompt 7: Dexie database and repositories

> Read @PLAN.md, section 3.6. In `apps/client/src/lib/db/`, implement the `TcccDB` Dexie schema, local types extending `@tccc/shared` types, `meta` helpers (deviceId, lastPullSeq, HLC state, responder profile), `requestPersistentStorage()`, and `casualtyRepo.ts` with create/updateFields/upsertChild/deleteChild/softDelete/getById/listActive. Every write must run in a single Dexie transaction that updates the aggregate, sets per-field HLC in `fieldClock`, sets `syncStatus = "pending"`, and appends an `OutboxMutation` exactly as typed in section 4.2. Add Vitest tests with `fake-indexeddb`.

Acceptance: tests show the card and outbox entry are written atomically, and a failed write leaves neither.

### Prompt 8: Client sync engine

> Read @PLAN.md, section 4.5 and the client handling rules in 4.3/4.4. Implement `apps/client/src/lib/sync/`: `api.ts` (typed fetch wrapper), `connectivity.ts` (health probe with timeout), `coalesce.ts` (outbox coalescing), `engine.ts` (single-flight push then pull using the Web Locks API, exponential backoff with full jitter, result handling for applied/merged/rejected, rebase of still-queued local patches onto server aggregates, conflict copying for critical fields), triggers (online, visibilitychange, interval, post-write debounce, manual, service worker message), and `status-store.ts` exposing state via `useSyncExternalStore`. Register Background Sync tag `tccc-outbox` after writes when supported. Unit test coalescing, rebase and backoff.

Acceptance: with the server running, a card created offline syncs within 5 s of reconnecting, and the unit tests pass.

### Prompt 9: App shell, layout, theme, i18n

> Read @PLAN.md, sections 4.7 and 5.2. In `apps/client`, build the root layout: header with app title, `ConnectivityIndicator` (online/offline/syncing/pending count from the status store), navigation (List, New, Sync, Settings), `UpdateBanner`, and a toast system. Dark theme by default with a high-contrast option, minimum 48 px touch targets, and a lightweight i18n system (`src/i18n/uk.ts`, `en.ts`, `useT()`) including translated labels for every shared enum. Start the sync engine and request persistent storage on mount.

Acceptance: the layout renders offline, the language switch works, and the indicator reflects airplane mode.

### Prompt 10: Casualty list page

> Read @PLAN.md, section 5.1 (route `/`). Implement the casualty list with `useLiveQuery` from Dexie: triage sort (URGENT > PRIORITY > ROUTINE, then newest), filter chips by priority and sync status, search by name or battle roster #, `PriorityBadge`, `SyncBadge`, a floating "New casualty" button, and an empty state. Each row links to `/casualties/card?id=...`. The page must work fully offline.

Acceptance: seeded or locally created cards appear sorted correctly and update live when another tab writes.

### Prompt 11: New-card wizard

> Read @PLAN.md, sections 3.2, 5.1 (`/casualties/new`) and 5.2. Implement `CardWizard` with steps A, B, C, E, F, G, H using react-hook-form + Zod resolvers from `@tccc/shared`. Build the components `BodyDiagram` (front/back SVG, tap to add or edit injury sites), `TourniquetGrid` (2x2, type + time with "Now"), `EnumChips`, `TimeInput`, `NumericField`, `MedicationList`, `FluidList`. The card is created in Dexie at step 1 and every step autosaves through `casualtyRepo` (field-level patches). Section H is prefilled from the responder profile. Tourniquet IDs must use `tourniquetId(cardId, limb)`.

Acceptance: a full card can be created in airplane mode, survives a reload mid-wizard, and syncs after reconnecting.

### Prompt 12: Card view, edit, quick vitals, print

> Read @PLAN.md, section 5.1 (`/casualties/card`, `/casualties/card/edit`, `/casualties/card/vitals`). Implement: a read-only DD1380-style `CardView` with `VitalsTimeline` and read-only `BodyDiagram`; an edit page with `SectionTabs` reusing the wizard section forms and saving only changed fields; a `QuickVitalsForm` optimized for at most 3 taps (large numeric inputs, "Now" time, AVPU and pain scale as big buttons); a print stylesheet for the card view. Read `id` via `useSearchParams` inside `Suspense`. Show a "not found locally" state with a "Sync now" action.

Acceptance: view, edit and vitals work offline, and the print preview resembles DD1380.

### Prompt 13: Sync and settings pages

> Read @PLAN.md, sections 4.3 and 5.1 (`/sync`, `/settings`). Implement `/sync`: outbox table (pending/failed with error and attempts, retry/discard actions for failed items), last sync time, "Sync now", conflict review cards showing kept vs. discarded values with "Keep" / "Use other" actions calling the resolve endpoint (queued through the outbox if offline). Implement `/settings`: responder profile (name, last 4 with validation), language, theme, device ID, storage usage from `navigator.storage.estimate()`, persistent-storage status, JSON export of all cards, and "Clear local data" (blocked while the outbox is not empty).

Acceptance: a two-device conflict from Prompt 5 is visible and resolvable in the UI.

### Prompt 14: Playwright e2e and chaos testing

> Read @PLAN.md, sections 6.2 and 6.3. Create an `e2e/` workspace package with Playwright (Chromium and WebKit). Add fixtures: `offline()`, `throttle(profile)` via CDP `Network.emulateNetworkConditions` (Fast 3G, Slow 3G, Field 2G as defined in 6.2), `twoDevices()` (two browser contexts), `serverCounts()` (queries the API). Add a NestJS chaos middleware enabled by `CHAOS_ENABLED` with `CHAOS_LATENCY_MS`, `CHAOS_FAILURE_RATE`, `CHAOS_DROP_RATE` (drop after commit). Implement scenarios T-01 to T-15 where automatable, and mark manual ones with `test.skip` plus instructions.

Acceptance: `pnpm test:e2e` runs green locally against `next start` and the server.

### Prompt 15: Metrics and test report

> Read @PLAN.md, sections 6.4 and the Point 6 deliverable. Add a Playwright reporter that writes per-test metrics JSON (sync duration, payload size, retries, data-loss and duplicate counts, time to first render offline, IndexedDB size per card) to `e2e/results/`. Create `e2e/scripts/aggregate-results.ts` producing Markdown tables and CSV files. Add `lighthouserc.json`. Generate `docs/test-report.md` as a template with sections for method, environment, results tables (filled by the script), charts placeholders, limitations, and conclusions.

Acceptance: running the e2e suite and then the aggregate script fills the results tables in `docs/test-report.md`.

---

## Suggested timeline

An indicative 16-week schedule. Adjust it to the semester calendar and advisor checkpoints.

| Week | Thesis point | Work | Milestone |
|---|---|---|---|
| 1 | Phase 0, Point 1 | Housekeeping (Prompt 1), domain analysis, DD1380 field inventory | Repo builds cleanly |
| 2 | Point 1 | Actors, use cases, FR/NFR, MoSCoW, traceability matrix | `docs/requirements.md` draft |
| 3 | Point 2 | Technology review, Spikes A to D (Prompt 6 started as a spike) | `docs/technology-review.md` draft |
| 4 | Point 3 | Shared package, Prisma schema, migrations, seed (Prompts 2, 3) | **Schema frozen** |
| 5 | Point 3 | Dexie layer and repositories (Prompt 7), ER diagram | `docs/data-model.md` draft |
| 6 | Point 5 (server) | CasualtiesModule, HealthModule (Prompt 4) | API documented in Swagger |
| 7 | Point 4 (server) | SyncModule (Prompt 5) | Idempotent push/pull tested |
| 8 | Point 4 (client) | Serwist finalization (Prompt 6), sync engine (Prompt 8) | **Offline sync working end to end** |
| 9 | Point 5 (client) | App shell, i18n, list page (Prompts 9, 10) | App usable offline for listing |
| 10 | Point 5 (client) | New-card wizard (Prompt 11) | **Offline CRUD working** |
| 11 | Point 5 (client) | View, edit, quick vitals, print, sync/settings pages (Prompts 12, 13) | Feature complete |
| 12 | Point 6 | Playwright setup, chaos middleware, scenarios (Prompt 14) | Automated scenarios green |
| 13 | Point 6 | Metrics, Lighthouse, manual usability measurements (Prompt 15) | **Tests complete**, results collected |
| 14 | Point 6 | Results analysis, charts, `docs/test-report.md` | Test chapter draft |
| 15 | All | Thesis write-up from the `docs/*.md` sources, figures, screenshots | Full thesis draft to advisor |
| 16 | All | Advisor feedback, bug fixes, final polish, demo preparation | **Thesis submission** |

### Thesis chapter to artifact mapping

| Thesis chapter | Source artifacts |
|---|---|
| 1. Domain analysis and requirements | `docs/requirements.md` |
| 2. PWA technologies review | `docs/technology-review.md`, spike results |
| 3. Data structures and storage | `docs/data-model.md`, `schema.prisma`, Dexie schema, ER diagram |
| 4. Offline mechanisms and synchronization | `docs/sync-design.md`, sequence diagrams, SyncModule and sync engine code |
| 5. Functional modules implementation | `docs/implementation.md`, screenshots, Swagger export |
| 6. Testing and analysis | `docs/test-report.md`, e2e results, Lighthouse reports |
