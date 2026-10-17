import type { Metadata } from "next";
import { SignInScreen } from "@/components/auth/sign-in-screen";

export const metadata: Metadata = {
  title: "تسجيل الدخول",
  description: "ادخل إلى KufiCraft بمفتاح المرور المحفوظ على جهازك — أو أنشئ حسابًا باسمك.",
};

/**
 * `/signin`: one screen for both passkey sign-in and account creation, so
 * there is no sign-up route to travel to. Signed-in visitors are sent home.
 */
export default function SignInPage() {
  return <SignInScreen />;
}
