import { redirect } from "next/navigation";

/**
 * `/signup` kept as a redirect only: account creation lives on the same screen
 * as sign-in (`/signin`), and old links or bookmarks should not 404.
 */
export default function SignUpPage() {
  redirect("/signin");
}
