"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { SIGN_IN_QUERY } from "@/lib/route-guards";
import { AuthPanel } from "@/components/auth/auth-panel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";

/**
 * The sign-in/sign-up dialog.
 *
 * There is no sign-in route and no separate sign-up surface: signing in and
 * creating an account are the two intents of one field in one dialog
 * (`src/components/auth/auth-panel.tsx`), and every CTA (`SignInButton`,
 * `SignInLink`) opens it. The guards send an anonymous visitor who wanted a
 * session screen to `/?signin=1`, which opens the same dialog.
 */
type SignInDialogContextValue = {
  openSignIn: () => void;
};

const SignInDialogContext = createContext<SignInDialogContextValue | null>(null);

export function useSignInDialog(): SignInDialogContextValue {
  const value = useContext(SignInDialogContext);
  if (value === null) {
    throw new Error("useSignInDialog must be used inside <SignInDialogProvider>");
  }
  return value;
}

const subscribeToNothing = () => () => {};

/**
 * True when the URL asks for the dialog (`/?signin=1`, where the guards send a
 * visitor who wanted a session screen). Read through `useSyncExternalStore` so
 * the *server* snapshot is always “closed”: the statically prerendered landing
 * never contains an open dialog, and the client opens it immediately after
 * hydration — no state-setting effect, and no hydration mismatch.
 */
function readSignInFlag(): boolean {
  return (
    new URLSearchParams(window.location.search).get(SIGN_IN_QUERY) === "1"
  );
}

/** Drops `?signin=1` without asking the server for the page again. */
function clearSignInFlag(): void {
  const params = new URLSearchParams(window.location.search);
  if (!params.has(SIGN_IN_QUERY)) return;
  params.delete(SIGN_IN_QUERY);
  const query = params.toString();
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
  );
}

export function SignInDialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [dismissedFromUrl, setDismissedFromUrl] = useState(false);
  const fromUrl = useSyncExternalStore(
    subscribeToNothing,
    readSignInFlag,
    () => false,
  );

  const openSignIn = useCallback(() => {
    setDismissedFromUrl(false);
    setOpen(true);
  }, []);

  const contextValue = useMemo(() => ({ openSignIn }), [openSignIn]);

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      openSignIn();
      return;
    }
    setOpen(false);
    if (fromUrl) {
      // Dismissing a dialog the URL asked for must stick: without this the very
      // next render would see the flag and open it again.
      clearSignInFlag();
      setDismissedFromUrl(true);
    }
  }

  const dialogOpen = open || (fromUrl && !dismissedFromUrl);

  return (
    <SignInDialogContext.Provider value={contextValue}>
      {children}
      <Dialog open={dialogOpen} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          {dialogOpen ? <AuthPanel /> : null}
        </DialogContent>
      </Dialog>
    </SignInDialogContext.Provider>
  );
}

/** A CTA that opens the dialog: the header's and the landing's primary actions. */
export function SignInButton({
  children,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { openSignIn } = useSignInDialog();
  return (
    <Button type="button" onClick={openSignIn} {...props}>
      {children}
    </Button>
  );
}

/** The dialog-opening twin of a text link (the landing footer's). */
export function SignInLink({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { openSignIn } = useSignInDialog();
  return (
    <button type="button" onClick={openSignIn} className={className}>
      {children}
    </button>
  );
}
