import { api, type FileRow } from "./api";
import { useIndex } from "../stores";
import { useUi } from "../stores/ui";

const toast = (text: string, tone?: "info" | "error") => useUi.getState().toast(text, tone);

/** A failed open usually means the file vanished; the backend dropped it, so refresh lists. */
function onMissing(e: unknown) {
  toast(String(e), "error");
  useIndex.setState((s) => ({ revision: s.revision + 1 }));
  useIndex.getState().refresh();
}

export async function openFile(row: FileRow) {
  try {
    await api.openFile(row.id);
  } catch (e) {
    onMissing(e);
  }
}

export async function revealFile(row: FileRow) {
  try {
    await api.revealFile(row.id);
  } catch (e) {
    onMissing(e);
  }
}

export async function copyPath(row: FileRow) {
  try {
    await navigator.clipboard.writeText(row.path);
    toast("Path copied");
  } catch {
    toast("Could not copy the path", "error");
  }
}
