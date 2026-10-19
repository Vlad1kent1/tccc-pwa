"use client";

import { memo, useEffect, useRef, useState } from "react";
import { Gender } from "@tccc/shared";
import { useT } from "@/i18n/use-t";
import { formatDateInput, formatHmm, joinDateAndTime, lastTimeToken } from "@/lib/forms/time";
import { Block } from "@/components/pages/casualties/board/block";
import { StampField } from "@/components/pages/casualties/board/stamp-field";
import { TextField } from "@/components/pages/casualties/board/text-field";
import { useBoard, useSlice } from "@/components/pages/casualties/board/store";

export const PersonalBlock = memo(function PersonalBlock() {
  const board = useBoard();
  const { t } = useT();
  const lastName = useSlice((state) => state.identity.lastName);
  const firstName = useSlice((state) => state.identity.firstName);
  const gender = useSlice((state) => state.identity.gender);
  const injuredAt = useSlice((state) => state.identity.injuredAt);
  const allergies = useSlice((state) => state.identity.allergies);
  const last4 = useSlice((state) => state.identity.casualtyLast4);
  const service = useSlice((state) => state.identity.service);
  const unit = useSlice((state) => state.identity.unit);
  const [timeText, setTimeText] = useState("");
  const [dateText, setDateText] = useState("");
  const timeLock = useRef(false);
  const dateLock = useRef(false);
  const canonical = formatHmm(injuredAt);
  const canonicalDate = formatDateInput(injuredAt);

  useEffect(() => {
    setTimeText((current) => (timeLock.current || lastTimeToken(current) === canonical ? current || canonical : canonical));
  }, [canonical]);

  useEffect(() => {
    setDateText((current) => (dateLock.current ? current : canonicalDate));
  }, [canonicalDate]);

  /** Saves the injury time once it is complete. A date without a time is kept on screen, not saved as midnight. */
  function writeInjury(date: string, time: string): void {
    const iso = joinDateAndTime(date, time, injuredAt);
    if (iso !== undefined) board.editIdentity({ injuredAt: iso }, "now");
  }

  function writeTime(next: string): void {
    timeLock.current = true;
    setTimeText(next);
    writeInjury(dateText, next);
  }

  return (
    <Block title={t("block2.title")}>
      <p className="text-sm font-medium">{t("block2.name")}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          label={t("block2.lastName")}
          testId="patient-name-input"
          maxLength={100}
          value={lastName ?? ""}
          onChange={(value) => board.editIdentity({ lastName: value || null })}
          onBlur={() => board.flush()}
        />
        <TextField
          label={t("block2.firstName")}
          maxLength={100}
          value={firstName ?? ""}
          onChange={(value) => board.editIdentity({ firstName: value || null })}
          onBlur={() => board.flush()}
        />
        <TextField
          label={t("block2.last4")}
          inputMode="numeric"
          maxLength={4}
          value={last4 ?? ""}
          onChange={(value) => board.editIdentity({ casualtyLast4: value.replace(/\D/g, "").slice(0, 4) || null })}
          onBlur={() => board.flush()}
        />
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t("block2.gender")}</span>
          <div role="radiogroup" aria-label={t("block2.gender")} className="grid grid-cols-2 gap-2">
            {(
              [
                [Gender.MALE, "block2.male", "block2.maleAria"],
                [Gender.FEMALE, "block2.female", "block2.femaleAria"],
              ] as const
            ).map(([item, label, aria]) => {
              const on = gender === item;
              return (
                <button
                  key={item}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={t(aria)}
                  className={on ? "chip chip-on min-h-14" : "chip min-h-14"}
                  onClick={() => board.editIdentity({ gender: on ? null : item }, "now")}
                >
                  {t(label)}
                </button>
              );
            })}
          </div>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">
            {t("block2.date")} <span className="font-normal text-muted">{t("block2.dateHint")}</span>
          </span>
          <input
            type="date"
            className="input min-h-12"
            value={dateText}
            onChange={(event) => {
              dateLock.current = true;
              setDateText(event.target.value);
              writeInjury(event.target.value, timeText);
            }}
            onBlur={() => board.flush()}
          />
        </label>
        <StampField label={t("block2.time")} value={timeText} onChange={writeTime} onBlur={() => board.flush()} />
        <TextField
          label={t("block2.service")}
          maxLength={100}
          value={service ?? ""}
          onChange={(value) => board.editIdentity({ service: value.slice(0, 100) || null })}
          onBlur={() => board.flush()}
        />
        <TextField
          label={t("block2.unit")}
          maxLength={100}
          value={unit ?? ""}
          onChange={(value) => board.editIdentity({ unit: value.slice(0, 100) || null })}
          onBlur={() => board.flush()}
        />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="casualty-allergies" className="text-base font-semibold">
            {t("block2.allergies")}
          </label>
          <button type="button" className="btn btn-secondary" onClick={() => board.editIdentity({ allergies: t("block2.nkaValue") }, "now")}>
            {t("block2.nka")}
          </button>
        </div>
        <textarea
          id="casualty-allergies"
          className="input min-h-24 border-2 border-warning py-3 text-lg"
          maxLength={500}
          value={allergies ?? ""}
          onChange={(event) => board.editIdentity({ allergies: event.target.value || null })}
          onBlur={() => board.flush()}
        />
      </div>
    </Block>
  );
});
