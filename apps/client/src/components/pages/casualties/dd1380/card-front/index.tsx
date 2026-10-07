"use client";

import { useCardCopy } from "@/components/pages/casualties/dd1380/copy";
import { InjurySection } from "@/components/pages/casualties/dd1380/injury-section";
import { RosterEvac } from "@/components/pages/casualties/dd1380/roster-evac";
import { Cell, Choice, Dash, DropHeading, Line, Mark, Pick, Specify, UaSheet, useCardChoices } from "@/components/pages/casualties/dd1380/ua-fields";

const SEX = ["male", "female"] as const;

const MECHANISMS_ROW1 = [
  ["mechanism_artillery", "artillery"],
  ["mechanism_blunt", "blunt"],
  ["mechanism_burn", "burn"],
  ["mechanism_fall", "fall"],
  ["mechanism_grenade", "grenade"],
  ["mechanism_gsw", "gsw"],
] as const;

const MECHANISMS_ROW2 = [
  ["mechanism_ied", "ied"],
  ["mechanism_landmine", "landmine"],
  ["mechanism_mvc", "mvc"],
  ["mechanism_rpg", "rpg"],
  ["mechanism_other", "other"],
] as const;

const COL = [
  { time: "time1", pulse: "pulse1", sys: "bloodPressureA1", dia: "bloodPressureB1", rr: "respRate1", o2: "o2sat1", avpu: "avpu1", pain: "pain1" },
  { time: "time2", pulse: "pulse2", sys: "bloodPressureA2", dia: "bloodPressureB2", rr: "respRate2", o2: "o2sat2", avpu: "avpu2", pain: "pain2" },
  { time: "time3", pulse: "pulse3", sys: "bloodPressureA3", dia: "bloodPressureB3", rr: "respRate3", o2: "o2sat3", avpu: "avpu3", pain: "pain3" },
  { time: "time4", pulse: "pulse4", sys: "bloodPressureA4", dia: "bloodPressureB4", rr: "respRate4", o2: "o2sat4", avpu: "avpu4", pain: "pain4" },
] as const;

export function CardFront() {
  const copy = useCardCopy();
  return (
    <UaSheet label={copy.sheetFront} className="print:break-after-page">
      <div className="flex h-full min-h-0 flex-1 flex-col px-[0.45em] pt-[0.28em] pb-[0.35em] print:h-auto print:flex-none">
        <RosterEvac />
        <Identity />
        <Dash />
        <Mechanism />
        <Dash />
        <InjurySection />
        <Dash />
        <Vitals />
      </div>
    </UaSheet>
  );
}

function Identity() {
  const copy = useCardCopy();
  return (
    <section aria-label={copy.identity} className="mt-[0.15em]">
      <div className="flex items-end gap-[0.4em]">
        <span className="shrink-0 font-bold">{copy.name}</span>
        <Line name="name" testId="patient-name-input" />
        <span className="shrink-0 font-bold">{copy.last4}</span>
        <Line name="last4" grow={false} className="w-[4.2em]" maxLength={4} inputMode="numeric" />
      </div>
      <div className="mt-[0.22em] flex flex-wrap items-end gap-x-[0.65em] gap-y-[0.15em]">
        <span className="font-bold">{copy.sex}</span>
        <span role="radiogroup" aria-label={copy.sexGroup} className="inline-flex gap-[0.5em]">
          <Choice name="male" group="sex" members={SEX}>
            {copy.male}
          </Choice>
          <Choice name="female" group="sex" members={SEX}>
            {copy.female}
          </Choice>
        </span>
        <span className="font-bold">
          {copy.date} <span className="font-normal italic">{copy.dateHint}</span>:
        </span>
        <Line name="date" grow={false} className="w-[7em]" />
        <span className="font-bold">{copy.time}</span>
        <Line name="time" grow={false} className="w-[4.2em]" />
      </div>
      <div className="mt-[0.22em] flex items-end gap-[0.4em]">
        <span className="shrink-0 font-bold">{copy.service}</span>
        <Line name="service" />
        <span className="shrink-0 font-bold">{copy.unit}</span>
        <Line name="unit" className="flex-[1.35]" />
        <span className="shrink-0 font-bold">{copy.allergies}</span>
        <Line name="allergies" />
      </div>
    </section>
  );
}

