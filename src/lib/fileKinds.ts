export type FileKind = "pdf" | "word" | "excel" | "slides";

export interface KindInfo {
  label: string;
  /** Tailwind background class with the kind's label-ink colour. */
  swatch: string;
  /** Tailwind text class in the same colour. */
  text: string;
  extensions: string[];
}

export const FILE_KINDS: Record<FileKind, KindInfo> = {
  pdf: {
    label: "PDF",
    swatch: "bg-pdf",
    text: "text-pdf",
    extensions: ["pdf"],
  },
  word: {
    label: "Word",
    swatch: "bg-word",
    text: "text-word",
    extensions: ["doc", "docx", "docm", "dot", "dotx", "odt", "rtf"],
  },
  excel: {
    label: "Excel",
    swatch: "bg-excel",
    text: "text-excel",
    extensions: ["xls", "xlsx", "xlsm", "xlsb", "csv", "ods"],
  },
  slides: {
    label: "PowerPoint",
    swatch: "bg-slides",
    text: "text-slides",
    extensions: ["ppt", "pptx", "pptm", "pps", "ppsx", "odp"],
  },
};

export const KIND_ORDER: FileKind[] = ["pdf", "word", "excel", "slides"];
