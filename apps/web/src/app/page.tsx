import { redirect } from "next/navigation";

// design.md S1.1: opening / goes straight to /notes.
export default function Home() {
  redirect("/notes");
}
