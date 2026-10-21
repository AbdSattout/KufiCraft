"use client";

import {
  useCallback,
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useAction } from "convex/react";
import { KeyRound, UserPlus } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import { MAX_ACCOUNT_NAME_LENGTH } from "@/lib/account-name";
import { AuthAlert } from "@/components/auth/auth-alert";
import { hardNavigate } from "@/components/auth/hard-navigate";
import {
  authReducer,
  initialAuthState,
  planAuthSubmit,
} from "@/components/auth/auth-state";
import {
  conditionalUiSupported,
  isCancellation,
  passkeyErrorMessage,
  unexpectedErrorMessage,
  usePasskeySupport,
} from "@/components/auth/passkey-errors";
import { Button } from "@/components/ui/button";
import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

const INVALID_NAME_MESSAGE = "اكتب اسمًا للحساب (1–60 حرفًا).";

/**
 * The one auth surface: a single field and a single button, in the dialog
 * `SignInDialogProvider` owns.
 *
 * The field is both the WebAuthn username field and the new-account name
 * (`planAuthSubmit`): **empty** submits a sign-in `get()` — and conditional UI
 * offers the device's saved passkeys in the browser's own autofill, so
 * choosing one signs in without touching the button — while **a typed name**
 * submits a registration `create()` for an account with that name.
 *
 * Two things this deliberately does *not* do: infer "no account" from a
 * failed or cancelled `get()`, and let one failure disable the other path.
 * The visitor chooses the intent by typing, never by failing.
 */
