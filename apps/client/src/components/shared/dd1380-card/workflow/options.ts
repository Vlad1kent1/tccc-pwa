export const ROUTE_OPTIONS = ["IM", "IV", "IO", "PO", "IN", "PR", "SL", "SQ"] as const;

/** Stored values stay the PDF strings. `uk` is only the visible label. */
export const AVPU_CHOICES = [
  { value: "A - Alert", uk: "A - Притомний" },
  { value: "V - Verbal", uk: "V - На голос" },
  { value: "P - Pain", uk: "P - На біль" },
  { value: "U - Unresponsive", uk: "U - Без реакції" },
] as const;

export const PAIN_CHOICES = [
  { value: "0 None", uk: "0 Немає" },
  { value: "1 Very Mild", uk: "1 Дуже слабкий" },
  { value: "2 Discomfort", uk: "2 Дискомфорт" },
  { value: "3 Tolerable", uk: "3 Терпимий" },
  { value: "4 Distressing", uk: "4 Тривожний" },
  { value: "5 Very Distress", uk: "5 Дуже тяжкий" },
  { value: "6 Intense", uk: "6 Інтенсивний" },
  { value: "7 Very Intense", uk: "7 Дуже інтенсивний" },
  { value: "8 Horrible", uk: "8 Жахливий" },
  { value: "9 Excruciating", uk: "9 Нестерпний" },
  { value: "10 Unimaginable", uk: "10 Неуявний" },
] as const;
