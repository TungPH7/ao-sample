// design.md S1.3 and S1.10: the create form and the list, 32 px apart. The form will point to create-note-heading
// with aria-labelledby; the Stories of SMP-2 fill both sections.
export default function NotesView() {
  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 id="create-note-heading" className="text-lg font-semibold">
          Tạo ghi chú
        </h2>
      </section>
      <section>
        <h2 id="notes-list-heading" className="text-lg font-semibold">
          Danh sách ghi chú
        </h2>
      </section>
    </div>
  );
}