export function AuthPanel() {
  const createSignUpContext = useAction(api.authFlows.createSignUpContext);
  const supported = usePasskeySupport();
  const [state, dispatch] = useReducer(authReducer, initialAuthState);
  const [value, setValue] = useState("");
  /**
   * Bumped to (re)arm conditional UI. A manual `get()`/`create()` aborts the
   * pending conditional ceremony, so it has to be armed again when it settles;
   * without this, suggestions die for good after the first attempt.
   */
  const [conditionalArm, setConditionalArm] = useState(0);
  /**
   * True between choosing a saved passkey and the attempt settling. The button
   * shows a spinner for it, exactly as it does for a button press.
   */
  const [conditionalBusy, setConditionalBusy] = useState(false);
  const busyRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  /** True once the user has typed; browser passkey autofill never presses a key. */
  const typedRef = useRef(false);
  /** True while a conditional `get()` is waiting for the autofill UI. */
  const conditionalPendingRef = useRef(false);
  /** True between a passkey selection and that conditional settling. */
  const conditionalVerifyingRef = useRef(false);
  /** Clears a field-fill guess if no passkey ceremony follows it. */
  const fillTimeoutRef = useRef<number | undefined>(undefined);
  const idPrefix = useId();

  const busy = state.busy || conditionalBusy;
  const creating = value.trim() !== "" && !conditionalBusy;

  /**
   * Enter the same busy state as the button path once a selection is likely:
   *
   * - `verify`: the assertion exists and `/passkey/verify-authentication` is
   *   starting. This is the browser-independent signal that the visitor chose
   *   a passkey, and it covers the server round trip that follows.
   * - `fill`: only the username field changed without typing. Chrome's passkey
   *   autofill can set the value without firing an `input` event, so React's
   *   onChange may never see it. A password manager can also fill this field
   *   without starting a ceremony, so this guess expires on its own.
   */
  const markConditionalVerifying = useCallback(
    (source: "fill" | "verify", autofilledName?: string) => {
      window.clearTimeout(fillTimeoutRef.current);
      fillTimeoutRef.current = undefined;

      if (!conditionalVerifyingRef.current) {
        conditionalVerifyingRef.current = true;
        busyRef.current = true;
        setConditionalBusy(true);
        dispatch({ type: "RESET" });
      }

      if (autofilledName !== undefined) setValue(autofilledName);

      if (source === "fill") {
        fillTimeoutRef.current = window.setTimeout(() => {
          if (!conditionalPendingRef.current) return;
          conditionalVerifyingRef.current = false;
          busyRef.current = false;
          setConditionalBusy(false);
        }, 15_000);
      }
    },
    [],
  );

  useEffect(() => {
    return () => window.clearTimeout(fillTimeoutRef.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let poll: number | undefined;
    conditionalPendingRef.current = true;

    function finishVerifying(keepBusy: boolean): boolean {
      const wasVerifying = conditionalVerifyingRef.current;
      conditionalVerifyingRef.current = false;
      conditionalPendingRef.current = false;
      window.clearTimeout(fillTimeoutRef.current);
      fillTimeoutRef.current = undefined;
      if (wasVerifying && !keepBusy) {
        busyRef.current = false;
        setConditionalBusy(false);
      }
      return wasVerifying;
    }

    void (async () => {
      if (!(await conditionalUiSupported())) {
        if (!cancelled) finishVerifying(false);
        return;
      }
      if (cancelled) return;

      /**
       * Chrome can fill the username field straight from the passkey list
       * without dispatching an `input` event, so React's onChange never sees
       * it. Poll the DOM while the conditional request is pending; typing is
       * tracked separately so a typed name is never mistaken for a selection.
       */
      poll = window.setInterval(() => {
        if (
          !conditionalPendingRef.current ||
          conditionalVerifyingRef.current ||
          typedRef.current
        ) {
          return;
        }
        const field = inputRef.current;
        if (field && field.value !== "") {
          markConditionalVerifying("fill", field.value);
        }
      }, 150);

      try {
        const result = await authClient.signIn.passkey({
          autoFill: true,
          fetchOptions: {
            // Runs immediately before the assertion is sent to the server:
            // the reliable "the visitor picked a passkey" moment.
            onRequest: () => markConditionalVerifying("verify"),
          },
        });
        if (cancelled) return;

        const succeeded = Boolean(result?.data?.session);
        // On success keep the spinner through the full-page navigation, so the
        // dialog never sits idle between verification and the board loading.
        const wasVerifying = finishVerifying(succeeded);

        if (succeeded) {
          hardNavigate("/");
          return;
        }

        /**
         * The autofilled value is the passkey's name, not something the visitor
         * typed: leaving it would let the button offer to *create* an account
         * with the name of the credential that just failed. Clear what we
         * filled, keep what was typed.
         */
        if (!typedRef.current) setValue("");

        if (wasVerifying) {
          dispatch({
            type: "FAIL",
            message: passkeyErrorMessage(result?.error),
          });
          // The selection consumed the arm; offer the suggestions again.
          if (!typedRef.current) setConditionalArm((arm) => arm + 1);
        } else if (result?.error && !isCancellation(result.error)) {
          dispatch({
            type: "FAIL",
            message: passkeyErrorMessage(result.error),
          });
        }
      } catch (cause) {
        if (cancelled) return;
        const wasVerifying = finishVerifying(false);
        if (!typedRef.current) setValue("");
        if (wasVerifying) {
          dispatch({
            type: "FAIL",
            message: unexpectedErrorMessage(cause),
          });
          if (!typedRef.current) setConditionalArm((arm) => arm + 1);
        }
      }
    })();

    return () => {
      cancelled = true;
      conditionalPendingRef.current = false;
      if (poll !== undefined) window.clearInterval(poll);
    };
  }, [conditionalArm, markConditionalVerifying]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;

    const plan = planAuthSubmit(value);
    if (plan.action === "invalid-name") {
      dispatch({ type: "FAIL", message: INVALID_NAME_MESSAGE });
      inputRef.current?.focus();
      return;
    }

    busyRef.current = true;
    dispatch({ type: "START" });
    try {
      if (plan.action === "sign-in") {
        const result = await authClient.signIn.passkey();
        if (result?.data?.session) {
          dispatch({ type: "SUCCESS" });
          hardNavigate("/");
          return;
        }
        dispatch({
          type: "FAIL",
          message: passkeyErrorMessage(result?.error),
        });
        return;
      }

      const { context } = await createSignUpContext({ name: plan.name });
      const result = await authClient.passkey.addPasskey({ context });
      if (result.error || !result.data) {
        dispatch({
          type: "FAIL",
          message: passkeyErrorMessage(result.error),
        });
        return;
      }
      dispatch({ type: "SUCCESS" });
      // The registration endpoint created the account and opened a session,
      // so a full navigation lands on the boards already signed in.
      hardNavigate("/");
    } catch (cause) {
      dispatch({
        type: "FAIL",
        message: unexpectedErrorMessage(cause),
      });
    } finally {
      busyRef.current = false;
      /**
       * Only a sign-in attempt needs the conditional ceremony back: it is the
       * one that aborts it. While a name is typed the field is a creation
       * form, and suggestions would only confuse the two intents.
       */
      if (plan.action === "sign-in") {
        setConditionalArm((arm) => arm + 1);
      }
    }
  }

  function handleChange(next: string) {
    if (next !== value) dispatch({ type: "RESET" });
    setValue(next);

    if (next === "") {
      typedRef.current = false;
      // Clearing the field switches back to sign-in: offer saved passkeys.
      if (!conditionalVerifyingRef.current) {
        setConditionalArm((arm) => arm + 1);
      }
      return;
    }

    if (!typedRef.current && conditionalPendingRef.current) {
      markConditionalVerifying("fill", next);
    }
  }

  function handleFocus() {
    // Focusing an empty field means the visitor is at the sign-in door.
    if (value.trim() === "") setConditionalArm((arm) => arm + 1);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-xl">الدخول إلى KufiCraft</DialogTitle>
        <DialogDescription>
          حسابك هو مفتاح المرور نفسه — اسم واحد ومفتاح واحد، بلا كلمة مرور.
        </DialogDescription>
      </DialogHeader>

      <form
        onSubmit={(event) => void handleSubmit(event)}
        noValidate
        className="flex flex-col gap-3"
        aria-busy={busy}
      >
        <Field data-invalid={state.error !== null}>
          <FieldLabel htmlFor={`${idPrefix}-account`}>
            اسم الحساب
          </FieldLabel>
          <Input
            ref={inputRef}
            id={`${idPrefix}-account`}
            name="username"
            type="text"
            dir="auto"
            autoComplete="username webauthn"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            value={value}
            onChange={(event) => handleChange(event.target.value)}
            onKeyDown={(event) => {
              // Tab/arrows/Escape are not typing; autofill never presses a key.
              if (
                event.key.length === 1 ||
                event.key === "Backspace" ||
                event.key === "Delete"
              ) {
                typedRef.current = true;
              }
            }}
            onCompositionStart={() => {
              typedRef.current = true;
            }}
            onPaste={() => {
              typedRef.current = true;
            }}
            onFocus={handleFocus}
            maxLength={MAX_ACCOUNT_NAME_LENGTH}
            disabled={!supported || busy}
            aria-invalid={state.error !== null}
            aria-describedby={`${idPrefix}-help`}
          />
          <FieldDescription id={`${idPrefix}-help`}>
            لديك حساب؟ اتركه فارغًا واضغط «الدخول»، أو اختر مفتاحك المحفوظ من
            اقتراحات المتصفح. جديد؟ اكتب اسمًا ثم اضغط «إنشاء حساب».
          </FieldDescription>
          {state.error ? <FieldError>{state.error}</FieldError> : null}
        </Field>

        <Button
          type="submit"
          disabled={!supported || busy}
          aria-busy={busy}
          className="w-fit"
        >
          {busy ? (
            <Spinner />
          ) : creating ? (
            <UserPlus aria-hidden />
          ) : (
            <KeyRound aria-hidden />
          )}
          {conditionalBusy
            ? "جارٍ الدخول…"
            : creating
              ? "إنشاء حساب"
              : "الدخول بمفتاح المرور"}
        </Button>
      </form>

      {!supported ? (
        <AuthAlert variant="info">
          متصفحك لا يدعم مفاتيح المرور. جرّب متصفحًا حديثًا على جهاز يدعم
          WebAuthn.
        </AuthAlert>
      ) : null}
    </>
  );
}
