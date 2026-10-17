"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "convex/react";
import { KeyRound } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { authClient } from "@/lib/auth-client";
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

/** Mirrors `MAX_DISPLAY_NAME_LENGTH` in `convex/authFlows.ts` (server re-validates). */
const MAX_DISPLAY_NAME_LENGTH = 60;

/**
 * `/signin`: **one** screen for both ways in — an existing passkey or a brand
 * new account — so there is no sign-in/sign-up split to navigate. A visitor who
 * already has a live session belongs on the boards, so this only ever renders
 * for an anonymous one.
 */
export function SignInScreen() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (session?.user) router.replace("/");
  }, [session?.user, router]);

  if (isPending || session?.user) return <SignInSkeleton />;

  return <AuthCard />;
}

function SignInSkeleton() {
  return (
    <Card aria-busy>
      <CardHeader>
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-56" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-40" />
      </CardContent>
    </Card>
  );
}

function AuthCard() {
  const createSignUpContext = useAction(api.authFlows.createSignUpContext);
  const supported = usePasskeySupport();

  const [signInBusy, setSignInBusy] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const autoFillStarted = useRef(false);

  const [name, setName] = useState("");
  const [signUpBusy, setSignUpBusy] = useState(false);
  const [signUpError, setSignUpError] = useState<string | null>(null);

  useEffect(() => {
    if (autoFillStarted.current) return;
    autoFillStarted.current = true;
    if (!webAuthnSupported()) return;
    void (async () => {
      // Conditional UI: browsers offer saved passkeys straight from the
      // autofill dropdown of the `username webauthn` input below. The promise
      // settles only when a passkey is picked, so failures here stay silent —
      // the button is the flow that reports real errors.
      const result = await authClient.signIn.passkey({ autoFill: true });
      if (result?.data?.session) {
        // No unmount guard here on purpose: the session atom update can
        // unmount this card before the promise continuation runs, and the
        // redirect must still happen.
        hardNavigate("/");
      }
    })();
  }, []);

  async function handlePasskeySignIn() {
    if (signInBusy) return;
    setSignInError(null);
    setSignInBusy(true);
    try {
      const result = await authClient.signIn.passkey();
      if (result?.data?.session) {
        hardNavigate("/");
        return;
      }
      setSignInError(passkeyErrorMessage(result?.error));
    } catch (cause) {
      setSignInError(unexpectedErrorMessage(cause));
    } finally {
      setSignInBusy(false);
    }
  }

  async function handleCreateAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (signUpBusy) return;
    setSignUpError(null);

    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setSignUpError("اكتب الاسم أولًا.");
      return;
    }
    if (trimmedName.length > MAX_DISPLAY_NAME_LENGTH) {
      setSignUpError(`الاسم طويل جدًا — حتى ${MAX_DISPLAY_NAME_LENGTH} حرفًا.`);
      return;
    }

    setSignUpBusy(true);
    try {
      const { context } = await createSignUpContext({ name: trimmedName });
      const result = await authClient.passkey.addPasskey({ context });
      if (result.error || !result.data) {
        setSignUpError(passkeyErrorMessage(result.error));
        return;
      }
      // The registration endpoint created the account and opened a session,
      // so a full navigation lands on the boards already signed in.
      hardNavigate("/");
    } catch (cause) {
      setSignUpError(unexpectedErrorMessage(cause));
    } finally {
      setSignUpBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">الدخول إلى KufiCraft</CardTitle>
        <CardDescription>
          مفتاح مرور واحد يكفي — للدخول إلى حسابك، أو لإنشاء حساب جديد باسمك.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <section className="flex flex-col gap-3">
          <h2 className="font-heading text-base font-medium">لديّ حساب</h2>
          <Field>
            <FieldLabel htmlFor="passkey-username">مفتاح المرور</FieldLabel>
            <Input
              id="passkey-username"
              name="username"
              type="text"
              autoComplete="username webauthn"
              placeholder="سيقترح المتصفح مفاتيحك المحفوظة"
              dir="auto"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              disabled={signInBusy || !supported}
            />
            <FieldDescription>
              ركّز على الحقل ليظهر اقتراح مفتاح المرور من المتصفح، أو استخدم زر
              الدخول.
            </FieldDescription>
          </Field>

          {signInError ? <AuthAlert>{signInError}</AuthAlert> : null}

          <Button
            type="button"
            onClick={handlePasskeySignIn}
            disabled={signInBusy || !supported}
            aria-busy={signInBusy}
            className="w-fit"
          >
            {signInBusy ? <Spinner /> : <KeyRound aria-hidden />}
            تسجيل الدخول
          </Button>
        </section>

        <div className="flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-xs text-muted-foreground">أو</span>
          <Separator className="flex-1" />
        </div>

        <form onSubmit={handleCreateAccount} noValidate>
          <section
            className="flex flex-col gap-3"
            aria-labelledby="create-account-heading"
          >
            <h2
              id="create-account-heading"
              className="font-heading text-base font-medium"
            >
              حساب جديد
            </h2>
            <Field data-invalid={signUpError !== null}>
              <FieldLabel htmlFor="account-name">الاسم</FieldLabel>
              <Input
                id="account-name"
                name="name"
                type="text"
                autoComplete="name"
                dir="auto"
                placeholder="مثال: عبد الستار"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (signUpError) setSignUpError(null);
                }}
                aria-invalid={signUpError !== null}
                maxLength={MAX_DISPLAY_NAME_LENGTH}
                disabled={signUpBusy || !supported}
              />
              <FieldDescription>
                سيطلب المتصفح تأكيد بصمتك أو قفل جهازك لإنشاء مفتاح المرور.
              </FieldDescription>
              {signUpError ? <FieldError>{signUpError}</FieldError> : null}
            </Field>

            <Button
              type="submit"
              variant="outline"
              disabled={signUpBusy || !supported}
              aria-busy={signUpBusy}
              className="w-fit"
            >
              {signUpBusy ? <Spinner /> : <KeyRound aria-hidden />}
              إنشاء حساب
            </Button>
          </section>
        </form>

        {!supported ? (
          <AuthAlert variant="info">
            متصفحك لا يدعم مفاتيح المرور. جرّب متصفحًا حديثًا على جهاز يدعم
            WebAuthn.
          </AuthAlert>
        ) : null}
      </CardContent>
    </Card>
  );
}
