/** Which system Paperlight is running on, for the few places where wording or paths differ. */
export const IS_WINDOWS = navigator.userAgent.includes("Windows");

/** The path separator of this system. */
export const SEP = IS_WINDOWS ? "\\" : "/";

export const START_LABEL = IS_WINDOWS ? "Start with Windows" : "Start at login";
export const MATCH_LABEL = IS_WINDOWS ? "Match Windows" : "Match system";
/** The key between Ctrl and Alt. */
export const SUPER_KEY = IS_WINDOWS ? "Win" : "Super";
