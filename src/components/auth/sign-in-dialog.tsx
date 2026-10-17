"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useAction } from "convex/react";
import { KeyRound, UserPlus } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import { SIGN_IN_QUERY } from "@/lib/route-guards";
import { AuthAlert } from "@/components/auth/auth-alert";
import { hardNavigate } from "@/components/auth/hard-navigate";
import {
  passkeyErrorMessage,
  unexpectedErrorMessage,
  usePasskeySupport,
  webAuthnSupported,
} from "@/components/auth/passkey-errors";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";

/**
 * The passkey dialog — one button, no fields. Signing in and creating an
 * account are the same ceremony (an account **is** its passkey, see
 * `docs/AUTH.md § Accounts`), so the button starts on sign-in and, only when an
 * attempt comes back without a session, switches to creating the account's
 * single passkey. There is no sign-in route: the landing owns this dialog, and
 * the guards send an anonymous visitor to `/?signin=1` to open it.
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

  return (
    <SignInDialogContext.Provider value={contextValue}>
      {children}
      <Dialog
        open={open || (fromUrl && !dismissedFromUrl)}
        onOpenChange={handleOpenChange}
      >
        <DialogContent>
          <SignInPanel />
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

function SignInPanel() {
  const createSignUpContext = useAction(api.authFlows.createSignUpContext);
  const supported = usePasskeySupport();

  /**
   * Which ceremony the button is offering. It starts on sign-in and only flips
   * to `create` after an attempt came back without a session — a device with no
   * passkey for this site is the only reason to create one.
   */
  const [mode, setMode] = useState<"sign-in" | "create">("sign-in");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const autoAttempted = useRef(false);

  useEffect(() => {
    if (autoAttempted.current) return;
    autoAttempted.current = true;
    if (!webAuthnSupported()) return;
    /**
     * The dialog was opened by a click — the CTA, or the link that reached this
     * page — which is what lets a browser open the passkey sheet without a fresh
     * gesture. Without transient activation (`credentials.get` would reject with
     * `NotAllowedError`, e.g. a reload) the button is the way in, so the attempt
     * is skipped rather than thrown.
     */
    if (navigator.userActivation?.isActive !== true) return;
    void (async () => {
      try {
        const result = await authClient.signIn.passkey();
        if (result?.data?.session) hardNavigate("/");
      } catch {
        // Silent by design: the visitor may simply have no passkey here, and an
        // error nobody asked for is noise. The button reports failures.
      }
    })();
  }, []);

  async function handleSignIn() {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setBusy(true);
    try {
      const result = await authClient.signIn.passkey();
      if (result?.data?.session) {
        hardNavigate("/");
        return;
      }
      setError(passkeyErrorMessage(result?.error));
      setMode("create");
    } catch (cause) {
      setError(unexpectedErrorMessage(cause));
      setMode("create");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function handleCreateAccount() {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setBusy(true);
    try {
      const { context } = await createSignUpContext({});
      const result = await authClient.passkey.addPasskey({ context });
      if (result.error || !result.data) {
        setError(passkeyErrorMessage(result.error));
        return;
      }
      // The registration endpoint created the account and opened a session,
      // so a full navigation lands on the boards already signed in.
      hardNavigate("/");
    } catch (cause) {
      setError(unexpectedErrorMessage(cause));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-xl">الدخول إلى KufiCraft</DialogTitle>
        <DialogDescription>
          حسابك هو مفتاح المرور نفسه — مفتاح واحد يكفي، بلا اسم ولا كلمة مرور.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-3">
        <Button
          type="button"
          onClick={mode === "sign-in" ? handleSignIn : handleCreateAccount}
          disabled={busy || !supported}
          aria-busy={busy}
          className="w-fit"
        >
          {busy ? (
            <Spinner />
          ) : mode === "sign-in" ? (
            <KeyRound aria-hidden />
          ) : (
            <UserPlus aria-hidden />
          )}
          {mode === "sign-in" ? "الدخول بمفتاح المرور" : "إنشاء حساب"}
        </Button>

        {error ? <AuthAlert>{error}</AuthAlert> : null}

        {mode === "create" ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              لا يوجد مفتاح مرور لهذا الموقع على هذا الجهاز — الزر أعلاه ينشئ
              حسابًا جديدًا بمفتاح واحد، بعد تأكيد بصمتك أو قفل جهازك.
            </p>
            <button
              type="button"
              onClick={() => {
                setMode("sign-in");
                setError(null);
              }}
              className="w-fit text-sm text-muted-foreground underline underline-offset-4"
            >
              لديّ مفتاح بالفعل
            </button>
          </div>
        ) : null}

        {!supported ? (
          <AuthAlert variant="info">
            متصفحك لا يدعم مفاتيح المرور. جرّب متصفحًا حديثًا على جهاز يدعم
            WebAuthn.
          </AuthAlert>
        ) : null}
      </div>
    </>
  );
}
