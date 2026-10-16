import type { Metadata } from "next";
import { SignInPanel } from "@/components/auth/sign-in-panel";

export const metadata: Metadata = {
  title: "تسجيل الدخول",
  description: "ادخل إلى KufiCraft بمفتاح المرور المحفوظ على جهازك.",
};

/**
 * `/signin`: passkey sign-in for visitors, account & security section for
 * authenticated users.
 */
export default function SignInPage() {
  return <SignInPanel />;
}
