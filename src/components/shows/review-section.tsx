"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Heart, MessageSquare, Pencil, Trash2 } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { StarRating } from "@/components/shows/star-rating";
import { idle } from "@/features/shared/action-result";
import {
  deleteReviewAction,
  saveReviewAction,
  toggleReviewLikeAction,
  type ReviewFormState,
} from "@/features/reviews/actions";
import { formatRelativeTime } from "@/lib/format";
import type { ShowReview } from "@/server/queries/shows";
import { cn } from "@/lib/utils";

/** Reviews for a show, plus the viewer's own write/edit form. */
export function ReviewSection({
  showId,
  showSlug,
  reviews,
  viewerUsername,
  viewerReview,
}: {
  showId: string;
  showSlug: string;
  reviews: ShowReview[];
  viewerUsername: string | null;
  viewerReview: { id: string; rating: number; body: string; hasSpoilers: boolean } | null;
}) {
  const [editing, setEditing] = useState(false);
  const others = reviews.filter((review) => review.author.username !== viewerUsername);

  return (
    <section className="space-y-4">
      {viewerUsername ? (
        viewerReview && !editing ? (
          <OwnReview
            review={viewerReview}
            showSlug={showSlug}
            onEdit={() => setEditing(true)}
          />
        ) : (
          <ReviewForm
            showId={showId}
            showSlug={showSlug}
            existing={viewerReview}
            onDone={() => setEditing(false)}
            onCancel={viewerReview ? () => setEditing(false) : undefined}
          />
        )
      ) : (
        <Card className="p-4 text-sm text-ink-muted">
          <Link href="/login" className="text-primary hover:underline">
            Log in
          </Link>{" "}
          to write a review.
        </Card>
      )}

      {others.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-faint">
          No other reviews yet. Be the first to have an opinion nobody asked for.
        </p>
      ) : (
        <ul className="space-y-3">
          {others.map((review) => (
            <ReviewCard key={review.id} review={review} canLike={Boolean(viewerUsername)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ReviewForm({
  showId,
  showSlug,
  existing,
  onDone,
  onCancel,
}: {
  showId: string;
  showSlug: string;
  existing: { rating: number; body: string; hasSpoilers: boolean } | null;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [rating, setRating] = useState<number | null>(existing?.rating ?? null);

  const [state, formAction] = useActionState(
    async (prev: ReviewFormState, formData: FormData) => {
      const result = await saveReviewAction(prev, formData);
      if (result.ok) {
        toast.success(existing ? "Review updated." : "Review posted.");
        onDone();
        router.refresh();
      }
      return result;
    },
    idle as ReviewFormState,
  );

  return (
    <Card className="p-4">
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="showId" value={showId} />
        <input type="hidden" name="showSlug" value={showSlug} />
        <input type="hidden" name="rating" value={rating ?? ""} />

        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-ink-muted">Your rating</span>
          <StarRating value={rating} onChange={setRating} />
        </div>

        <Textarea
          name="body"
          defaultValue={existing?.body ?? state.values?.body ?? ""}
          placeholder="Was it good? Was it a war crime? Explain yourself."
          maxLength={5000}
          required
          aria-invalid={Boolean(state.fieldErrors?.body)}
        />

        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            name="hasSpoilers"
            defaultChecked={existing?.hasSpoilers ?? false}
            className="size-4 rounded border-line-strong bg-surface accent-primary"
          />
          This review has spoilers
        </label>

        {!state.ok && state.message ? (
          <p role="alert" className="text-sm text-danger">
            {state.message}
          </p>
        ) : null}

        <div className="flex gap-2">
          <SubmitButton>{existing ? "Update review" : "Post review"}</SubmitButton>
          {onCancel ? (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      {children}
    </Button>
  );
}

function OwnReview({
  review,
  showSlug,
  onEdit,
}: {
  review: { id: string; rating: number; body: string; hasSpoilers: boolean };
  showSlug: string;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Card className="border-primary/30 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-primary">Your review</p>
          <div className="mt-1.5">
            <StarRating value={review.rating} readOnly size="sm" />
          </div>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="Edit review" onClick={onEdit}>
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Delete review"
            loading={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await deleteReviewAction(review.id, showSlug);
                if (!result.ok) {
                  toast.error(result.message ?? "Could not delete that.");
                  return;
                }
                toast.success("Review deleted.");
                router.refresh();
              })
            }
          >
            <Trash2 />
          </Button>
        </div>
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm text-ink">{review.body}</p>
    </Card>
  );
}

function ReviewCard({ review, canLike }: { review: ShowReview; canLike: boolean }) {
  const [liked, setLiked] = useState(review.likedByViewer);
  const [count, setCount] = useState(review.likeCount);
  const [revealed, setRevealed] = useState(!review.hasSpoilers);
  const [pending, startTransition] = useTransition();

  return (
    <li>
      <Card className="p-4">
        <div className="flex items-center gap-2.5">
          <Avatar
            src={review.author.avatarUrl}
            name={review.author.displayName}
            accentColor={review.author.accentColor}
            size="sm"
          />
          <div className="min-w-0 flex-1">
            <Link
              href={`/u/${review.author.username}`}
              className="truncate text-sm font-medium text-ink hover:text-primary"
            >
              {review.author.displayName}
            </Link>
            <p className="text-xs text-ink-faint">{formatRelativeTime(review.createdAt)}</p>
          </div>
          <StarRating value={review.rating} readOnly size="sm" />
        </div>

        {revealed ? (
          <p className="mt-3 whitespace-pre-wrap text-sm text-ink">{review.body}</p>
        ) : (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="mt-3 w-full rounded-lg border border-dashed border-warning/40 bg-warning/5 px-3 py-4 text-sm text-warning"
          >
            Spoilers. Tap to reveal.
          </button>
        )}

        <div className="mt-3 flex items-center gap-4 text-xs text-ink-faint">
          <button
            type="button"
            disabled={!canLike || pending}
            onClick={() =>
              startTransition(async () => {
                // Optimistic: a like is cheap to undo and the latency is
                // more annoying than the rare failure.
                setLiked((v) => !v);
                setCount((c) => c + (liked ? -1 : 1));

                const result = await toggleReviewLikeAction(review.id);
                if (!result.ok || !result.data) {
                  setLiked(review.likedByViewer);
                  setCount(review.likeCount);
                  toast.error(result.message ?? "Could not like that.");
                  return;
                }
                setLiked(result.data.liked);
                setCount(result.data.likeCount);
              })
            }
            className={cn(
              "inline-flex items-center gap-1.5 transition-colors",
              canLike && "hover:text-danger",
              liked && "text-danger",
              !canLike && "cursor-default",
            )}
          >
            <Heart className={cn("size-3.5", liked && "fill-current")} />
            <span className="tnum">{count}</span>
          </button>
          <span className="inline-flex items-center gap-1.5">
            <MessageSquare className="size-3.5" />
            <span className="tnum">{review.commentCount}</span>
          </span>
        </div>
      </Card>
    </li>
  );
}
