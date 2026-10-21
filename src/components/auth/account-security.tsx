"use client";

import { useState } from "react";
import { KeyRound, LogOut, Pencil } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import {
  DEFAULT_PASSKEY_NAME,
  MAX_ACCOUNT_NAME_LENGTH,
  isDefaultAccountName,
  normalizeAccountName,
} from "@/lib/account-name";
import { AuthAlert } from "@/components/auth/auth-alert";
import { hardNavigate } from "@/components/auth/hard-navigate";
import {
  passkeyErrorMessage,
  unexpectedErrorMessage,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

/** Name shown while the passkey list loads, or if a passkey somehow has none. */
const FALLBACK_ACCOUNT_NAME = DEFAULT_PASSKEY_NAME;

/**
 * "الحساب والأمان" at `/account`. An account **is** its passkey
 * (docs/AUTH.md § Accounts): exactly one, and its name is the account's name —
 * so this screen shows that name with an edit action, plus sign-out. There is
 * deliberately no "add another passkey" and no delete: a second key would be a
 * second account's key, and deleting the only one would leave the account with
 * no way back in (there is no email or password to recover with).
 */
export function AccountSecurity() {
  const {
    data: passkeys,
    error: listError,
    isPending,
    refetch,
  } = authClient.useListPasskeys();
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [signOutBusy, setSignOutBusy] = useState(false);

  const passkey = passkeys?.[0] ?? null;
  const accountName = passkey?.name?.trim() || FALLBACK_ACCOUNT_NAME;
  /** Passkeys created before names were asked for still carry the default. */
  const needsName = passkey !== null && isDefaultAccountName(passkey.name);

  function openRenameDialog() {
    setRenameError(null);
    setRenameValue(accountName);
    setRenameOpen(true);
  }

  async function handleRename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = passkey;
    if (!target || renameBusy) return;
    const nextName = normalizeAccountName(renameValue);
    if (nextName === null) {
      setRenameError("اكتب اسمًا للحساب (1–60 حرفًا).");
      return;
    }
    setRenameBusy(true);
    setRenameError(null);
    try {
      const result = await authClient.passkey.updatePasskey({
        id: target.id,
        name: nextName,
      });
      if (result.error || !result.data) {
        setRenameError(passkeyErrorMessage(result.error));
        return;
      }
      /**
       * `passkey.name` is the display source of truth (the header and this
       * screen read it), so the rename is already complete above. `user.name`
       * is a creation-time mirror; update it best-effort without failing the
       * visible rename when the session endpoint is unavailable.
       */
      try {
        await authClient.updateUser({ name: nextName });
      } catch {
        // Best-effort mirror only.
      }
      setRenameOpen(false);
    } catch (cause) {
      setRenameError(unexpectedErrorMessage(cause));
    } finally {
      setRenameBusy(false);
    }
  }

  async function handleSignOut() {
    if (signOutBusy) return;
    setSignOutBusy(true);
    try {
      await authClient.signOut();
      hardNavigate("/");
    } catch (cause) {
      setActionError(unexpectedErrorMessage(cause));
      setSignOutBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">الحساب والأمان</CardTitle>
        <CardDescription>
          اسمك في KufiCraft هو اسم مفتاح مرورك نفسه — مفتاح واحد يكفي للدخول.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          {actionError ? <AuthAlert>{actionError}</AuthAlert> : null}

          {isPending ? (
            <Skeleton className="h-14 w-full rounded-lg" />
          ) : listError ? (
            <AuthAlert>
              <span>تعذّر تحميل مفتاح المرور.</span>{" "}
              <button
                type="button"
                onClick={() => void refetch()}
                className="font-medium underline underline-offset-4"
              >
                إعادة المحاولة
              </button>
            </AuthAlert>
          ) : passkey === null ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              لا يوجد مفتاح مرور مسجَّل لهذا الحساب على هذا الجهاز.
            </p>
          ) : (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border/70 p-3">
              <div className="flex min-w-0 items-center gap-2">
                <KeyRound
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <p className="truncate font-medium" dir="auto">
                  {accountName}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="تغيير اسم الحساب"
                onClick={openRenameDialog}
              >
                <Pencil aria-hidden />
              </Button>
            </div>
          )}

          {needsName ? (
            <div className="flex flex-col items-start gap-2 rounded-lg border border-border/70 bg-muted/40 p-3">
              <p className="font-medium">سمِّ حسابك</p>
              <p className="text-sm text-muted-foreground">
                هذا الحساب أُنشئ قبل أن نسأل عن الاسم، فما زال{" "}
                «{DEFAULT_PASSKEY_NAME}». اختر اسمًا يميزه في الترويسة؛ الاسم
                الظاهر في نافذة النظام لا يمكن تغييره بعد الإنشاء.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={openRenameDialog}
              >
                سمِّ حسابك
              </Button>
            </div>
          ) : null}
        </div>

        <Separator />

        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            عند الانتهاء، يمكنك الخروج من هذا الجهاز.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSignOut}
            disabled={signOutBusy}
            aria-busy={signOutBusy}
          >
            {signOutBusy ? <Spinner /> : <LogOut aria-hidden />}
            تسجيل الخروج
          </Button>
        </div>
      </CardContent>

      <Dialog
        open={renameOpen}
        onOpenChange={(open) => {
          if (!open) setRenameOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تغيير اسم الحساب</DialogTitle>
            <DialogDescription>
              هذا الاسم هو اسم مفتاح مرورك نفسه، وهو ما يظهر في الترويسة.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRename} noValidate className="grid gap-4">
            <Field data-invalid={renameError !== null}>
              <FieldLabel htmlFor="account-name">اسم الحساب</FieldLabel>
              <Input
                id="account-name"
                dir="auto"
                value={renameValue}
                onChange={(event) => {
                  setRenameValue(event.target.value);
                  if (renameError) setRenameError(null);
                }}
                autoFocus
                maxLength={MAX_ACCOUNT_NAME_LENGTH}
                aria-invalid={renameError !== null}
                disabled={renameBusy}
              />
              {renameError ? <FieldError>{renameError}</FieldError> : null}
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenameOpen(false)}
                disabled={renameBusy}
              >
                إلغاء
              </Button>
              <Button type="submit" disabled={renameBusy} aria-busy={renameBusy}>
                {renameBusy ? <Spinner /> : null}
                حفظ
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
