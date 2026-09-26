/**
 * The × in the corner of a dialog.
 *
 * Every dialog already had a Cancel button, and that is not the same thing.
 * Cancel sits at the bottom of a form, after the fields, and on a long one —
 * the product form, a delivery, a return — it is off the screen when you
 * decide you opened the wrong thing. The × is where people look first to get
 * out of something, and it is in the same place on every dialog.
 *
 * `type="button"` is load-bearing: these live inside `<form>` elements, and a
 * button without it submits.
 */
export function DialogClose({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close"
      className="absolute right-3 top-3 rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-200"
    >
      <span aria-hidden="true" className="block h-4 w-4 leading-4">
        ×
      </span>
    </button>
  );
}
