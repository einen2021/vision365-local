import { redirect } from "next/navigation";
import { getDefaultHomeRoute } from "@/lib/roleAccess";

export default function DashboardIndex() {
  redirect(getDefaultHomeRoute("admin"));
}
