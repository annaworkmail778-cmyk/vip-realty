-- =============================================================================
-- Phase 5 — semantic guards v2 (replaces the wrapper from extraction_semantic_guards)
--
-- Observed with the real model (claude-haiku-4-5, prompt property-extraction-v1):
--   * country "AM" inferred from "Yerevan"/"Երևան" in 3 of 7 scenarios despite the prompt;
--   * a price change without any correction wording labelled "latest_correction";
--   * a composed title saying "3-bedroom" for a "3 սենյականոց" (3-room) apartment.
-- Guards are deterministic and never trust the model's claim:
--   intent        evidence must contain a sale/rent term, otherwise the value is removed
--   country "AM"  evidence must name Armenia, otherwise the value is removed
--   title         mentioning bedrooms while bedrooms is not established -> title removed
--   latest_correction  the latest cited message must contain correction wording, otherwise the conflict is
--                      treated as unresolved: the field is removed and the result becomes "conflicting"
-- Removed values stay visible in extracted_data.fields (raw model claim) and are flagged in validation_errors;
-- they never reach extracted_data.property. Removing a critical field makes the result "incomplete".
--
-- Rollback: re-apply the wrapper from 20260917..._extraction_semantic_guards.sql (create or replace).
-- =============================================================================

create or replace function public.validate_property_extraction(p_output jsonb, p_input jsonb)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  c_critical           constant text[] := array['intent', 'property_type', 'city', 'price', 'currency'];
  c_intent_terms       constant text := '(sale|sell|buy|purchase|rent|rental|lease|\mlet\M|продаж|прода[её]|купить|аренд|сда[её]т|сдаю|сдам|сдается|сдаётся|վաճառ|վարձ|գնել|prodaj|prodazh|arend|sdaet|sdayu|vachar|vardz)';
  c_armenia_terms      constant text := '(armenia|հայաստան|армени|\mհհ\M|\mра\M|\mra\M)';
  c_correction_terms   constant text := '(actually|correction|corrected|sorry|instead|mistake|update|changed|not [^,.]{1,30} but|исправ|точнее|на самом деле|вместо|ошиб|ուղղ|ճիշտ|փոխարեն|ոչ թե|սխալ)';
  v_result   jsonb;
  v_status   text;
  v_issues   jsonb;
  v_property jsonb;
  v_conflict jsonb;
  v_last     integer;
  v_name     text;
  v_forced   boolean := false;
begin
  v_result := validate_property_extraction_structure(p_output, p_input);
  v_status := v_result ->> 'status';
  if v_status = 'invalid' then
    return v_result;
  end if;

  v_issues   := v_result -> 'issues';
  v_property := v_result -> 'property';

  if v_property ? 'intent'
     and extraction_evidence_text(p_output -> 'fields' -> 'intent' ->> 'evidence') !~ c_intent_terms then
    v_property := v_property - 'intent';
    v_issues := v_issues || extraction_issue('warning', 'unsupported_value_removed', 'intent',
                                             'intent evidence contains no sale or rent term');
  end if;

  if v_property ->> 'country' = 'AM'
     and extraction_evidence_text(p_output -> 'fields' -> 'country' ->> 'evidence') !~ c_armenia_terms then
    v_property := v_property - 'country';
    v_issues := v_issues || extraction_issue('warning', 'unsupported_value_removed', 'country',
                                             'country evidence does not name the country');
  end if;

  if v_property ? 'title' and lower(v_property ->> 'title') ~ 'bedroom' and not v_property ? 'bedrooms' then
    v_property := v_property - 'title';
    v_issues := v_issues || extraction_issue('warning', 'unsupported_value_removed', 'title',
                                             'title mentions bedrooms but bedrooms is not established');
  end if;

  for v_conflict in
    select c from jsonb_array_elements(coalesce(p_output -> 'conflicts', '[]'::jsonb)) c
     where c ->> 'resolution' = 'latest_correction'
  loop
    select max((e #>> '{}')::integer) into v_last from jsonb_array_elements(v_conflict -> 'source_messages') e;
    if extraction_evidence_text(p_input -> 'messages' -> (v_last - 1) ->> 'text') !~ c_correction_terms then
      v_name := v_conflict ->> 'field';
      v_property := v_property - v_name;
      v_forced := true;
      v_issues := v_issues || extraction_issue('review', 'correction_not_stated', v_name,
                                               'values differ and no message states a correction; treated as unresolved');
    end if;
  end loop;

  foreach v_name in array c_critical loop
    if not v_property ? v_name
       and not exists (select 1 from jsonb_array_elements(v_issues) i
                        where i ->> 'code' = 'missing_critical_field' and i ->> 'field' = v_name) then
      v_issues := v_issues || extraction_issue('review', 'missing_critical_field', v_name,
                                               'required before a listing could be created');
    end if;
  end loop;

  v_status := case
                when v_status = 'conflicting' or v_forced then 'conflicting'
                when exists (select 1 from unnest(c_critical) k where not v_property ? k) then 'incomplete'
                else v_status
              end;

  return v_result || jsonb_build_object('status', v_status, 'issues', v_issues, 'property', v_property);
end;
$$;

comment on function public.validate_property_extraction(jsonb, jsonb) is
  'Deterministic validation of untrusted AI output: structural/schema validation '
  '(validate_property_extraction_structure) plus semantic guards (intent and country evidence, bedroom titles, '
  'stated corrections). Unsupported values are removed from property data and flagged. '
  'Result: valid | incomplete | conflicting | invalid.';

revoke execute on function public.validate_property_extraction(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.validate_property_extraction(jsonb, jsonb) to service_role;
