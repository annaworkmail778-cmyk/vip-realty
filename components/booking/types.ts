/* Shapes returned by the booking API, shared by the client components. */

export interface ApiSlot { start: string; end: string }
export interface ApiDay { date: string; slots: ApiSlot[] }

export interface AvailabilityResponse {
  property: {
    slug: string;
    title: string;
    location: string;
    address: string | null;
    type: string;
    viewingMode: "standard" | "appointment_only" | "unavailable";
    durationMinutes: number;
  };
  timezone: string;
  from: string;
  to: string;
  days: ApiDay[];
  storeKind: "supabase" | "development";
}

export interface ConfirmedBooking {
  reference: string;
  property: { title: string; location: string; address: string | null; slug: string };
  date: string;
  startTime: string;
  endTime: string;
  viewingType: string;
  status: string;
  manageToken: string;
}
