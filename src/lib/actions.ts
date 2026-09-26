import { api, type FileRow } from "./api";
import { useIndex } from "../stores";
import { useUi } from "../stores/ui";

const toast = (text: string, tone?: "info" | "error") => useUi.getState().toast(text, tone);
const touched = () => useIndex.getState().touched();

/** A failed open usually means the file vanished; the backend dropped it, so refresh lists. */
function onMissing(e: unknown) {
  toast(String(e), "error");
  touched();
}

export async function openFile(row: FileRow) {
  try {
    await api.openFile(row.id);
    touched(); // feeds "Recently opened"
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

export async function toggleFavourite(row: FileRow) {
  try {
    await api.setFavourite(row.id, !row.isFavourite);
    toast(row.isFavourite ? "Removed from favourites" : "Added to favourites");
    touched();
  } catch (e) {
    toast(String(e), "error");
  }
}

export async function toggleTag(row: FileRow, tagId: number) {
  try {
    await api.setFileTag(row.id, tagId, !row.tags.includes(tagId));
    touched();
  } catch (e) {
    toast(String(e), "error");
  }
}

/** Stops indexing a folder; its documents leave Paperlight (nothing on disk changes). */
export async function excludeFolder(path: string) {
  try {
    const removed = await api.addExclusion(path);
    const docs = removed === 1 ? "1 document" : `${removed.toLocaleString()} documents`;
    toast(`Excluded ${path}: ${docs} removed from Paperlight. Undo in Settings.`);
    touched();
  } catch (e) {
    toast(String(e), "error");
  }
}

/** Creates a tag (or reuses one with that name) and puts it on `row`. */
export async function tagWithNew(row: FileRow, name: string) {
  try {
    const tag = await api.createTag(name);
    await api.setFileTag(row.id, tag.id, true);
    toast(`Tagged “${tag.name}”`);
    touched();
  } catch (e) {
    toast(String(e), "error");
  }
}
