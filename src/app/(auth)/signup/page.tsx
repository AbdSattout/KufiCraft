import type { Metadata } from "next";
import { SignUpForm } from "@/components/auth/sign-up-form";

export const metadata: Metadata = {
  title: "إنشاء حساب",
  description: "أنشئ حساب KufiCraft خلال ثوانٍ — باسم ومفتاح مرور فقط.",
};

/** `/signup`: name → passkey. No email, no password. */
export default function SignUpPage() {
  return <SignUpForm />;
}
