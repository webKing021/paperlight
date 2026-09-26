export type FileKind = "pdf" | "word" | "excel" | "slides";

export interface KindInfo {
  label: string;
  /** Tailwind classes for the small coloured type chip. */
  chip: string;
  extensions: string[];
}

export const FILE_KINDS: Record<FileKind, KindInfo> = {
  pdf: {
    label: "PDF",
    chip: "bg-red-500/12 text-red-600 dark:text-red-400",
    extensions: ["pdf"],
  },
  word: {
    label: "Word",
    chip: "bg-blue-500/12 text-blue-600 dark:text-blue-400",
    extensions: ["doc", "docx", "docm", "dot", "dotx", "odt", "rtf"],
  },
  excel: {
    label: "Excel",
    chip: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
    extensions: ["xls", "xlsx", "xlsm", "xlsb", "csv", "ods"],
  },
  slides: {
    label: "PowerPoint",
    chip: "bg-orange-500/12 text-orange-600 dark:text-orange-400",
    extensions: ["ppt", "pptx", "pptm", "pps", "ppsx", "odp"],
  },
};

export const KIND_ORDER: FileKind[] = ["pdf", "word", "excel", "slides"];

export const KIND_DOT: Record<FileKind, string> = {
  pdf: "bg-red-500",
  word: "bg-blue-500",
  excel: "bg-emerald-500",
  slides: "bg-orange-500",
};
