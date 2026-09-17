import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/* The admin area is listing management; its home is the properties list. */
export default function AdminHome() {
  redirect("/admin/properties");
}
