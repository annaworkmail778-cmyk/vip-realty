-- =============================================================================
-- Phase 5 (3/3) — semantic anti-hallucination guards on top of structural validation
--
-- Found with the real model during testing: for "2 bedroom apartment / Arabkir, Yerevan / $180,000" the model
-- returned intent "buy" (quoting "2 bedroom apartment") and country "AM" (quoting "Yerevan"). Both quotes exist
-- verbatim, so the evidence check alone cannot reject them. These deterministic guards require the quoted
-- evidence to actually contain what the value claims:
--   intent   -> evidence must contain a sale/rent term (English, Russian, Armenian, common transliterations)
--   country  -> "AM" evidence must name Armenia
--
-- The structural validator is kept unchanged under a new name; validate_property_extraction now wraps it.
-- Rollback: drop function public.validate_property_extraction(jsonb, jsonb);
--           alter function public.validate_property_extraction_structure(jsonb, jsonb) rename to validate_property_extraction;
-- =============================================================================

alter function public.validate_property_extraction(jsonb, jsonb) rename to validate_property_extraction_structure;

create function public.validate_property_extraction(p_output jsonb, p_input jsonb)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  c_intent_terms  constant text := '(sale|sell|buy|purchase|rent|rental|lease|\mlet\M|продаж|прода[её]|купить|аренд|сда[её]т|сдаю|сдам|сдается|сдаётся|վաճառ|վարձ|գնել|prodaj|prodazh|arend|sdaet|sdayu|vachar|vardz)';
  c_armenia_terms constant text := '(armenia|հայաստան|армени|\mհհ\M|\mра\M|\mra\M)';
  v_result jsonb;
  v_issues jsonb;
  v_field  jsonb;
begin
  v_result := validate_property_extraction_structure(p_output, p_input);
  v_issues := v_result -> 'issues';

  v_field := p_output -> 'fields' -> 'intent';
  if jsonb_typeof(v_field -> 'value') = 'string'
     and extraction_evidence_text(v_field ->> 'evidence') !~ c_intent_terms then
    v_issues := v_issues || extraction_issue('error', 'intent_not_stated', 'intent',
                                             'intent evidence contains no sale or rent term');
  end if;

  v_field := p_output -> 'fields' -> 'country';
  if v_field ->> 'value' = 'AM'
     and extraction_evidence_text(v_field ->> 'evidence') !~ c_armenia_terms then
    v_issues := v_issues || extraction_issue('error', 'country_not_stated', 'country',
                                             'country evidence does not name the country');
  end if;

  if exists (select 1 from jsonb_array_elements(v_issues) i where i ->> 'severity' = 'error') then
    return v_result || jsonb_build_object('status', 'invalid', 'issues', v_issues, 'property', '{}'::jsonb);
  end if;
  return v_result || jsonb_build_object('issues', v_issues);
end;
$$;

comment on function public.validate_property_extraction(jsonb, jsonb) is
  'Deterministic validation of untrusted AI output: structural/schema validation '
  '(validate_property_extraction_structure) plus semantic evidence guards for intent and country. '
  'Result: valid | incomplete | conflicting | invalid.';

revoke execute on function public.validate_property_extraction(jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.validate_property_extraction_structure(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.validate_property_extraction(jsonb, jsonb) to service_role;
grant execute on function public.validate_property_extraction_structure(jsonb, jsonb) to service_role;
