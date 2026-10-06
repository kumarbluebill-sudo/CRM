import { redirect } from "next/navigation";

// Public marketing site comes later; for now the root opens the app.
export default function Home() {
  redirect("/dashboard");
}
