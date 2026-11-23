ALTER TABLE "invites_pii" RENAME COLUMN "email" TO "whatsapp";--> statement-breakpoint
ALTER TABLE "invites_pii" DROP CONSTRAINT "invites_pii_email_nonempty";--> statement-breakpoint
ALTER TABLE "invites_pii" ADD CONSTRAINT "invites_pii_whatsapp_nonempty" CHECK (char_length(btrim("invites_pii"."whatsapp")) > 0);