"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { publishAction, retryMediaAction, reviewAction, statusAction, type ActionState } from "@/lib/admin/actions";

/* ----------------------------------------------------------------------------
   Review / lifecycle controls. Every form posts the listing id, the requested
   action and the state_version the page was rendered with; the server action
   re-checks the session and the database decides. Buttons disable while a
   request is in flight, and repeating a completed action is harmless (the
   database answers "already …"). Changes that remove a listing from the
   website ask for confirmation first.
---------------------------------------------------------------------------- */

function Submit({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "primary" | "danger" }) {
  const { pending } = useFormStatus();
  const cls = tone === "primary"
    ? "bg-ivory text-ink hover:bg-champagne"
    : tone === "danger"
      ? "border border-ivory/25 text-ivory/80 hover:border-champagne hover:text-champagne"
      : "border border-ivory/25 text-ivory hover:border-champagne hover:text-champagne";
  return (
    <button type="submit" disabled={pending} className={`label px-4 py-2.5 transition-colors duration-300 disabled:opacity-40 ${cls}`}>
      {pending ? "Working…" : children}
    </button>
  );
}

function Result({ state }: { state: ActionState }) {
  if (!state) return null;
  return (
    <p role="status" className={`label mt-3 ${state.ok ? "text-champagne" : "text-ivory/80"}`}>{state.message}</p>
  );
}

const confirmFirst = (message: string) => (e: React.FormEvent<HTMLFormElement>) => {
  if (!window.confirm(message)) e.preventDefault();
};

interface Props {
  id: string;
  version: number;
  listingStatus: string;
  reviewStatus: string | null;
  intent: string | null;
  publishable: boolean;
  reviewable: boolean;
}

export function ReviewActions({ id, version, listingStatus, reviewStatus, intent, publishable, reviewable }: Props) {
  const [reviewState, review] = useActionState(reviewAction, null);
  const [rejectState, reject] = useActionState(reviewAction, null);
  const [publishState, publish] = useActionState(publishAction, null);
  const [statusState, setStatus] = useActionState(statusAction, null);

  const hidden = (
    <>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={version} />
    </>
  );

  if (!reviewable) {
    return <p className="label text-ivory/40">Legacy listing without an agency — review and publishing are disabled.</p>;
  }

  const isDraft = listingStatus === "draft";
  const canRelist = listingStatus === "sold" || listingStatus === "rented";

  return (
    <div className="space-y-8">
      {isDraft && (
        <div>
          <h3 className="label text-ivory/40">Review</h3>
          <div className="mt-3 flex flex-wrap gap-3">
            {reviewStatus !== "approved" && (
              <form action={review}>
                {hidden}
                <input type="hidden" name="decision" value="approve" />
                <Submit>Approve</Submit>
              </form>
            )}
          </div>
          <Result state={reviewState} />

          {reviewStatus !== "rejected" && (
            <form action={reject} className="mt-5">
              {hidden}
              <input type="hidden" name="decision" value="reject" />
              <label className="block">
                <span className="label text-ivory/40">Rejection reason (required)</span>
                <textarea
                  name="reason"
                  required
                  minLength={3}
                  maxLength={500}
                  rows={2}
                  className="mt-2 w-full border border-ivory/15 bg-transparent p-3 text-[0.88rem] text-ivory outline-none focus:border-champagne"
                />
              </label>
              <div className="mt-3"><Submit tone="danger">Reject</Submit></div>
              <Result state={rejectState} />
            </form>
          )}
        </div>
      )}

      {(isDraft || canRelist) && (
        <div>
          <h3 className="label text-ivory/40">{canRelist ? "Relist" : "Publish"}</h3>
          <form
            action={publish}
            className="mt-3"
            onSubmit={confirmFirst(canRelist ? "Put this listing back on the website?" : "Publish this listing on the website now?")}
          >
            {hidden}
            <Submit tone="primary">{canRelist ? "Relist on website" : publishable ? "Publish" : "Publish (blocked)"}</Submit>
          </form>
          <Result state={publishState} />
        </div>
      )}

      <div>
        <h3 className="label text-ivory/40">Status</h3>
        <div className="mt-3 flex flex-wrap gap-3">
          {listingStatus === "published" && intent === "buy" && (
            <StatusButton action={setStatus} hidden={hidden} target="sold" label="Mark sold"
              confirm="Mark as sold? It leaves the public listings." />
          )}
          {listingStatus === "published" && intent === "rent" && (
            <StatusButton action={setStatus} hidden={hidden} target="rented" label="Mark rented"
              confirm="Mark as rented? It leaves the public listings." />
          )}
          {listingStatus === "published" && (
            <StatusButton action={setStatus} hidden={hidden} target="draft" label="Unpublish"
              confirm="Unpublish? It leaves the public listings and returns to draft." />
          )}
          {listingStatus !== "archived" && (
            <StatusButton action={setStatus} hidden={hidden} target="archived" label="Archive"
              confirm="Archive this listing? Nothing is deleted; it can be restored to draft." />
          )}
          {listingStatus === "archived" && (
            <StatusButton action={setStatus} hidden={hidden} target="draft" label="Restore to draft"
              confirm="Restore this listing to draft?" />
          )}
        </div>
        <Result state={statusState} />
      </div>
    </div>
  );
}

function StatusButton({
  action, hidden, target, label, confirm,
}: {
  action: (fd: FormData) => void; hidden: React.ReactNode; target: string; label: string; confirm: string;
}) {
  return (
    <form action={action} onSubmit={confirmFirst(confirm)}>
      {hidden}
      <input type="hidden" name="target" value={target} />
      <Submit tone="danger">{label}</Submit>
    </form>
  );
}

export function RetryMediaButton({ mediaId }: { mediaId: string }) {
  const [state, retry] = useActionState(retryMediaAction, null);
  return (
    <form action={retry} onSubmit={confirmFirst("Retry this media item? It is queued for the media worker again.")}>
      <input type="hidden" name="media_id" value={mediaId} />
      <Submit>Retry</Submit>
      <Result state={state} />
    </form>
  );
}
