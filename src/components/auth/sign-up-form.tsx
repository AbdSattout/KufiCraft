"use client";

import { useState } from "react";
import Link from "next/link";
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
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

/** Mirrors `MAX_DISPLAY_NAME_LENGTH` in `convex/authFlows.ts` (server re-validates). */
const MAX_DISPLAY_NAME_LENGTH = 60;

/**
 * Passkey-first sign-up: display name → context token (Convex action) →
 * WebAuthn registration. No email, no password, no prior session.
 */
export function SignUpForm() {
  const createSignUpContext = useAction(api.authFlows.createSignUpContext);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = usePasskeySupport();

  const trimmedName = name.trim();
  const canSubmit =
    supported && !submitting && trimmedName.length > 0 && !error;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    if (trimmedName.length === 0) {
      setError("اكتب الاسم أولًا.");
      return;
    }
    if (trimmedName.length > MAX_DISPLAY_NAME_LENGTH) {
      setError(`الاسم طويل جدًا — حتى ${MAX_DISPLAY_NAME_LENGTH} حرفًا.`);
      return;
    }
    setSubmitting(true);
    try {
      const { context } = await createSignUpContext({ name: trimmedName });
      const result = await authClient.passkey.addPasskey({ context });
      if (result.error || !result.data) {
        setError(passkeyErrorMessage(result.error));
        return;
      }
      // The registration endpoint created the account and opened a session,
      // so a full navigation lands on the dashboard already signed in.
      hardNavigate("/app");
    } catch (cause) {
      setError(unexpectedErrorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">إنشاء حساب</CardTitle>
        <CardDescription>
          اختر اسمًا ثم أنشئ مفتاح مرور. لا كلمة مرور، ولا بريد إلكتروني.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit} noValidate>
        <CardContent className="flex flex-col gap-4">
          <Field data-invalid={error !== null}>
            <FieldLabel htmlFor="signup-name">الاسم</FieldLabel>
            <Input
              id="signup-name"
              name="name"
              type="text"
              autoComplete="name"
              autoFocus
              dir="auto"
              placeholder="مثال: عبد الستار"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (error) setError(null);
              }}
              aria-invalid={error !== null}
              maxLength={MAX_DISPLAY_NAME_LENGTH}
              disabled={submitting || !supported}
            />
            <FieldDescription>
              سيطلب المتصفح تأكيد بصمتك أو قفل جهازك لإنشاء مفتاح المرور.
            </FieldDescription>
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>

          {!supported ? (
            <AuthAlert variant="info">
              متصفحك لا يدعم مفاتيح المرور. جرّب متصفحًا حديثًا على جهاز
              يدعم WebAuthn.
            </AuthAlert>
          ) : null}
        </CardContent>
        <CardFooter className="mt-4 flex-col gap-3 border-t-0 bg-transparent sm:flex-row">
          <Button type="submit" disabled={!canSubmit} aria-busy={submitting}>
            {submitting ? <Spinner /> : <KeyRound aria-hidden />}
            إنشاء مفتاح المرور
          </Button>
          <p className="text-sm text-muted-foreground">
            لديك حساب بالفعل؟{" "}
            <Link
              href="/signin"
              className="text-primary underline-offset-4 hover:underline"
            >
              تسجيل الدخول
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
