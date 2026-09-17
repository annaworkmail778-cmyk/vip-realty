-- =============================================================================
-- Least privilege for submit_inquiry.
--
-- The website calls submit_inquiry server-side with the publishable key (role
-- anon). No signed-in (authenticated) client uses it, so that grant is removed.
-- The remaining anon grant is intentional: the function is the validated,
-- published-listings-only public write path for website inquiries.
-- =============================================================================

revoke execute on function public.submit_inquiry(text, text, text, text, text, uuid) from authenticated;
