ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_unit_ids_nonempty" CHECK (jsonb_array_length("catalog_items"."unit_ids") > 0);--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_address_complete" CHECK (char_length(btrim("units"."address" ->> 'postalCode')) > 0
        AND char_length(btrim("units"."address" ->> 'state')) > 0
        AND char_length(btrim("units"."address" ->> 'city')) > 0
        AND char_length(btrim("units"."address" ->> 'neighborhood')) > 0
        AND char_length(btrim("units"."address" ->> 'street')) > 0);--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_company_taxid_nonempty" CHECK ("units"."fiscal_kind" <> 'company' OR char_length(btrim("units"."fiscal" ->> 'taxId')) > 0);