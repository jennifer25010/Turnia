CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Booking"
ADD CONSTRAINT "booking_staff_no_overlapping_active"
EXCLUDE USING gist (
    "staffId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
)
WHERE ("status" IN ('PENDING', 'CONFIRMED'));
