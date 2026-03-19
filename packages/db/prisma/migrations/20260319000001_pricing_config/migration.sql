-- CreateTable
CREATE TABLE "pricing_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "gemini_audio_input_per_1m" DOUBLE PRECISION NOT NULL DEFAULT 3.00,
    "gemini_audio_output_per_1m" DOUBLE PRECISION NOT NULL DEFAULT 12.00,
    "gemini_text_input_per_1m" DOUBLE PRECISION NOT NULL DEFAULT 0.50,
    "gemini_text_output_per_1m" DOUBLE PRECISION NOT NULL DEFAULT 2.00,
    "gemini_summary_per_1m" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
    "telnyx_call_per_min" DOUBLE PRECISION NOT NULL DEFAULT 0.007,
    "telnyx_recording_per_min" DOUBLE PRECISION NOT NULL DEFAULT 0.002,
    "deepgram_per_sec" DOUBLE PRECISION NOT NULL DEFAULT 0.000128,
    "usd_to_ils" DOUBLE PRECISION NOT NULL DEFAULT 3.65,

    CONSTRAINT "pricing_config_pkey" PRIMARY KEY ("id")
);

-- Seed singleton row with defaults
INSERT INTO "pricing_config" ("id") VALUES ('singleton') ON CONFLICT DO NOTHING;
