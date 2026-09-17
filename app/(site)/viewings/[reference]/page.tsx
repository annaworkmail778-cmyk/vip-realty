import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ManageViewing } from "@/components/booking/ManageViewing";
import { getBookingStore } from "@/lib/booking";
import { isReference, isUuid } from "@/lib/booking/validation";
import { site } from "@/lib/site";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your viewing",
  robots: { index: false, follow: false },
};

/* ----------------------------------------------------------------------------
   Where the 24-hour reminder sends the customer.

   The link carries a token, which is the only thing that unlocks the booking.
   No account, no password, and a reference on its own is worthless — so the
   page is safe to email while still being one tap to confirm or cancel.
---------------------------------------------------------------------------- */

export default async function ViewingPage({
  params, searchParams,
}: {
  params: Promise<{ reference: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { reference } = await params;
  const { token } = await searchParams;

  if (!isReference(reference) || !isUuid(token)) notFound();

  const booking = await getBookingStore().getBooking(reference, token);
  if (!booking) notFound();

  return (
    <article data-nav-tone="dark" className="bg-ink text-ivory">
      <div className="shell mx-auto max-w-[46rem] pb-24 pt-[calc(var(--nav-h)+clamp(3rem,10vh,7rem))]">
        <div className="flex items-center gap-4">
          <span className="h-px w-10 gold-rule" aria-hidden />
          <p className="label text-champagne">Your viewing</p>
        </div>

        <ManageViewing
          booking={{
            reference: booking.reference,
            propertyTitle: booking.propertyTitle,
            propertySlug: booking.propertySlug,
            propertyAddress: booking.propertyAddress ?? booking.propertyLocation,
            date: booking.date,
            startTime: booking.startTime,
            endTime: booking.endTime,
            status: booking.status,
            confirmationStatus: booking.confirmationStatus,
            customerName: booking.customerName,
          }}
          token={token}
        />

        <footer className="mt-16 border-t border-ivory/12 pt-6">
          <p className="label text-ivory/40">Need to speak to us?</p>
          <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
            <a href={site.contact.phoneHref} className="label link-underline text-ivory/75">{site.contact.phone}</a>
            <a href={`mailto:${site.contact.email}`} className="label link-underline text-ivory/75">{site.contact.email}</a>
            <Link href={`/properties/${booking.propertySlug}`} className="label link-underline text-champagne">
              View the property
            </Link>
          </div>
        </footer>
      </div>
    </article>
  );
}
