CREATE TABLE "hardcover_quote_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"annotation_id" integer NOT NULL,
	"hardcover_reading_journal_id" integer,
	"last_synced_version" integer,
	"last_synced_at" timestamp with time zone,
	"sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hardcover_quote_state_annotation_uidx" UNIQUE("annotation_id")
);
--> statement-breakpoint
ALTER TABLE "hardcover_user_settings" ADD COLUMN "sync_quotes" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "hardcover_quote_state" ADD CONSTRAINT "hardcover_quote_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hardcover_quote_state" ADD CONSTRAINT "hardcover_quote_state_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hardcover_quote_state" ADD CONSTRAINT "hardcover_quote_state_annotation_id_annotations_id_fk" FOREIGN KEY ("annotation_id") REFERENCES "public"."annotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hardcover_quote_state_user_book_idx" ON "hardcover_quote_state" USING btree ("user_id","book_id");