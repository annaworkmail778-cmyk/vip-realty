/* Human-readable labels for database codes shown in the admin (blockers, warnings, media reasons, outcomes).
   Pure data: safe for server and client components. Unknown codes are shown as-is. */

export const BLOCKER_LABELS: Record<string, string> = {
  not_found: "Listing not found",
  already_published: "Already published",
  archived: "Archived — restore to draft first",
  no_agency: "No agency (legacy listing)",
  agency_missing: "Agency no longer exists",
  agent_agency_mismatch: "Agent belongs to another agency",
  agent_inactive: "Agent is inactive",
  not_approved: "Not approved in review",
  missing_title: "Title missing",
  missing_intent: "Sale / rent missing",
  missing_property_type: "Property type missing",
  missing_city: "City missing",
  missing_price: "Price missing",
  missing_currency: "Currency missing",
  extraction_not_valid: "Extraction is not valid",
  unresolved_conflict: "Extraction has an unresolved conflict",
  media_processing: "Photos are still being processed",
  database_guard: "Rejected by a database rule",
};

export const WARNING_LABELS: Record<string, string> = {
  no_images: "No photos attached",
  newer_extraction_not_applied: "The agent sent newer details that were not applied (updates are not automatic)",
};

export const MEDIA_REASON_LABELS: Record<string, string> = {
  "held:session_pending": "Waiting for the submission to finish",
  "held:no_property": "No draft (extraction incomplete / invalid)",
  "held:session_cancelled": "Submission was cancelled",
  "held:agent_inactive": "Agent is inactive",
  "held:agency_mismatch": "Agent's agency changed",
  "held:property_not_draft": "Listing is no longer a draft",
  "held:extraction_not_valid": "Extraction is not valid",
  empty_file: "Empty file",
  oversized: "Too large",
  unsupported_format: "Unsupported format",
  corrupt_image: "Corrupt image",
  mime_not_allowed: "Format not allowed",
  dimensions_out_of_range: "Image dimensions out of range",
  hash_mismatch: "Stored file does not match the download",
  size_mismatch: "Stored file size does not match",
  download_window_passed: "WhatsApp download window passed",
  provider_media_not_found: "WhatsApp no longer has this media",
};

export const label = (map: Record<string, string>, code: string | null | undefined) =>
  code ? map[code] ?? code.replaceAll("_", " ") : "—";
