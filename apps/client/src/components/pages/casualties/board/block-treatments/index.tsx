"use client";

import { memo } from "react";
import { AirwayTreatment, BreathingTreatment, CirculationTreatment } from "@tccc/shared";
import { useT } from "@/i18n/use-t";
import { Block } from "@/components/pages/casualties/board/block";
import { CheckOption } from "@/components/pages/casualties/board/check-option";
import { useBoard, useSlice } from "@/components/pages/casualties/board/store";
import { TextField } from "@/components/pages/casualties/board/text-field";

export const TreatmentBlock = memo(function TreatmentBlock() {
  const { t } = useT();
  return (
    <Block title={t("block6.title")} note={t("block6.note")}>
      <CirculationFields />
      <CheckGroup
        title={t("block6.airway")}
        slice="airway"
        typeKey="airwayType"
        items={[
          [AirwayTreatment.INTACT, "block6.intact"],
          [AirwayTreatment.NPA, "block6.npa"],
          [AirwayTreatment.CRIC, "block6.cric"],
          [AirwayTreatment.ET_TUBE, "block6.etTube"],
          [AirwayTreatment.SGA, "block6.sga"],
        ]}
      />
      <CheckGroup
        title={t("block6.breathing")}
        slice="breathing"
        typeKey="breathingType"
        items={[
          [BreathingTreatment.O2, "block6.o2"],
          [BreathingTreatment.NEEDLE_D, "block6.needle"],
          [BreathingTreatment.CHEST_TUBE, "block6.chestTube"],
          [BreathingTreatment.CHEST_SEAL, "block6.chestSeal"],
        ]}
      />
    </Block>
  );
});

function CirculationFields() {
  const board = useBoard();
  const { t } = useT();
  const extremity = useSlice((state) => state.treatments.tqExtremity);
  const junctional = useSlice((state) => state.treatments.tqJunctional);
  const truncal = useSlice((state) => state.treatments.tqTruncal);
  const circulation = useSlice((state) => state.treatments.circulation);
  const dressingOtherType = useSlice((state) => state.treatments.dressingOtherType);
  const otherDressing = circulation.includes(CirculationTreatment.DRESSING);

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-base font-semibold">{t("block6.circulation")}</h3>
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{t("block6.tourniquet")}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <CheckOption label={t("block6.extremity")} checked={extremity} onChange={(checked) => board.editTreatments({ tqExtremity: checked })} />
            <CheckOption label={t("block6.junctional")} checked={junctional} onChange={(checked) => board.editTreatments({ tqJunctional: checked })} />
            <CheckOption label={t("block6.truncal")} checked={truncal} onChange={(checked) => board.editTreatments({ tqTruncal: checked })} />
          </div>
        </div>
        <TypeField field="circulationTqType" />
      </div>
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{t("block6.dressing")}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Flag
              label={t("block6.hemostatic")}
              checked={circulation.includes(CirculationTreatment.HEMOSTATIC)}
              onChange={() => board.toggleTreatment("circulation", CirculationTreatment.HEMOSTATIC)}
            />
            <Flag
              label={t("block6.pressure")}
              checked={circulation.includes(CirculationTreatment.PRESSURE)}
              onChange={() => board.toggleTreatment("circulation", CirculationTreatment.PRESSURE)}
            />
            <div className="flex flex-col gap-2">
              <Flag
                label={t("block6.dressingOther")}
                checked={otherDressing}
                onChange={() => board.toggleTreatment("circulation", CirculationTreatment.DRESSING)}
              />
              {otherDressing ? (
                <TextField
                  label={t("block6.dressingSpecify")}
                  maxLength={100}
                  value={dressingOtherType ?? ""}
                  onChange={(value) => board.editTreatments({ dressingOtherType: value.slice(0, 100) || null }, "debounce")}
                  onBlur={() => board.flush()}
                />
              ) : null}
            </div>
          </div>
        </div>
        <TypeField field="circulationDressingType" />
      </div>
    </div>
  );
}

function CheckGroup({
  title,
  slice,
  typeKey,
  items,
}: {
  title: string;
  slice: "airway" | "breathing";
  typeKey: "airwayType" | "breathingType";
  items: readonly (readonly [AirwayTreatment | BreathingTreatment, string])[];
}) {
  const board = useBoard();
  const { t } = useT();
  const selected = useSlice((state) => state.treatments[slice]);
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-base font-semibold">{title}</h3>
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(([item, label]) => (
            <Flag key={item} label={t(label)} checked={(selected as string[]).includes(item)} onChange={() => board.toggleTreatment(slice, item)} />
          ))}
        </div>
        <TypeField field={typeKey} />
      </div>
    </div>
  );
}

/** The DD1380 "Type" column next to a treatment row. */
type TypeColumn = "circulationTqType" | "circulationDressingType" | "airwayType" | "breathingType";

function TypeField({ field }: { field: TypeColumn }) {
  const board = useBoard();
  const { t } = useT();
  const value = useSlice((state) => state.treatments[field]);
  return (
    <TextField
      label={t("block6.type")}
      maxLength={100}
      value={value ?? ""}
      onChange={(next) => board.editTreatments({ [field]: next.slice(0, 100) || null }, "debounce")}
      onBlur={() => board.flush()}
    />
  );
}

function Flag({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return <CheckOption label={label} checked={checked} onChange={onChange} />;
}
