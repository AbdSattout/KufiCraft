"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { AccountSecurity } from "@/components/auth/account-security";
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
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

/**
 * `/signin`: passkey sign-in with conditional UI for anonymous visitors, and
 * the "الحساب والأمان" section once a session exists.
 */
export function SignInPanel() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
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

  if (session?.user) {
    return (
      <AccountSecurity userName={session.user.name?.trim() || "مستخدم"} />
    );
  }

  return <SignInCard />;
}

function SignInCard() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = usePasskeySupport();
  const autoFillStarted = useRef(false);

  useEffect(() => {
    if (autoFillStarted.current) return;
    autoFillStarted.current = true;
    if (!webAuthnSupported()) return;
    let active = true;
    void (async () => {
      // Conditional UI: browsers offer saved passkeys straight from the
      // autofill dropdown of the `username webauthn` input below. The promise
      // settles only when a passkey is picked, so failures here stay silent —
      // the button is the flow that reports real errors.
      const result = await authClient.signIn.passkey({ autoFill: true });
      if (!active) return;
      if (result?.data?.session) {
        hardNavigate("/app");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function handlePasskeySignIn() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const result = await authClient.signIn.passkey();
      if (result?.data?.session) {
        hardNavigate("/app");
        return;
      }
      setError(passkeyErrorMessage(result?.error));
    } catch (cause) {
      setError(unexpectedErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">تسجيل الدخول</CardTitle>
        <CardDescription>
          ادخل بمفتاح المرور المحفوظ على جهازك — دون كلمة مرور.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
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
            disabled={busy || !supported}
          />
          <FieldDescription>
            ركّز على الحقل ليظهر اقتراح مفتاح المرور من المتصفح، أو استخدم زر
            الدخول.
          </FieldDescription>
        </Field>

        {error ? <AuthAlert>{error}</AuthAlert> : null}
        {!supported ? (
          <AuthAlert variant="info">
            متصفحك لا يدعم مفاتيح المرور. جرّب متصفحًا حديثًا على جهاز يدعم
            WebAuthn.
          </AuthAlert>
        ) : null}

        <Button
          type="button"
          onClick={handlePasskeySignIn}
          disabled={busy || !supported}
          aria-busy={busy}
          className="w-fit"
        >
          {busy ? <Spinner /> : <KeyRound aria-hidden />}
          تسجيل الدخول بمفتاح المرور
        </Button>
      </CardContent>
      <CardFooter className="border-t-0 bg-transparent">
        <p className="text-sm text-muted-foreground">
          ليس لديك حساب؟{" "}
          <Link
            href="/signup"
            className="text-primary underline-offset-4 hover:underline"
          >
            أنشئ حسابًا
          </Link>{" "}
          بمفتاح مرور في ثوانٍ.
        </p>
      </CardFooter>
    </Card>
  );
}
