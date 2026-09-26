export type FileKind = "pdf" | "word" | "excel" | "slides";

export interface KindInfo {
  label: string;
  extensions: string[];
}

export const FILE_KINDS: Record<FileKind, KindInfo> = {
  pdf: {
    label: "PDF",
    extensions: ["pdf"],
  },
  word: {
    label: "Word",
    extensions: ["doc", "docx", "docm", "dot", "dotx", "odt", "rtf"],
  },
  excel: {
    label: "Excel",
    extensions: ["xls", "xlsx", "xlsm", "xlsb", "csv", "ods"],
  },
  slides: {
    label: "PowerPoint",
    extensions: ["ppt", "pptx", "pptm", "pps", "ppsx", "odp"],
  },
};

export const KIND_ORDER: FileKind[] = ["pdf", "word", "excel", "slides"];

/** Kinds with at least one format the user indexes (the rest get no view or bucket). */
export function enabledKinds(disabled: string[] | undefined): FileKind[] {
  if (!disabled?.length) return KIND_ORDER;
  const off = new Set(disabled);
  return KIND_ORDER.filter((k) => FILE_KINDS[k].extensions.some((e) => !off.has(e)));
}
