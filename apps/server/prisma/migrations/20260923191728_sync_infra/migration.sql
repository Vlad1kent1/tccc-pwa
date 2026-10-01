-- Pull cursor for synchronization: every write to a card aggregate takes the next value
-- (see src/prisma/change-seq.ts).
CREATE SEQUENCE IF NOT EXISTS card_change_seq;

-- Value ranges mirror packages/shared/src/schemas/card.ts (docs/requirements.md, Section 5).
ALTER TABLE "VitalSigns"
  ADD CONSTRAINT vitals_pulse_chk     CHECK ("pulseRate" IS NULL OR "pulseRate" BETWEEN 0 AND 300),
  ADD CONSTRAINT vitals_systolic_chk  CHECK ("systolic" IS NULL OR "systolic" BETWEEN 0 AND 300),
  ADD CONSTRAINT vitals_diastolic_chk CHECK ("diastolic" IS NULL OR "diastolic" BETWEEN 0 AND 200),
  ADD CONSTRAINT vitals_resp_chk      CHECK ("respiratoryRate" IS NULL OR "respiratoryRate" BETWEEN 0 AND 80),
  ADD CONSTRAINT vitals_spo2_chk      CHECK ("spo2" IS NULL OR "spo2" BETWEEN 0 AND 100),
  ADD CONSTRAINT vitals_pain_scale_chk CHECK ("painScale" IS NULL OR "painScale" BETWEEN 0 AND 10);

ALTER TABLE "CasualtyCard"
  ADD CONSTRAINT card_responder_last4_chk CHECK ("responderLast4" IS NULL OR "responderLast4" ~ '^[0-9]{4}$');

ALTER TABLE "FluidAdministration"
  ADD CONSTRAINT fluid_volume_chk CHECK ("volumeMl" BETWEEN 1 AND 10000);

ALTER TABLE "InjurySite"
  ADD CONSTRAINT injury_site_x_chk CHECK ("x" IS NULL OR "x" BETWEEN 0 AND 1),
  ADD CONSTRAINT injury_site_y_chk CHECK ("y" IS NULL OR "y" BETWEEN 0 AND 1);
