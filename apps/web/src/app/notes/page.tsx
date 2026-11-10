import NotesView from "./notes-view";

// design.md S1.1 and S1.2: one centred column, at most 640 px wide, 16 px side padding below 768 px and 24 px from it.
// A Server Component that fetches nothing (plan decision 6): the list loads in the browser.
export default function NotesPage() {
  return (
    <main className="w-full flex-1 px-4 py-8 md:px-6">
      <div className="mx-auto flex max-w-[40rem] flex-col gap-8">
        <h1 className="text-2xl font-semibold">Ghi chú</h1>
        <NotesView />
      </div>
    </main>
  );
}
