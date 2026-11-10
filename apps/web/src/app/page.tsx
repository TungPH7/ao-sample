import { redirect } from "next/navigation";

// This page renders no UI, so there is nothing for instant-navigation validation of cacheComponents to check: without
// this, next dev logs "Could not validate `instant`" on every visit to /.
export const instant = false;

// design.md S1.1: opening / goes straight to /notes.
export default function Home() {
  redirect("/notes");
}
