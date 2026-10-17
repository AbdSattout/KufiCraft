import type { Metadata } from "next";
import { AccountScreen } from "@/components/auth/account-screen";

export const metadata: Metadata = {
  title: "الحساب والأمان",
  description: "مفاتيح المرور المرتبطة بحسابك، وإضافة مفتاح جديد أو حذفه.",
  robots: { index: false },
};

/** `/account`: passkey management and sign-out for a signed-in visitor. */
export default function AccountPage() {
  return <AccountScreen />;
}
