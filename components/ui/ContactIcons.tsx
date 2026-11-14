/* Small contact glyphs shared by every contact button (sticky bar, contact
   panel, closing section, floating contact). Decorative: the link around each
   one carries the accessible name. */

export function PhoneGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path
        d="M6.5 3h-2A1.5 1.5 0 0 0 3 4.6c.2 3.3 1.5 6.4 3.6 8.9 2 2.4 4.7 4 7.7 4.6a1.5 1.5 0 0 0 1.7-1.5v-2c0-.7-.5-1.3-1.2-1.5l-2-.4c-.5-.1-1 .1-1.3.5l-.6.8a12 12 0 0 1-4-4l.8-.6c.4-.3.6-.8.5-1.3l-.4-2C7.8 3.5 7.2 3 6.5 3Z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function WhatsAppGlyph({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.02h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.22 8.22 0 0 1-1.26-4.39c0-4.54 3.7-8.23 8.25-8.23a8.2 8.2 0 0 1 8.24 8.24c0 4.54-3.7 8.24-8.24 8.24Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.15.16-.29.18-.54.06-.25-.13-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.44.13-.15.17-.25.25-.41.09-.17.04-.31-.02-.44-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.42l-.47-.01c-.17 0-.44.06-.67.31-.23.25-.87.85-.87 2.07s.9 2.4 1.02 2.56c.12.17 1.75 2.67 4.25 3.74.59.26 1.06.41 1.42.52.6.19 1.14.16 1.57.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.15-1.18-.06-.11-.23-.17-.48-.29Z" />
    </svg>
  );
}

/** A rounded speech bubble with a handset and signal arcs — the shapes people associate with Viber,
 *  drawn generically rather than copying its trademarked logo. Kept visibly different from WhatsApp. */
export function ViberGlyph({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M5.5 2.8h13A2.7 2.7 0 0 1 21.2 5.5v9.4a2.7 2.7 0 0 1-2.7 2.7h-6l-4.3 3.6v-3.6H5.5a2.7 2.7 0 0 1-2.7-2.7V5.5a2.7 2.7 0 0 1 2.7-2.7Z" strokeLinejoin="round" />
      <path
        d="M8.4 6.2h-.9c-.4 0-.8.4-.7.8.2 1.7.9 3.2 2 4.4 1.1 1.2 2.5 2 4 2.3.4.1.8-.3.8-.7v-.9c0-.3-.2-.6-.5-.7l-1-.2c-.3-.1-.5 0-.7.2l-.3.4a5.6 5.6 0 0 1-2-2l.4-.3c.2-.2.3-.4.2-.7l-.2-1c-.1-.3-.4-.6-.7-.6Z"
        fill="currentColor"
        stroke="none"
      />
      <path d="M13.2 5.6a3.6 3.6 0 0 1 3.4 3.4M13.2 7.5a1.7 1.7 0 0 1 1.5 1.5" strokeLinecap="round" />
    </svg>
  );
}