function Mechanism() {
  const copy = useCardCopy();
  return (
    <section aria-label={copy.mechanism}>
      <DropHeading cap={copy.mechanismCap} rest={copy.mechanismRest} note={copy.mechanismNote} />
      <div className="mt-[0.28em] flex flex-wrap gap-x-[0.7em] gap-y-[0.18em]">
        {MECHANISMS_ROW1.map(([name, label]) => (
          <Mark key={name} name={name}>
            {copy[label]}
          </Mark>
        ))}
      </div>
      <div className="mt-[0.16em] flex flex-wrap items-end gap-x-[0.7em] gap-y-[0.18em]">
        {MECHANISMS_ROW2.map(([name, label]) =>
          name === "mechanism_other" ? (
            <span key={name} className="inline-flex items-end">
              <Mark name={name}>{copy[label]}</Mark>
              <Specify name="mechanism_specify" />
            </span>
          ) : (
            <Mark key={name} name={name}>
              {copy[label]}
            </Mark>
          ),
        )}
      </div>
    </section>
  );
}

function Vitals() {
  const copy = useCardCopy();
  const choices = useCardChoices();
  return (
    <section aria-label={copy.vitals}>
      <DropHeading cap={copy.vitalsCap} rest={copy.vitalsRest} note={copy.vitalsNote} />
      <table className="ua-grid mt-[0.3em] w-full table-fixed border-collapse text-center">
        <colgroup>
          <col className="w-[36%]" />
          <col />
          <col />
          <col />
          <col />
        </colgroup>
        <tbody>
          <tr>
            <th className="border-r border-b border-black pr-[0.35em] text-right">{copy.timeCol}</th>
            {COL.map((col) => (
              <td key={col.time} className="border border-black">
                <Cell name={col.time} />
              </td>
            ))}
          </tr>
          <tr className="bg-[#dcdcdc]">
            <th className="border border-black px-[0.25em] text-right">{copy.pulse}</th>
            {COL.map((col) => (
              <td key={col.pulse} className="border border-black bg-[#dcdcdc]">
                <Cell name={col.pulse} />
              </td>
            ))}
          </tr>
          <tr>
            <th className="border border-black px-[0.25em] text-right">{copy.bp}</th>
            {COL.map((col) => (
              <td key={col.sys} className="border border-black">
                <div className="flex items-center">
                  <Cell name={col.sys} />
                  <span className="font-bold">/</span>
                  <Cell name={col.dia} />
                </div>
              </td>
            ))}
          </tr>
          <tr>
            <th className="border border-black px-[0.25em] text-right">{copy.rr}</th>
            {COL.map((col) => (
              <td key={col.rr} className="border border-black">
                <Cell name={col.rr} />
              </td>
            ))}
          </tr>
          <tr>
            <th className="border border-black px-[0.25em] text-right">{copy.o2}</th>
            {COL.map((col) => (
              <td key={col.o2} className="border border-black">
                <Cell name={col.o2} />
              </td>
            ))}
          </tr>
          <tr className="bg-[#dcdcdc]">
            <th className="border border-black px-[0.25em] text-right">{copy.avpu}</th>
            {COL.map((col) => (
              <td key={col.avpu} className="border border-black bg-[#dcdcdc]">
                <Pick name={col.avpu} options={choices.avpu} />
              </td>
            ))}
          </tr>
          <tr className="bg-[#dcdcdc]">
            <th className="border border-black px-[0.25em] text-right">{copy.pain}</th>
            {COL.map((col) => (
              <td key={col.pain} className="border border-black bg-[#dcdcdc]">
                <Pick name={col.pain} options={choices.pain} />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </section>
  );
}
