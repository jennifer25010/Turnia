-- Integridad de agenda (migración aditiva, sin cambios destructivos).
--
-- Convención: weekday 0 = domingo ... 6 = sábado; startMinute/endMinute son
-- minutos desde las 00:00 en la zona horaria del negocio (endMinute exclusivo,
-- máximo 1440).
--
-- Antes de aplicarla conviene comprobar que no existan filas que la violen
-- (ver docs/etapa-1-agenda-segura.md). Si alguna fila existente incumple una
-- regla, PostgreSQL aborta la migración completa y no queda nada a medias.

ALTER TABLE "BusinessHours"
ADD CONSTRAINT "business_hours_valid_window"
CHECK (
    "weekday" BETWEEN 0 AND 6
    AND "startMinute" >= 0
    AND "endMinute" <= 1440
    AND "startMinute" < "endMinute"
);

ALTER TABLE "StaffAvailability"
ADD CONSTRAINT "staff_availability_valid_window"
CHECK (
    "weekday" BETWEEN 0 AND 6
    AND "startMinute" >= 0
    AND "endMinute" <= 1440
    AND "startMinute" < "endMinute"
);

ALTER TABLE "BusinessClosure"
ADD CONSTRAINT "business_closure_valid_range"
CHECK ("startsAt" < "endsAt");

ALTER TABLE "TimeOff"
ADD CONSTRAINT "time_off_valid_range"
CHECK ("startsAt" < "endsAt");

ALTER TABLE "Booking"
ADD CONSTRAINT "booking_valid_range"
CHECK ("startsAt" < "endsAt");

ALTER TABLE "Service"
ADD CONSTRAINT "service_valid_duration_and_price"
CHECK ("durationMinutes" > 0 AND "price" >= 0);
