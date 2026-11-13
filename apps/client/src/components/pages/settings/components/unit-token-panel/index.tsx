"use client";

import { useEffect, useState } from "react";
import { useT } from "@/i18n/use-t";
import { db } from "@/lib/db";
import { parseUnitToken, readUnitToken, resumeAfterTokenChange, saveUnitToken, useSyncStatus } from "@/lib/sync";
import { fieldClass } from "@/components/ui/field";

type Notice = "saved" | "removed" | "invalid" | null;

/** The saved token is never shown again; the field only takes a replacement. */
export function UnitTokenPanel() {
  const { t } = useT();
  const status = useSyncStatus();
  const [draft, setDraft] = useState("");
  const [visible, setVisible] = useState(false);
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    void readUnitToken().then((token) => setHasToken(token != null));
  }, []);

  async function store(token: string | null) {
    await saveUnitToken(token);
    setHasToken(token != null);
    setDraft("");
    setVisible(false);
    setNotice(token ? "saved" : "removed");
    void resumeAfterTokenChange(db);
  }

  const problem = status.authProblem;

  return (
    <form
      id="unit-token"
      aria-labelledby="unit-token-heading"
      className="surface flex scroll-mt-24 flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = parseUnitToken(draft);
        if (!parsed.ok || !parsed.token) {
          setNotice("invalid");
          return;
        }
        void store(parsed.token);
      }}
    >
      <h2 id="unit-token-heading" className="text-lg font-medium">
        {t("unitToken.heading")}
      </h2>
      <p className="text-sm text-muted">{t("unitToken.hint")}</p>
      {problem ? (
        <p role="alert" className="error-text">
          {t(problem === "rejected" ? "unitToken.rejected" : "unitToken.missing")}
        </p>
      ) : hasToken === null ? null : (
        <p className="text-sm">{t(hasToken ? "unitToken.isSet" : "unitToken.notSet")}</p>
      )}
      <label className="flex flex-col gap-2 text-sm">
        <span className="font-medium">{t("unitToken.label")}</span>
        <div className="flex gap-2">
          <input
            className={`${fieldClass} min-w-0 flex-1 font-mono`}
            type={visible ? "text" : "password"}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder={t(hasToken ? "unitToken.placeholderSet" : "unitToken.placeholderEmpty")}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setNotice(null);
            }}
          />
          <button type="button" className="btn btn-secondary shrink-0" onClick={() => setVisible((value) => !value)}>
            {t(visible ? "unitToken.hide" : "unitToken.show")}
          </button>
        </div>
      </label>
      {notice === "invalid" ? <p className="error-text">{t("unitToken.invalid")}</p> : null}
      {notice === "saved" && !problem ? <p className="text-sm text-muted">{t("unitToken.saved")}</p> : null}
      {notice === "removed" ? <p className="text-sm text-muted">{t("unitToken.removed")}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary" disabled={draft.trim() === ""}>
          {t("unitToken.save")}
        </button>
        {hasToken ? (
          <button type="button" className="btn btn-secondary" onClick={() => void store(null)}>
            {t("unitToken.clear")}
          </button>
        ) : null}
      </div>
    </form>
  );
}
