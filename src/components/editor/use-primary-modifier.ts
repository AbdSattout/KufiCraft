"use client";

import { useSyncExternalStore } from "react";
import type { PrimaryModifier } from "./shortcut-hints";

/** Nothing to subscribe to: the platform does not change at runtime. */
const subscribe = () => () => {};

function isMacPlatform(): boolean {
  return /mac|iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * The *name* of the primary modifier on this platform (`Cmd` on macOS, `Ctrl`
 * elsewhere). The map itself accepts both (`hasPrimary`), so this is only the
 * label the hints and `aria-keyshortcuts` use.
 *
 * `useSyncExternalStore` renders the server snapshot (`Ctrl`) into the SSR
 * HTML and swaps it after hydration, so the `navigator` read can never trip a
 * hydration mismatch.
 */
export function usePrimaryModifier(): PrimaryModifier {
  const mac = useSyncExternalStore(subscribe, isMacPlatform, () => false);
  return mac ? "Cmd" : "Ctrl";
}
