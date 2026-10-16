-- The quoted unit comparison in migration 97 concatenated JSON extraction
-- without parentheses. PostgreSQL parsed the final ->> against text, so an
-- otherwise valid sourced ROM failed before any estimate was committed.
-- Keep every source, assessment, revision, price and quantity guard intact.
create or replace function d5o_hosted.guard_graybar_rom_source_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_line jsonb;v_source jsonb;v_quote jsonb;v_quoted_line jsonb;v_state jsonb;
begin
  for v_line in select value from jsonb_array_elements(coalesce(new.estimate#>'{detailed,input,lines}','[]'::jsonb)) loop
    v_source:=v_line->'procurementSource';
    if v_source is null then continue; end if;
    select state into v_state from d5o_hosted.graybar_states where workspace_id=new.workspace_id and work_id=new.work_id;
    select value into v_quote from jsonb_array_elements(coalesce(v_state->'quotes','[]'::jsonb))
      where value->>'id'=v_source->>'quoteId' and value->>'quoteRevision'=v_source->>'quoteRevision'
        and value->>'documentId'=v_source->>'documentId';
    if v_quote is null or v_quote->>'status'<>'Accepted' or v_quote->>'defineRevision'<>new.definition_revision::text
      or v_quote->>'expiresAt'<coalesce(new.estimate#>>'{detailed,input,pricedAt}',current_date::text) then
      raise exception 'graybar_rom_source_stale' using errcode='23514'; end if;
    select value into v_quoted_line from jsonb_array_elements(v_quote->'lines') where value->>'lineNumber'=v_source->>'lineNumber';
    if not exists(select 1 from jsonb_array_elements(coalesce(v_state->'assessments','[]'::jsonb)) a
      where a->>'quoteId'=v_source->>'quoteId' and a->>'lineNumber'=v_source->>'lineNumber'
        and a->>'requirementId'=v_line->>'scopeRef' and a->>'result'='Meets'
        and a->>'defineRevision'=new.definition_revision::text)
      or exists(select 1 from jsonb_array_elements(coalesce(v_state->'assessments','[]'::jsonb)) a
        where a->>'quoteId'=v_source->>'quoteId' and a->>'lineNumber'=v_source->>'lineNumber'
          and a->>'requirementId'=v_line->>'scopeRef' and a->>'result'='Fails') then
      raise exception 'graybar_rom_technical_assessment_required' using errcode='23514'; end if;
    if v_quoted_line is null or v_quoted_line->>'unitPriceMinor'<>v_source->>'unitPriceMinor'
      or v_quoted_line->>'packSize'<>v_source->>'packSize'
      or v_quoted_line->>'description'<>v_line->>'description'
      or v_line->>'manualRate'<>to_char((v_quoted_line->>'unitPriceMinor')::numeric/100,'FM999999999990.00')
      or v_line->>'unit'<>((v_quoted_line->>'packSize')||' '||(v_quoted_line->>'unit'))
      or coalesce(trim(v_line->>'quantityBasis'),'')='' then
      raise exception 'graybar_rom_price_or_quantity_mismatch' using errcode='23514'; end if;
  end loop;
  return new;
end; $$;
revoke all on function d5o_hosted.guard_graybar_rom_source_v1() from public,anon,authenticated,service_role;
