"use client";

import { useState } from "react";
import type { Passkey } from "@better-auth/passkey/client";
import { KeyRound, LogOut, Pencil, Plus, Trash2 } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { AuthAlert } from "@/components/auth/auth-alert";
import { hardNavigate } from "@/components/auth/hard-navigate";
import {
  passkeyErrorMessage,
  unexpectedErrorMessage,
} from "@/components/auth/passkey-errors";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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

/** Label used for passkeys added from this screen (the sign-up one is "مفتاح المرور"). */
const ADDED_PASSKEY_NAME = "مفتاح إضافي";

function formatPasskeyDate(value: Date | number): string | null {
  const date = typeof value === "number" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("ar", { dateStyle: "medium" }).format(date);
}

function passkeyLabel(passkey: Passkey): string {
  const name = passkey.name?.trim();
  return name && name.length > 0 ? name : "مفتاح مرور";
}

function passkeyMeta(passkey: Passkey): string {
  const parts: string[] = [];
  const created = formatPasskeyDate(passkey.createdAt);
  if (created) parts.push(`أُنشئ في ${created}`);
  if (passkey.deviceType === "multiDevice") {
    parts.push("مزامَن عبر الأجهزة");
  } else {
    parts.push("مرتبط بهذا الجهاز");
  }
  if (passkey.backedUp) parts.push("منسوخ احتياطيًا");
  return parts.join(" · ");
}

/**
 * "الحساب والأمان": passkey management (list / add / rename / delete) plus
 * sign-out for signed-in visitors. Rendered by `/signin`, which the header
 * account menu links to.
 */
export function AccountSecurity({ userName }: { userName: string }) {
  const {
    data: passkeys,
    error: listError,
    isPending,
    refetch,
  } = authClient.useListPasskeys();
  const [addBusy, setAddBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<Passkey | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Passkey | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);

  const items = passkeys ?? [];

  async function handleAddPasskey() {
    if (addBusy) return;
    setActionError(null);
    setAddBusy(true);
    try {
      const result = await authClient.passkey.addPasskey({
        name: ADDED_PASSKEY_NAME,
      });
      if (result.error || !result.data) {
        setActionError(passkeyErrorMessage(result.error));
      }
      // On success the list refreshes on its own (the plugin's atom listens
      // to `/passkey/verify-registration`).
    } catch (cause) {
      setActionError(unexpectedErrorMessage(cause));
    } finally {
      setAddBusy(false);
    }
  }

  function openRenameDialog(passkey: Passkey) {
    setRenameError(null);
    setRenameValue(passkeyLabel(passkey));
    setRenameTarget(passkey);
  }

  async function handleRename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = renameTarget;
    if (!target || renameBusy) return;
    const nextName = renameValue.trim();
    if (nextName.length === 0) {
      setRenameError("اكتب اسمًا للمفتاح.");
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
      setRenameTarget(null);
    } catch (cause) {
      setRenameError(unexpectedErrorMessage(cause));
    } finally {
      setRenameBusy(false);
    }
  }

  async function handleDelete() {
    const target = deleteTarget;
    if (!target || deleteBusy) return;
    setDeleteBusy(true);
    setActionError(null);
    try {
      const result = await authClient.passkey.deletePasskey({ id: target.id });
      if (result.error || !result.data) {
        setActionError(passkeyErrorMessage(result.error));
      }
      setDeleteTarget(null);
    } catch (cause) {
      setActionError(unexpectedErrorMessage(cause));
    } finally {
      setDeleteBusy(false);
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
          مسجَّل الدخول باسم{" "}
          <span className="font-medium text-foreground">{userName}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-heading text-base font-medium">مفاتيح المرور</h2>
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddPasskey}
              disabled={addBusy}
              aria-busy={addBusy}
            >
              {addBusy ? <Spinner /> : <Plus aria-hidden />}
              إضافة مفتاح
            </Button>
          </div>

          {actionError ? <AuthAlert>{actionError}</AuthAlert> : null}

          {isPending ? (
            <div className="flex flex-col gap-2" aria-hidden>
              <Skeleton className="h-14 w-full rounded-lg" />
              <Skeleton className="h-14 w-full rounded-lg" />
            </div>
          ) : listError ? (
            <AuthAlert>
              <span>تعذّر تحميل مفاتيح المرور.</span>{" "}
              <button
                type="button"
                onClick={() => void refetch()}
                className="font-medium underline underline-offset-4"
              >
                إعادة المحاولة
              </button>
            </AuthAlert>
          ) : items.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              لا توجد مفاتيح مرور مسجَّلة بعد. أضف مفتاحًا للدخول دون كلمة مرور.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((passkey) => {
                const label = passkeyLabel(passkey);
                return (
                  <li
                    key={passkey.id}
                    className="flex items-start justify-between gap-2 rounded-lg border border-border/70 p-3"
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      <KeyRound
                        aria-hidden
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{label}</p>
                        <p className="text-xs text-muted-foreground">
                          {passkeyMeta(passkey)}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`إعادة تسمية ${label}`}
                        onClick={() => openRenameDialog(passkey)}
                      >
                        <Pencil aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`حذف ${label}`}
                        onClick={() => setDeleteTarget(passkey)}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
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
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إعادة تسمية مفتاح المرور</DialogTitle>
            <DialogDescription>
              الاسم يساعدك على تمييز المفاتيح، مثل «جهاز العمل» أو «الآيفون».
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRename} noValidate>
            <Field data-invalid={renameError !== null}>
              <FieldLabel htmlFor="passkey-name">اسم المفتاح</FieldLabel>
              <Input
                id="passkey-name"
                dir="auto"
                value={renameValue}
                onChange={(event) => {
                  setRenameValue(event.target.value);
                  if (renameError) setRenameError(null);
                }}
                autoFocus
                maxLength={60}
                aria-invalid={renameError !== null}
                disabled={renameBusy}
              />
              {renameError ? <FieldError>{renameError}</FieldError> : null}
            </Field>
            <DialogFooter className="mt-4 border-t-0 bg-transparent px-0 pb-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenameTarget(null)}
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

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <Trash2 aria-hidden />
            </AlertDialogMedia>
            <AlertDialogTitle>حذف مفتاح المرور؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيُحذف «{deleteTarget ? passkeyLabel(deleteTarget) : ""}» نهائيًا
              ولا يمكن استخدامه للدخول بعد ذلك.
              {items.length <= 1
                ? " هذا مفتاحك الوحيد — ستفقد الوصول إلى حسابك."
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
              disabled={deleteBusy}
              aria-busy={deleteBusy}
            >
              {deleteBusy ? <Spinner /> : null}
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
